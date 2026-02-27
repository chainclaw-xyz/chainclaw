import type { Transaction, VersionedTransaction } from "@solana/web3.js";

export interface SolanaSignerTransactionParams {
  transaction: Transaction | VersionedTransaction;
  /** Optional RPC URL override */
  rpcUrl?: string;
}

/**
 * Minimal Solana signer interface. Parallel to the EVM `Signer` interface
 * but using Solana-native types (base58 public key, Ed25519 signatures).
 */
export interface SolanaSigner {
  /** The base58 public key */
  readonly publicKey: string;

  /** The type of signer for UX and logging */
  readonly type: "local";

  /**
   * Whether this signer can sign without external user interaction.
   */
  readonly isAutomatic: boolean;

  /**
   * Sign and send a Solana transaction. Returns the tx signature (base58).
   */
  signAndSendTransaction(params: SolanaSignerTransactionParams): Promise<string>;
}
