// ─── Privacy Provider Interface ──────────────────────────────
// Provider-agnostic abstraction over privacy protocols (Railgun, etc.)

export interface PrivacyProvider {
  /** Protocol name (e.g. "railgun") */
  readonly name: string;
  /** Chain IDs this provider supports */
  readonly supportedChains: number[];

  /**
   * One-time initialization: load proving artifacts, connect to chain.
   * Called lazily on first operation. Reports progress via callback.
   */
  init(onProgress?: (msg: string) => void): Promise<void>;
  isInitialized(): boolean;

  /**
   * Build shield (deposit) transactions.
   * Returns raw tx data for the pipeline executor.
   * May return multiple txs (ERC20 approve + shield).
   */
  deposit(params: DepositParams): Promise<DepositResult>;

  /**
   * Build unshield (withdraw) transaction.
   * Generates zk proof internally.
   */
  withdraw(params: WithdrawParams): Promise<WithdrawResult>;

  /**
   * Query shielded balance for a wallet on a given chain.
   */
  getShieldedBalance(
    walletAddress: string,
    privateKey: string,
    chainId: number,
  ): Promise<ShieldedBalance[]>;
}

// ─── Parameter Types ─────────────────────────────────────────

export interface DepositParams {
  walletAddress: string;
  privateKey: string;
  token: string;
  tokenAddress: string;
  decimals: number;
  amount: string;
  chainId: number;
}

export interface WithdrawParams {
  walletAddress: string;
  privateKey: string;
  token: string;
  tokenAddress: string;
  decimals: number;
  amount: string;
  chainId: number;
  recipientAddress: string;
}

// ─── Result Types ────────────────────────────────────────────

export interface PrivacyTransaction {
  to: string;
  data: string;
  value: string;
  gasEstimate: number;
  description: string;
}

export interface DepositResult {
  transactions: PrivacyTransaction[];
  noteCommitment: string;
}

export interface WithdrawResult {
  transaction: PrivacyTransaction;
  nullifierHash: string;
}

export interface ShieldedBalance {
  token: string;
  tokenAddress: string;
  amount: string;
  chainId: number;
}
