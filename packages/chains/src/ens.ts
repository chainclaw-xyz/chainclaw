import {
  createPublicClient,
  http,
  getAddress,
  type PublicClient,
  type Address,
} from "viem";
import { normalize } from "viem/ens";
import { mainnet } from "viem/chains";
import { getLogger } from "@chainclaw/core";

const logger = getLogger("ens-resolver");

interface CacheEntry {
  address: Address;
  expiresAt: number;
}

/**
 * Resolves ENS names to addresses via L1 Ethereum mainnet.
 * Supports CCIP-Read (ERC-3668) for L2 subdomains like name.base.eth.
 * Results are cached with a configurable TTL.
 */
export class EnsResolver {
  private client: PublicClient | null = null;
  private readonly ethRpcUrl?: string;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ethRpcUrl?: string, opts?: { ttlMs?: number; maxEntries?: number }) {
    this.ethRpcUrl = ethRpcUrl;
    this.ttlMs = opts?.ttlMs ?? 300_000; // 5 minutes
    this.maxEntries = opts?.maxEntries ?? 500;
  }

  private getClient(): PublicClient {
    if (!this.client) {
      this.client = createPublicClient({
        chain: mainnet,
        transport: http(this.ethRpcUrl),
      });
    }
    return this.client;
  }

  /**
   * Check if an input string looks like an ENS name (ends with .eth).
   */
  isEnsName(input: string): boolean {
    return /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?\.eth$/i.test(input);
  }

  /**
   * Resolve a name-or-address to a checksummed 0x address.
   * - If input is a 0x address, returns it checksummed.
   * - If input is an ENS name (*.eth), resolves via L1 mainnet.
   * - Otherwise throws.
   */
  async resolve(nameOrAddress: string): Promise<Address> {
    // Raw 0x address — return checksummed
    if (/^0x[a-fA-F0-9]{40}$/i.test(nameOrAddress)) {
      return getAddress(nameOrAddress);
    }

    // Must be an ENS name
    if (!this.isEnsName(nameOrAddress)) {
      throw new Error(`Invalid address or ENS name: ${nameOrAddress}`);
    }

    // Check cache
    const key = nameOrAddress.toLowerCase();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      // Move to end for LRU ordering
      this.cache.delete(key);
      this.cache.set(key, cached);
      logger.debug({ name: nameOrAddress }, "ENS cache hit");
      return cached.address;
    }

    // Remove stale entry so it doesn't consume a cache slot
    if (cached) this.cache.delete(key);

    // Resolve via mainnet (handles CCIP-Read for L2 subdomains)
    logger.debug({ name: nameOrAddress }, "Resolving ENS name");
    const normalized = normalize(nameOrAddress);
    const address = await this.getClient().getEnsAddress({ name: normalized });

    if (!address) {
      throw new Error(`ENS name '${nameOrAddress}' did not resolve to an address`);
    }

    const checksummed = getAddress(address);

    // Cache result (evict LRU entry if at capacity)
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { address: checksummed, expiresAt: Date.now() + this.ttlMs });

    logger.info({ name: nameOrAddress, address: checksummed }, "ENS name resolved");
    return checksummed;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
