import type { Address, Hash } from "viem";
import type { Signer, SignerTransactionParams } from "../signer.js";

/**
 * LedgerSigner — signs transactions via a connected Ledger hardware wallet.
 *
 * This is a stub. The full implementation requires:
 * - `@ledgerhq/hw-transport-node-hid` for USB HID communication
 * - `@ledgerhq/hw-app-eth` for Ethereum signing
 * - Physical Ledger device connected via USB
 *
 * LedgerSigner is NOT automatic — the user must physically confirm on the device.
 * The executor will prompt: "Please confirm the transaction on your Ledger device..."
 */
export class LedgerSigner implements Signer {
  readonly type = "ledger" as const;
  readonly isAutomatic = false;
  readonly address: Address;

  private derivationPath: string;

  constructor(address: Address, derivationPath: string = "44'/60'/0'/0/0") {
    this.address = address;
    this.derivationPath = derivationPath;
  }

  async sendTransaction(_params: SignerTransactionParams): Promise<Hash> {
    // TODO: Implement with @ledgerhq/hw-transport-node-hid + @ledgerhq/hw-app-eth
    // 1. Open HID transport
    // 2. Create Eth app instance
    // 3. Serialize the transaction (RLP encoding)
    // 4. Send to Ledger for signing (user confirms on device)
    // 5. Broadcast signed tx via viem publicClient
    // 6. Return the transaction hash
    throw new Error(
      "LedgerSigner is not yet implemented. Connect a Ledger device and install @ledgerhq/hw-transport-node-hid.",
    );
  }

  /**
   * Factory: detect a connected Ledger and read the address at the given derivation path.
   */
  static async detect(
    _derivationPath?: string,
  ): Promise<LedgerSigner> {
    // TODO: Use @ledgerhq/hw-transport-node-hid to detect device
    // const transport = await TransportNodeHid.open();
    // const eth = new AppEth(transport);
    // const result = await eth.getAddress(derivationPath);
    // return new LedgerSigner(result.address as Address, derivationPath);
    throw new Error(
      "LedgerSigner.detect() is not yet implemented. Install @ledgerhq dependencies.",
    );
  }
}
