import type { Config } from "@chainclaw/core";
import { getLogger, type PortfolioSummary, type TokenBalance } from "@chainclaw/core";
import { type ChainAdapter, createChainAdapter } from "./adapter.js";
import { createSolanaAdapter } from "./solana-adapter.js";
import { getChainInfo } from "./registry.js";

const logger = getLogger("chain-manager");

// EVM chain IDs that have viem adapters
const EVM_CHAIN_IDS = [1, 8453, 42161, 10];

export class ChainManager {
  private adapters: Map<number, ChainAdapter> = new Map();

  constructor(config: Config) {
    // Initialize EVM adapters with configured RPCs
    const rpcOverrides: Record<number, string> = {
      1: config.ethRpcUrl,
      8453: config.baseRpcUrl,
      42161: config.arbitrumRpcUrl,
      10: config.optimismRpcUrl,
    };

    for (const chainId of EVM_CHAIN_IDS) {
      const adapter = createChainAdapter(chainId, rpcOverrides[chainId]);
      this.adapters.set(chainId, adapter);
      logger.info({ chainId, name: getChainInfo(chainId)?.name }, "Chain adapter initialized");
    }

    // Initialize Solana adapter if configured
    if (config.solanaRpcUrl) {
      const solanaAdapter = createSolanaAdapter(config.solanaRpcUrl);
      this.adapters.set(900, solanaAdapter);
      logger.info({ chainId: 900, name: "Solana" }, "Chain adapter initialized");
    }
  }

  getAdapter(chainId: number): ChainAdapter | undefined {
    return this.adapters.get(chainId);
  }

  getSupportedChains(): number[] {
    return [...this.adapters.keys()];
  }

  async getPortfolio(address: string): Promise<PortfolioSummary> {
    const chains: PortfolioSummary["chains"] = [];

    const chainPromises = [...this.adapters.entries()].map(
      async ([chainId, adapter]) => {
        const chainInfo = getChainInfo(chainId);
        if (!chainInfo) return null;

        // Skip non-EVM chains for 0x-prefixed addresses and vice versa
        const isEvmAddress = address.startsWith("0x");
        const isEvmChain = chainId !== 900;
        if (isEvmAddress !== isEvmChain) return null;

        try {
          const [nativeBalance, tokenBalances] = await Promise.all([
            adapter.getBalance(address),
            adapter.getTokenBalances(address),
          ]);

          const tokens: TokenBalance[] = [nativeBalance, ...tokenBalances];

          return {
            chainId,
            chainName: chainInfo.name,
            tokens,
          };
        } catch (err) {
          logger.error({ chainId, err }, "Failed to fetch portfolio for chain");
          return {
            chainId,
            chainName: chainInfo.name,
            tokens: [],
          };
        }
      },
    );

    const results = await Promise.all(chainPromises);
    for (const result of results) {
      if (result) chains.push(result);
    }

    return { address, chains };
  }
}
