import { getLogger, triggerHook, createHookEvent } from "@chainclaw/core";
import {
  createPublicClient,
  http,
  formatEther,
  type Hash,
  type Chain,
} from "viem";
import { mainnet, base, arbitrum, optimism } from "viem/chains";
import type { Signer } from "@chainclaw/wallet";
import type Database from "better-sqlite3";
import type { TransactionRequest, SimulationResult, GuardrailCheck } from "./types.js";
import { TransactionSimulator, type SimulatorConfig } from "./simulator.js";
import { Guardrails } from "./guardrails.js";
import { NonceManager } from "./nonce.js";
import { TransactionLog } from "./txlog.js";
import { RiskEngine, type RiskEngineConfig } from "./risk/index.js";
import { MevProtection } from "./mev.js";

const logger = getLogger("executor");

const viemChains: Record<number, Chain> = { 1: mainnet, 8453: base, 42161: arbitrum, 10: optimism };

export interface ExecutionCallbacks {
  onSimulated?: (result: SimulationResult, preview: string) => Promise<void>;
  onGuardrails?: (checks: GuardrailCheck[]) => Promise<void>;
  onRiskWarning?: (warning: string) => Promise<boolean>; // return false to abort
  onConfirmationRequired?: (preview: string, txId: string) => Promise<boolean>;
  onBroadcast?: (hash: Hash) => Promise<void>;
  onConfirmed?: (hash: Hash, blockNumber: bigint) => Promise<void>;
  onFailed?: (error: string) => Promise<void>;
}

export class TransactionExecutor {
  private simulator: TransactionSimulator;
  private guardrails: Guardrails;
  private nonceManager: NonceManager;
  private txLog: TransactionLog;
  private riskEngine: RiskEngine;
  private mevProtection: MevProtection;
  private rpcOverrides: Record<number, string>;
  private enableMevProtection: boolean;

  constructor(
    db: Database.Database,
    simulatorConfig: SimulatorConfig,
    rpcOverrides?: Record<number, string>,
    options?: { riskConfig?: RiskEngineConfig; enableMevProtection?: boolean },
  ) {
    this.simulator = new TransactionSimulator(simulatorConfig);
    this.guardrails = new Guardrails(db);
    this.nonceManager = new NonceManager(rpcOverrides);
    this.txLog = new TransactionLog(db);
    this.riskEngine = new RiskEngine(db, options?.riskConfig);
    this.mevProtection = new MevProtection();
    this.rpcOverrides = rpcOverrides ?? {};
    this.enableMevProtection = options?.enableMevProtection ?? true;
  }

  async execute(
    tx: TransactionRequest,
    signer: Signer,
    meta: { userId: string; skillName: string; intentDescription: string; ethPriceUsd?: number },
    callbacks: ExecutionCallbacks = {},
  ): Promise<{ txId: string; hash?: Hash; success: boolean; message: string }> {
    const ethPriceUsd = meta.ethPriceUsd ?? 2500; // fallback

    // 1. Simulate
    logger.info({ chainId: tx.chainId, to: tx.to }, "Step 1: Simulating transaction");
    void triggerHook(createHookEvent("tx", "before_simulate", { chainId: tx.chainId, to: tx.to, userId: meta.userId }));
    const simResult = await this.simulator.simulate(tx);
    const preview = this.simulator.formatPreview(simResult);
    void triggerHook(createHookEvent("tx", "after_simulate", { chainId: tx.chainId, success: simResult.success, userId: meta.userId }));

    if (callbacks.onSimulated) {
      await callbacks.onSimulated(simResult, preview);
    }

    if (!simResult.success) {
      return {
        txId: "",
        success: false,
        message: `Transaction would fail: ${simResult.error || "unknown error"}`,
      };
    }

    // 2. Risk check on target contract
    if (tx.data && tx.to) {
      logger.info({ to: tx.to }, "Step 2a: Checking contract risk");
      const riskResult = await this.riskEngine.shouldBlock(
        meta.userId,
        tx.chainId,
        tx.to,
      );

      if (riskResult.blocked) {
        return {
          txId: "",
          success: false,
          message: `Risk engine blocked: ${riskResult.reason}`,
        };
      }

      // Warn if risky but not blocked
      if (riskResult.reason && callbacks.onRiskWarning) {
        const report = await this.riskEngine.analyzeToken(tx.chainId, tx.to);
        if (report && this.riskEngine.needsWarning(report)) {
          const warning = this.riskEngine.formatRiskReport(report);
          const proceed = await callbacks.onRiskWarning(warning);
          if (!proceed) {
            return {
              txId: "",
              success: false,
              message: "Transaction cancelled after risk warning.",
            };
          }
        }
      }
    }

    // 2b. Guardrails
    logger.info("Step 2b: Running guardrail checks");
    const checks = await this.guardrails.check(meta.userId, tx, ethPriceUsd);

    if (callbacks.onGuardrails) {
      await callbacks.onGuardrails(checks);
    }

    const failedChecks = checks.filter((c) => !c.passed);
    if (failedChecks.length > 0) {
      const reasons = failedChecks.map((c) => c.message).join("; ");
      return {
        txId: "",
        success: false,
        message: `Guardrails blocked: ${reasons}`,
      };
    }

    // 3. Log the transaction
    const txId = this.txLog.create({
      userId: meta.userId,
      chainId: tx.chainId,
      from: tx.from,
      to: tx.to,
      value: tx.value.toString(),
      skillName: meta.skillName,
      intentDescription: meta.intentDescription,
      simulationResult: simResult,
      guardrailChecks: checks,
    });
    this.txLog.updateStatus(txId, "simulated");

    // 4. Confirmation gate
    const txValueEth = Number(formatEther(tx.value));
    const txValueUsd = txValueEth * ethPriceUsd;
    const limits = this.guardrails.getLimits(meta.userId);

    if (this.guardrails.requiresConfirmation(txValueUsd, limits) && callbacks.onConfirmationRequired) {
      logger.info({ txValueUsd }, "Step 3: Requesting user confirmation");
      const confirmed = await callbacks.onConfirmationRequired(preview, txId);
      if (!confirmed) {
        this.txLog.updateStatus(txId, "rejected");
        return { txId, success: false, message: "Transaction cancelled by user." };
      }
    }

    this.txLog.updateStatus(txId, "approved");

    // 5. Sign & broadcast
    try {
      logger.info({ signerType: signer.type }, "Step 4: Signing and broadcasting");
      const chain = viemChains[tx.chainId];
      if (!chain) throw new Error(`Unsupported chain: ${tx.chainId}`);

      // Prompt user for non-automatic signers (Ledger, Safe)
      if (!signer.isAutomatic && callbacks.onConfirmationRequired) {
        const prompt = signer.type === "ledger"
          ? "Please confirm the transaction on your Ledger device..."
          : `Transaction proposed to ${signer.type} signer. Awaiting confirmation...`;
        const proceed = await callbacks.onConfirmationRequired(prompt, txId);
        if (!proceed) {
          this.txLog.updateStatus(txId, "rejected");
          return { txId, success: false, message: "Transaction cancelled by user." };
        }
      }

      // Use Flashbots Protect for Ethereum mainnet when enabled and tx has data (contract interaction)
      const useMevProtection =
        this.enableMevProtection &&
        tx.data &&
        this.mevProtection.isSupported(tx.chainId);

      const rpcUrl = useMevProtection
        ? this.mevProtection.getProtectedRpcUrl()
        : undefined; // signer uses its own RPC overrides by default

      if (useMevProtection) {
        logger.info("Using Flashbots Protect for MEV protection");
      }

      void triggerHook(createHookEvent("tx", "before_broadcast", { txId, chainId: tx.chainId, userId: meta.userId }));

      const nonce = await this.nonceManager.getNonce(tx.chainId, tx.from);

      const hash = await signer.sendTransaction({
        chainId: tx.chainId,
        to: tx.to,
        value: tx.value,
        data: tx.data,
        gas: simResult.gasEstimate + (simResult.gasEstimate / 10n), // 10% buffer
        nonce,
        rpcUrl,
      });

      this.nonceManager.increment(tx.chainId, tx.from);
      this.txLog.updateStatus(txId, "broadcast", { hash });
      this.guardrails.recordTxSent(meta.userId);

      if (callbacks.onBroadcast) {
        await callbacks.onBroadcast(hash);
      }

      // 6. Wait for confirmation
      logger.info({ hash }, "Step 5: Waiting for confirmation");
      const publicClient = createPublicClient({
        chain,
        transport: http(this.rpcOverrides[tx.chainId]),
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 120_000,
      });

      if (receipt.status === "success") {
        this.txLog.updateStatus(txId, "confirmed", {
          gasUsed: receipt.gasUsed.toString(),
          gasPrice: receipt.effectiveGasPrice.toString(),
          blockNumber: Number(receipt.blockNumber),
        });

        if (callbacks.onConfirmed) {
          await callbacks.onConfirmed(hash, receipt.blockNumber);
        }

        void triggerHook(createHookEvent("tx", "confirmed", { txId, hash, blockNumber: Number(receipt.blockNumber), userId: meta.userId }));
        return { txId, hash, success: true, message: `Transaction confirmed in block ${receipt.blockNumber}` };
      } else {
        this.txLog.updateStatus(txId, "failed", { error: "Transaction reverted" });
        void triggerHook(createHookEvent("tx", "failed", { txId, hash, error: "Transaction reverted", userId: meta.userId }));
        return { txId, hash, success: false, message: "Transaction reverted on-chain" };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      this.txLog.updateStatus(txId, "failed", { error: errorMsg });
      void triggerHook(createHookEvent("tx", "failed", { txId, error: errorMsg, userId: meta.userId }));

      if (callbacks.onFailed) {
        await callbacks.onFailed(errorMsg);
      }

      return { txId, success: false, message: `Transaction failed: ${errorMsg}` };
    }
  }

  getTransactionLog(): TransactionLog {
    return this.txLog;
  }

  getGuardrails(): Guardrails {
    return this.guardrails;
  }

  getRiskEngine(): RiskEngine {
    return this.riskEngine;
  }
}
