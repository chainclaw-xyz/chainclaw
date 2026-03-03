import type { VersionedTransaction } from "@solana/web3.js";

// ─── Token Launch Provider Interface ─────────────────────────
// Provider-agnostic abstraction over token launchpads (pump.fun, Clanker, etc.)

export interface TokenLaunchProvider {
  /** Launchpad name (e.g. "pump.fun", "clanker") */
  readonly name: string;
  /** Chain IDs this provider supports */
  readonly supportedChains: number[];

  /**
   * Launch a new token on the launchpad.
   * - walletAddress: used by pump.fun as the buyer/fee-payer, by Clanker as tokenAdmin.
   * - privateKey: EVM private key (hex); not used by either current provider but
   *   available for future EVM providers that need to sign on-chain.
   */
  launch(
    params: LaunchParams,
    walletAddress: string,
    privateKey: string,
  ): Promise<LaunchResult>;
}

// ─── Parameter Types ─────────────────────────────────────────

export interface LaunchParams {
  name: string;
  symbol: string;
  description?: string;
  /** Optional image URL. For pump.fun, downloaded and re-uploaded to IPFS. */
  imageUrl?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  chainId: number;
  /** pump.fun only — SOL to spend on initial buy (default "0.1") */
  initialBuySol?: string;
}

// ─── Result Types ─────────────────────────────────────────────

export interface LaunchResult {
  /** Token mint address (Base58 for Solana, 0x for EVM) */
  tokenAddress: string;
  /** Transaction hash / signature, if already broadcast */
  txHash?: string;
  /** Human-readable status message */
  message: string;
  /**
   * Pre-signed Solana transaction to broadcast (pump.fun only).
   * Present when the provider has built and mint-keypair-signed the tx but
   * has not broadcast it — the skill is responsible for broadcasting via
   * SolanaTransactionExecutor.executePrebuilt().
   */
  signedTx?: VersionedTransaction;
}
