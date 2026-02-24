import {
  createWalletClient,
  http,
  type Address,
  type Hash,
  type Chain,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { mainnet, base, arbitrum, optimism } from "viem/chains";
import type { Signer, SignerTransactionParams } from "../signer.js";

const viemChains: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
};

export class LocalSigner implements Signer {
  readonly type = "local" as const;
  readonly isAutomatic = true;
  readonly address: Address;

  private account: PrivateKeyAccount;
  private rpcOverrides: Record<number, string>;

  constructor(account: PrivateKeyAccount, rpcOverrides?: Record<number, string>) {
    this.account = account;
    this.address = account.address;
    this.rpcOverrides = rpcOverrides ?? {};
  }

  async sendTransaction(params: SignerTransactionParams): Promise<Hash> {
    const chain = viemChains[params.chainId];
    if (!chain) throw new Error(`Unsupported chain: ${params.chainId}`);

    const rpcUrl = params.rpcUrl ?? this.rpcOverrides[params.chainId];

    const walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(rpcUrl),
    });

    return walletClient.sendTransaction({
      to: params.to,
      value: params.value,
      data: params.data,
      gas: params.gas,
      maxFeePerGas: params.maxFeePerGas,
      maxPriorityFeePerGas: params.maxPriorityFeePerGas,
      nonce: params.nonce,
    });
  }
}
