import {
  Connection,
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { getLogger, triggerHook, createHookEvent } from "@chainclaw/core";
import type { SolanaSigner } from "@chainclaw/wallet";
import type Database from "better-sqlite3";
import { Guardrails } from "./guardrails.js";
import { TransactionLog } from "./txlog.js";
import { PositionLock, type LockHandle } from "./position-lock.js";

const logger = getLogger("solana-executor");

// ─── Types ──────────────────────────────────────────────────

export interface SolanaTransactionRequest {
  chainId: 900;
  from: string; // base58 pubkey
  instructions: TransactionInstruction[];
  description: string;
  /** Target address for position locking (e.g. token mint) */
  targetAddress?: string;
  /** Estimated SOL cost for guardrail USD conversion */
  estimatedSolCost?: number;
}

export interface SolanaExecutionCallbacks {
  onSimulated?: (preview: string) => Promise<void>;
  onConfirmationRequired?: (preview: string, txId: string) => Promise<boolean>;
  onBroadcast?: (signature: string) => Promise<void>;
  onConfirmed?: (signature: string) => Promise<void>;
  onFailed?: (error: string) => Promise<void>;
}

export interface SolanaExecutionResult {
  txId: string;
  signature?: string;
  success: boolean;
  message: string;
}

// ─── Solana Transaction Executor ────────────────────────────

export class SolanaTransactionExecutor {
  private connection: Connection;
  private guardrails: Guardrails;
  private txLog: TransactionLog;
  private positionLock: PositionLock;

  constructor(
    db: Database.Database,
    rpcUrl: string,
    options?: { positionLock?: PositionLock },
  ) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.guardrails = new Guardrails(db);
    this.txLog = new TransactionLog(db);
    this.positionLock = options?.positionLock ?? new PositionLock();
  }

  /**
   * Execute a Solana transaction built from instructions.
   */
  async execute(
    request: SolanaTransactionRequest,
    signer: SolanaSigner,
    meta: { userId: string; skillName: string; intentDescription: string; solPriceUsd?: number },
    callbacks: SolanaExecutionCallbacks = {},
  ): Promise<SolanaExecutionResult> {
    const solPriceUsd = meta.solPriceUsd ?? 150; // fallback

    // 0. Acquire position lock
    const lockKey = PositionLock.key(meta.userId, 900, request.targetAddress ?? request.from);
    let lockHandle: LockHandle;
    try {
      lockHandle = await this.positionLock.acquire(lockKey, "exclusive", 30_000);
    } catch {
      return { txId: "", success: false, message: "Could not acquire position lock — another operation is in progress" };
    }

    try {
      // 1. Build transaction with priority fee
      logger.info({ from: request.from }, "Step 1: Building Solana transaction");
      const { blockhash } = await this.connection.getLatestBlockhash("confirmed");

      const priorityFee = await this.estimatePriorityFee();
      const instructions: TransactionInstruction[] = [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
        ...request.instructions,
      ];

      const transaction = new Transaction();
      transaction.add(...instructions);
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = new PublicKey(request.from);

      // 2. Simulate
      logger.info("Step 2: Simulating transaction");
      void triggerHook(createHookEvent("tx", "before_simulate", { chainId: 900, to: request.targetAddress ?? "", userId: meta.userId }));

      const simulation = await this.connection.simulateTransaction(transaction);

      if (simulation.value.err) {
        const error = JSON.stringify(simulation.value.err);
        logger.warn({ error }, "Simulation failed");
        void triggerHook(createHookEvent("tx", "after_simulate", { chainId: 900, success: false, userId: meta.userId }));
        return { txId: "", success: false, message: `Transaction simulation failed: ${error}` };
      }

      const unitsConsumed = simulation.value.unitsConsumed ?? 200_000;
      const preview = `*Solana Transaction*\n\n${request.description}\nEstimated compute: ${unitsConsumed.toLocaleString()} units\nPriority fee: ${priorityFee} micro-lamports/CU`;

      void triggerHook(createHookEvent("tx", "after_simulate", { chainId: 900, success: true, userId: meta.userId }));

      if (callbacks.onSimulated) {
        await callbacks.onSimulated(preview);
      }

      // 3. Guardrails
      logger.info("Step 3: Running guardrail checks");
      const estimatedSol = request.estimatedSolCost ?? 0;
      const estimatedUsd = estimatedSol * solPriceUsd;
      const checks = await this.guardrails.checkSolana(meta.userId, estimatedUsd);

      const failedChecks = checks.filter((c) => !c.passed);
      if (failedChecks.length > 0) {
        const reasons = failedChecks.map((c) => c.message).join("; ");
        return { txId: "", success: false, message: `Guardrails blocked: ${reasons}` };
      }

      // 4. Log
      const txId = this.txLog.create({
        userId: meta.userId,
        chainId: 900,
        from: request.from,
        to: request.targetAddress ?? "solana-program",
        value: estimatedSol.toString(),
        skillName: meta.skillName,
        intentDescription: meta.intentDescription,
      });
      this.txLog.updateStatus(txId, "simulated");

      // 5. Confirmation gate
      const limits = this.guardrails.getLimits(meta.userId);
      if (this.guardrails.requiresConfirmation(estimatedUsd, limits) && callbacks.onConfirmationRequired) {
        const confirmed = await callbacks.onConfirmationRequired(preview, txId);
        if (!confirmed) {
          this.txLog.updateStatus(txId, "rejected");
          return { txId, success: false, message: "Transaction cancelled by user." };
        }
      }

      this.txLog.updateStatus(txId, "approved");

      // 6. Sign & broadcast
      logger.info("Step 4: Signing and broadcasting");
      void triggerHook(createHookEvent("tx", "before_broadcast", { txId, chainId: 900, userId: meta.userId }));

      const signature = await signer.signAndSendTransaction({ transaction });

      this.txLog.updateStatus(txId, "confirmed", { hash: signature });
      this.guardrails.recordTxSent(meta.userId);

      if (callbacks.onBroadcast) {
        await callbacks.onBroadcast(signature);
      }
      if (callbacks.onConfirmed) {
        await callbacks.onConfirmed(signature);
      }

      void triggerHook(createHookEvent("tx", "confirmed", { txId, hash: signature, userId: meta.userId }));
      logger.info({ signature }, "Solana transaction confirmed");

      return { txId, signature, success: true, message: `Transaction confirmed: ${signature}` };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      logger.error({ err }, "Solana transaction failed");
      void triggerHook(createHookEvent("tx", "failed", { error: errorMsg, userId: meta.userId }));

      if (callbacks.onFailed) {
        await callbacks.onFailed(errorMsg);
      }

      return { txId: "", success: false, message: `Transaction failed: ${errorMsg}` };
    } finally {
      this.positionLock.release(lockHandle!);
    }
  }

  /**
   * Execute a pre-built transaction (e.g. from Jupiter API).
   */
  async executePrebuilt(
    transaction: VersionedTransaction,
    signer: SolanaSigner,
    meta: { userId: string; skillName: string; intentDescription: string; solPriceUsd?: number; estimatedValueUsd?: number },
    callbacks: SolanaExecutionCallbacks = {},
  ): Promise<SolanaExecutionResult> {
    // Position lock on the signer's address
    const lockKey = PositionLock.key(meta.userId, 900, signer.publicKey);
    let lockHandle: LockHandle;
    try {
      lockHandle = await this.positionLock.acquire(lockKey, "exclusive", 30_000);
    } catch {
      return { txId: "", success: false, message: "Could not acquire position lock — another operation is in progress" };
    }

    try {
      // 1. Simulate pre-built transaction
      logger.info("Simulating pre-built Solana transaction");
      void triggerHook(createHookEvent("tx", "before_simulate", { chainId: 900, userId: meta.userId }));

      const simulation = await this.connection.simulateTransaction(transaction);

      if (simulation.value.err) {
        const error = JSON.stringify(simulation.value.err);
        logger.warn({ error }, "Pre-built tx simulation failed");
        return { txId: "", success: false, message: `Transaction simulation failed: ${error}` };
      }

      const unitsConsumed = simulation.value.unitsConsumed ?? 200_000;
      const preview = `*Solana Transaction*\n\n${meta.intentDescription}\nEstimated compute: ${unitsConsumed.toLocaleString()} units`;

      void triggerHook(createHookEvent("tx", "after_simulate", { chainId: 900, success: true, userId: meta.userId }));

      if (callbacks.onSimulated) {
        await callbacks.onSimulated(preview);
      }

      // 2. Guardrails
      const estimatedUsd = meta.estimatedValueUsd ?? 0;
      const checks = await this.guardrails.checkSolana(meta.userId, estimatedUsd);
      const failedChecks = checks.filter((c) => !c.passed);
      if (failedChecks.length > 0) {
        const reasons = failedChecks.map((c) => c.message).join("; ");
        return { txId: "", success: false, message: `Guardrails blocked: ${reasons}` };
      }

      // 3. Log
      const txId = this.txLog.create({
        userId: meta.userId,
        chainId: 900,
        from: signer.publicKey,
        to: "solana-program",
        value: "0",
        skillName: meta.skillName,
        intentDescription: meta.intentDescription,
      });
      this.txLog.updateStatus(txId, "simulated");

      // 4. Confirmation gate
      const limits = this.guardrails.getLimits(meta.userId);
      if (this.guardrails.requiresConfirmation(estimatedUsd, limits) && callbacks.onConfirmationRequired) {
        const confirmed = await callbacks.onConfirmationRequired(preview, txId);
        if (!confirmed) {
          this.txLog.updateStatus(txId, "rejected");
          return { txId, success: false, message: "Transaction cancelled by user." };
        }
      }

      this.txLog.updateStatus(txId, "approved");

      // 5. Sign & broadcast
      logger.info("Signing and broadcasting pre-built transaction");
      void triggerHook(createHookEvent("tx", "before_broadcast", { txId, chainId: 900, userId: meta.userId }));

      const signature = await signer.signAndSendTransaction({ transaction });

      this.txLog.updateStatus(txId, "confirmed", { hash: signature });
      this.guardrails.recordTxSent(meta.userId);

      if (callbacks.onBroadcast) {
        await callbacks.onBroadcast(signature);
      }
      if (callbacks.onConfirmed) {
        await callbacks.onConfirmed(signature);
      }

      void triggerHook(createHookEvent("tx", "confirmed", { txId, hash: signature, userId: meta.userId }));
      logger.info({ signature }, "Pre-built Solana transaction confirmed");

      return { txId, signature, success: true, message: `Transaction confirmed: ${signature}` };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      logger.error({ err }, "Pre-built Solana transaction failed");

      if (callbacks.onFailed) {
        await callbacks.onFailed(errorMsg);
      }

      return { txId: "", success: false, message: `Transaction failed: ${errorMsg}` };
    } finally {
      this.positionLock.release(lockHandle!);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────

  private async estimatePriorityFee(): Promise<number> {
    try {
      const fees = await this.connection.getRecentPrioritizationFees();
      if (fees.length === 0) return 5_000;
      const avgFee = fees.reduce((sum, f) => sum + f.prioritizationFee, 0) / fees.length;
      return Math.ceil(avgFee);
    } catch {
      return 5_000; // fallback: 5000 micro-lamports per CU
    }
  }

  getTransactionLog(): TransactionLog {
    return this.txLog;
  }

  getGuardrails(): Guardrails {
    return this.guardrails;
  }

  getPositionLock(): PositionLock {
    return this.positionLock;
  }
}
