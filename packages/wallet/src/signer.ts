import type { Address, Hash, Hex } from "viem";

export interface SignerTransactionParams {
  chainId: number;
  to: Address;
  value: bigint;
  data?: Hex;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
  /** Optional RPC URL override (e.g., for MEV protection) */
  rpcUrl?: string;
}

/**
 * Minimal signer interface. Implementations handle their own
 * key material, signing mechanism, and broadcasting.
 */
export interface Signer {
  /** The address this signer controls */
  readonly address: Address;

  /** The type of signer for UX and logging */
  readonly type: "local" | "coinbase" | "ledger" | "safe";

  /**
   * Whether this signer can sign without external user interaction.
   * Returns false for Ledger (physical confirmation) and Safe (multisig threshold).
   */
  readonly isAutomatic: boolean;

  /**
   * Sign and broadcast a transaction. Returns the tx hash.
   * The implementation is responsible for creating its own transport/client.
   */
  sendTransaction(params: SignerTransactionParams): Promise<Hash>;
}
