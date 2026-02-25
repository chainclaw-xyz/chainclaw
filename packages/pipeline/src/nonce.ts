import { getLogger } from "@chainclaw/core";
import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
  type Chain,
} from "viem";
import { mainnet, base, arbitrum, optimism, polygon, bsc, avalanche, zkSync, scroll, blast, gnosis, linea, fantom, mantle } from "viem/chains";

const logger = getLogger("nonce-manager");

const viemChains: Record<number, Chain> = { 1: mainnet, 8453: base, 42161: arbitrum, 10: optimism, 137: polygon, 56: bsc, 43114: avalanche, 324: zkSync, 534352: scroll, 81457: blast, 100: gnosis, 59144: linea, 250: fantom, 5000: mantle };

export class NonceManager {
  private nonces: Map<string, number> = new Map(); // "chainId:address" → nonce
  private clients: Map<number, PublicClient> = new Map();

  constructor(rpcOverrides?: Record<number, string>) {
    for (const [chainId, chain] of Object.entries(viemChains)) {
      const client = createPublicClient({
        chain,
        transport: http(rpcOverrides?.[Number(chainId)]),
      });
      this.clients.set(Number(chainId), client);
    }
  }

  private key(chainId: number, address: Address): string {
    return `${chainId}:${address.toLowerCase()}`;
  }

  async getNonce(chainId: number, address: Address): Promise<number> {
    const k = this.key(chainId, address);
    const cached = this.nonces.get(k);

    if (cached !== undefined) {
      return cached;
    }

    const client = this.clients.get(chainId);
    if (!client) throw new Error(`No client for chain ${chainId}`);

    const onChainNonce = await client.getTransactionCount({ address });
    this.nonces.set(k, onChainNonce);

    logger.debug({ chainId, address, nonce: onChainNonce }, "Fetched nonce");
    return onChainNonce;
  }

  increment(chainId: number, address: Address): void {
    const k = this.key(chainId, address);
    const current = this.nonces.get(k) ?? 0;
    this.nonces.set(k, current + 1);
  }

  reset(chainId: number, address: Address): void {
    this.nonces.delete(this.key(chainId, address));
  }
}
