import type { Address, Hash } from "viem";
import type { Signer, SignerTransactionParams } from "../signer.js";

/**
 * SafeSigner — proposes and executes transactions via a Safe (Gnosis Safe) multisig.
 *
 * This is a stub. The full implementation requires:
 * - `@safe-global/protocol-kit` for transaction building
 * - `@safe-global/api-kit` for Safe Transaction Service interaction
 * - An existing Safe deployed on-chain with this signer as an owner
 *
 * SafeSigner is NOT automatic — the transaction must be proposed, signed by
 * enough owners to reach the threshold, and then executed.
 *
 * Lifecycle:
 *   1. Build a Safe transaction from the params
 *   2. Propose it to the Safe Transaction Service
 *   3. Return a "pending" hash (safeTxHash)
 *   4. Other owners sign via the Safe UI or API
 *   5. Once threshold is met, any owner can execute on-chain
 */
export class SafeSigner implements Signer {
  readonly type = "safe" as const;
  readonly isAutomatic = false;
  readonly address: Address;

  /** The Safe contract address (the multisig itself) */
  private safeAddress: Address;
  /** The signer's own address (one of the Safe owners) */
  private ownerAddress: Address;

  constructor(safeAddress: Address, ownerAddress: Address) {
    this.address = safeAddress; // The "from" address is the Safe
    this.safeAddress = safeAddress;
    this.ownerAddress = ownerAddress;
  }

  async sendTransaction(_params: SignerTransactionParams): Promise<Hash> {
    // TODO: Implement with @safe-global/protocol-kit + @safe-global/api-kit
    // 1. Initialize Safe SDK with safeAddress and owner signer
    // 2. Create a Safe transaction from params
    // 3. Sign with the owner's key
    // 4. Propose to the Transaction Service
    // 5. If threshold === 1, execute immediately and return on-chain hash
    // 6. Otherwise, return the safeTxHash (callers should handle the pending state)
    throw new Error(
      "SafeSigner is not yet implemented. Install @safe-global/protocol-kit and @safe-global/api-kit.",
    );
  }

  /**
   * Factory: connect to an existing Safe.
   */
  static async connect(
    _safeAddress: Address,
    _ownerAddress: Address,
    _chainId: number,
  ): Promise<SafeSigner> {
    // TODO: Use protocol-kit to verify Safe exists and owner is valid
    // const safeSdk = await Safe.init({ provider, signer, safeAddress });
    // const owners = await safeSdk.getOwners();
    // if (!owners.includes(ownerAddress)) throw new Error("Not an owner");
    // return new SafeSigner(safeAddress, ownerAddress);
    throw new Error(
      "SafeSigner.connect() is not yet implemented. Install @safe-global dependencies.",
    );
  }
}
