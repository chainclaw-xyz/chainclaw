import type { Address, Hash } from "viem";
import type { Signer, SignerTransactionParams } from "../signer.js";

/**
 * CoinbaseSigner — wraps Coinbase AgentKit for server-side wallet management.
 *
 * This is a scaffold. The full implementation requires:
 * - `@coinbase/coinbase-sdk` dependency
 * - API key credentials (COINBASE_API_KEY_NAME, COINBASE_API_KEY_SECRET)
 * - Coinbase wallet creation and tx signing via their SDK
 *
 * CoinbaseSigner is automatic (server-side signing, no user interaction needed).
 */
export class CoinbaseSigner implements Signer {
  readonly type = "coinbase" as const;
  readonly isAutomatic = true;
  readonly address: Address;

  constructor(address: Address) {
    this.address = address;
  }

  async sendTransaction(_params: SignerTransactionParams): Promise<Hash> {
    // TODO: Implement with @coinbase/coinbase-sdk
    // 1. Create/restore Coinbase wallet using AgentKit
    // 2. Build transaction from params
    // 3. Sign and broadcast via Coinbase SDK
    // 4. Return the transaction hash
    throw new Error(
      "CoinbaseSigner is not yet implemented. Install @coinbase/coinbase-sdk and configure API keys.",
    );
  }

  /**
   * Factory: create a CoinbaseSigner from API credentials.
   * Scaffolded — will create and persist a Coinbase-managed wallet.
   */
  static async create(
    _apiKeyName: string,
    _apiKeySecret: string,
  ): Promise<CoinbaseSigner> {
    // TODO: Use Coinbase SDK to create/restore wallet
    // const sdk = new CoinbaseSDK({ apiKeyName, apiKeySecret });
    // const wallet = await sdk.wallet.create();
    // return new CoinbaseSigner(wallet.address as Address);
    throw new Error(
      "CoinbaseSigner.create() is not yet implemented. Install @coinbase/coinbase-sdk.",
    );
  }
}
