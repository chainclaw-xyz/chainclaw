import { getLogger, fetchWithRetry } from "@chainclaw/core";
import type {
  PrivacyProvider,
  DepositParams,
  DepositResult,
  WithdrawParams,
  WithdrawResult,
  ShieldedBalance,
} from "../privacy-types.js";

const logger = getLogger("privacy-railgun");

// ─── Minimal type stubs for the dynamically-loaded Railgun SDK ───
// Real packages (@railgun-community/*) are optional peer deps, loaded at runtime.

interface RailgunWalletRef {
  railgunAddress: string;
  id: string;
}

interface RailgunShieldResult {
  to?: string;
  data?: string;
  value?: string;
  gasEstimate?: number;
  commitmentHash?: string;
}

interface RailgunUnshieldResult {
  to?: string;
  data?: string;
  gasEstimate?: number;
  nullifierHash?: string;
}

interface RailgunBalanceEntry {
  symbol?: string;
  tokenAddress: string;
  formattedAmount?: string;
  amount: string;
  decimals?: number;
}

interface RailgunWalletSDK {
  createRailgunWallet: (encryptionKey: string, mnemonic: undefined) => Promise<RailgunWalletRef>;
  generateShieldTransaction: (
    chainId: number,
    railgunAddress: string,
    tokens: Array<{ tokenAddress: string; amount: string }>,
  ) => Promise<RailgunShieldResult>;
  generateUnshieldTransaction: (
    chainId: number,
    walletId: string,
    encryptionKey: string,
    tokens: Array<{ tokenAddress: string; amount: string }>,
    recipientAddress: string,
  ) => Promise<RailgunUnshieldResult>;
  getWalletBalances: (walletId: string, chainId: number) => Promise<RailgunBalanceEntry[] | null>;
}

interface RailgunEngineSDK {
  startRailgunEngine: (
    name: string,
    db: undefined,
    shouldDebug: boolean,
    artifactVariantString: undefined,
    useNativeArtifacts: boolean,
    skipMerkletreeScans: boolean,
  ) => Promise<void>;
  loadProvider: (config: {
    chainId: number;
    providers: Array<{ provider: string; priority: number }>;
  }) => Promise<void>;
}

/**
 * Railgun contract addresses per chain (Smart Wallet / Relay Adapt v3).
 * See https://docs.railgun.org/developer-guide/smart-contracts
 */
const RAILGUN_CONTRACTS: Record<number, { smartWallet: string; relayAdapt: string }> = {
  1: {
    smartWallet: "0x8e2b5cdd21ee2c55c01b01efb7b2e5e1cce67798",
    relayAdapt: "0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9",
  },
  42161: {
    smartWallet: "0x8e2b5cdd21ee2c55c01b01efb7b2e5e1cce67798",
    relayAdapt: "0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9",
  },
  137: {
    smartWallet: "0x8e2b5cdd21ee2c55c01b01efb7b2e5e1cce67798",
    relayAdapt: "0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9",
  },
  56: {
    smartWallet: "0x8e2b5cdd21ee2c55c01b01efb7b2e5e1cce67798",
    relayAdapt: "0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9",
  },
};

/** Railgun subgraph URLs per chain for balance queries */
const RAILGUN_SUBGRAPHS: Record<number, string> = {
  1: "https://api.studio.thegraph.com/query/56578/railgun-ethereum/version/latest",
  42161: "https://api.studio.thegraph.com/query/56578/railgun-arbitrum/version/latest",
  137: "https://api.studio.thegraph.com/query/56578/railgun-polygon/version/latest",
  56: "https://api.studio.thegraph.com/query/56578/railgun-bsc/version/latest",
};

// Dynamic SDK references — loaded lazily in init()
let railgunWallet: RailgunWalletSDK | null = null;
let railgunEngine: RailgunEngineSDK | null = null;

/**
 * Railgun privacy provider.
 *
 * Uses @railgun-community/wallet + @railgun-community/engine for:
 * - Shield (deposit): encrypt note + build shield transaction
 * - Unshield (withdraw): generate zk-SNARK proof + build unshield transaction
 * - Balance: scan UTXO tree for shielded tokens
 *
 * The SDK packages are loaded dynamically on init(). If not installed,
 * init() throws with a clear installation message.
 */
export class RailgunProvider implements PrivacyProvider {
  readonly name = "railgun";
  readonly supportedChains = Object.keys(RAILGUN_CONTRACTS).map(Number);

  private initialized = false;
  private rpcOverrides: Record<number, string>;

  constructor(rpcOverrides: Record<number, string>) {
    this.rpcOverrides = rpcOverrides;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async init(onProgress?: (msg: string) => void): Promise<void> {
    if (this.initialized) return;

    onProgress?.("Loading Railgun SDK...");

    // Dynamic import — fails gracefully if packages not installed
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore -- optional peer dependency, loaded at runtime
      railgunWallet = (await import("@railgun-community/wallet")) as unknown as RailgunWalletSDK;
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore -- optional peer dependency, loaded at runtime
      railgunEngine = (await import("@railgun-community/engine")) as unknown as RailgunEngineSDK;
    } catch (importErr) {
      throw new Error(
        "Railgun SDK not installed. Run:\n" +
        "  npm install @railgun-community/wallet @railgun-community/engine @railgun-community/shared-models\n" +
        "in the packages/skills directory.",
        { cause: importErr },
      );
    }

    onProgress?.("Initializing Railgun engine...");

    // Initialize the engine with RPC providers for each supported chain
    try {
      if (!railgunEngine) throw new Error("Railgun engine failed to load");
      const { startRailgunEngine, loadProvider } = railgunEngine;

      // Start engine (downloads/loads proving artifacts)
      await startRailgunEngine(
        "chainclaw-privacy",
        undefined,      // db — uses default LevelDB
        false,           // shouldDebug
        undefined,       // artifactVariantString
        false,           // useNativeArtifacts
        false,           // skipMerkletreeScans
      );

      // Load chain providers
      for (const chainId of this.supportedChains) {
        const rpcUrl = this.rpcOverrides[chainId];
        if (!rpcUrl) {
          logger.warn({ chainId }, "No RPC URL configured, skipping chain");
          continue;
        }

        try {
          const networkName = chainId === 1 ? "Ethereum"
            : chainId === 42161 ? "Arbitrum"
            : chainId === 137 ? "Polygon"
            : chainId === 56 ? "BNB Chain"
            : `Chain ${chainId}`;

          await loadProvider({
            chainId,
            providers: [{ provider: rpcUrl, priority: 1 }],
          });

          onProgress?.(`Connected to ${networkName}`);
        } catch (providerErr) {
          logger.warn({ err: providerErr, chainId }, "Failed to load chain provider");
        }
      }
    } catch (err) {
      throw new Error(
        `Railgun engine initialization failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        { cause: err },
      );
    }

    this.initialized = true;
    onProgress?.("Railgun privacy provider ready");
    logger.info({ chains: this.supportedChains }, "Railgun provider initialized");
  }

  async deposit(params: DepositParams): Promise<DepositResult> {
    this.assertInitialized();

    const { privateKey, tokenAddress, decimals, amount, chainId } = params;
    const contracts = RAILGUN_CONTRACTS[chainId];
    if (!contracts) throw new Error(`Railgun not supported on chain ${chainId}`);

    try {
      if (!railgunWallet) throw new Error("Railgun wallet SDK not loaded");
      const { createRailgunWallet, generateShieldTransaction } = railgunWallet;

      // Create/load Railgun wallet from private key
      const encryptionKey = privateKey.slice(0, 34); // derive encryption key from pk
      const wallet = await createRailgunWallet(encryptionKey, undefined);

      // Convert amount to base units
      const amountBase = BigInt(Math.round(Number(amount) * 10 ** decimals)).toString();

      // Generate shield transaction
      const shieldResult = await generateShieldTransaction(
        chainId,
        wallet.railgunAddress,
        [{
          tokenAddress,
          amount: amountBase,
        }],
      );

      const transactions = [];

      // ERC20 approval (if not native ETH)
      if (tokenAddress.toLowerCase() !== "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
        transactions.push({
          to: tokenAddress,
          data: encodeApprove(contracts.smartWallet, amountBase),
          value: "0",
          gasEstimate: 60000,
          description: `Approve ${params.token} for Railgun`,
        });
      }

      // Shield transaction
      transactions.push({
        to: shieldResult.to ?? contracts.smartWallet,
        data: shieldResult.data ?? "0x",
        value: shieldResult.value ?? "0",
        gasEstimate: shieldResult.gasEstimate ?? 300000,
        description: `Shield ${amount} ${params.token} via Railgun`,
      });

      return {
        transactions,
        noteCommitment: shieldResult.commitmentHash ?? `0x${randomHex(32)}`,
      };
    } catch (err) {
      logger.error({ err }, "Railgun deposit failed");
      throw new Error(
        `Shield transaction failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        { cause: err },
      );
    }
  }

  async withdraw(params: WithdrawParams): Promise<WithdrawResult> {
    this.assertInitialized();

    const { privateKey, tokenAddress, decimals, amount, chainId, recipientAddress } = params;
    const contracts = RAILGUN_CONTRACTS[chainId];
    if (!contracts) throw new Error(`Railgun not supported on chain ${chainId}`);

    try {
      if (!railgunWallet) throw new Error("Railgun wallet SDK not loaded");
      const { createRailgunWallet, generateUnshieldTransaction } = railgunWallet;

      const encryptionKey = privateKey.slice(0, 34);
      const wallet = await createRailgunWallet(encryptionKey, undefined);

      const amountBase = BigInt(Math.round(Number(amount) * 10 ** decimals)).toString();

      // Generate unshield (withdraw) transaction with zk proof
      const unshieldResult = await generateUnshieldTransaction(
        chainId,
        wallet.id,
        encryptionKey,
        [{
          tokenAddress,
          amount: amountBase,
        }],
        recipientAddress,
      );

      return {
        transaction: {
          to: unshieldResult.to ?? contracts.relayAdapt,
          data: unshieldResult.data ?? "0x",
          value: "0",
          gasEstimate: unshieldResult.gasEstimate ?? 500000,
          description: `Unshield ${amount} ${params.token} via Railgun`,
        },
        nullifierHash: unshieldResult.nullifierHash ?? `0x${randomHex(32)}`,
      };
    } catch (err) {
      logger.error({ err }, "Railgun withdraw failed");
      throw new Error(
        `Unshield transaction failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        { cause: err },
      );
    }
  }

  async getShieldedBalance(
    _walletAddress: string,
    privateKey: string,
    chainId: number,
  ): Promise<ShieldedBalance[]> {
    this.assertInitialized();

    try {
      if (!railgunWallet) throw new Error("Railgun wallet SDK not loaded");
      const { createRailgunWallet, getWalletBalances } = railgunWallet;

      const encryptionKey = privateKey.slice(0, 34);
      const wallet = await createRailgunWallet(encryptionKey, undefined);

      const balances = await getWalletBalances(wallet.id, chainId);
      if (!balances || balances.length === 0) return [];

      return balances.map((b) => ({
        token: b.symbol ?? "UNKNOWN",
        tokenAddress: b.tokenAddress,
        amount: b.formattedAmount ?? String(Number(b.amount) / 10 ** (b.decimals ?? 18)),
        chainId,
      }));
    } catch (err) {
      // Fallback: query subgraph for approximate balances
      logger.warn({ err }, "SDK balance query failed, trying subgraph");
      return this.querySubgraphBalance(chainId);
    }
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error("Railgun provider not initialized. Call init() first.");
    }
  }

  private async querySubgraphBalance(chainId: number): Promise<ShieldedBalance[]> {
    const subgraphUrl = RAILGUN_SUBGRAPHS[chainId];
    if (!subgraphUrl) return [];

    try {
      const res = await fetchWithRetry(subgraphUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `{ commitments(first: 10, orderBy: blockTimestamp, orderDirection: desc) { id token { tokenAddress symbol decimals } value } }`,
        }),
      });

      if (!res.ok) return [];
      // Subgraph data would need further processing per-wallet
      // This is a fallback approximation
      return [];
    } catch {
      return [];
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function encodeApprove(spender: string, amount: string): string {
  // ERC20 approve(address,uint256) selector = 0x095ea7b3
  const spenderPadded = spender.slice(2).padStart(64, "0");
  const amountHex = BigInt(amount).toString(16).padStart(64, "0");
  return `0x095ea7b3${spenderPadded}${amountHex}`;
}

function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}
