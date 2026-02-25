/**
 * Controllable ChainAdapter stub factory.
 * Returns mock adapters that the ChainManager will use via vi.mock().
 */
import { vi } from "vitest";
import type { TokenBalance } from "@chainclaw/core";

export interface MockAdapterControls {
  setBalance(chainId: number, balance: TokenBalance): void;
  setTokenBalances(chainId: number, tokens: TokenBalance[]): void;
  getAdapter(chainId: number): MockChainAdapter;
}

export interface MockChainAdapter {
  chainId: number;
  getBalance: ReturnType<typeof vi.fn>;
  getTokenBalances: ReturnType<typeof vi.fn>;
  getGasPrice: ReturnType<typeof vi.fn>;
  getBlockNumber: ReturnType<typeof vi.fn>;
}

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum One",
  10: "OP Mainnet",
  137: "Polygon",
  56: "BNB Chain",
  43114: "Avalanche C-Chain",
  324: "zkSync Era",
  534352: "Scroll",
  81457: "Blast",
  100: "Gnosis",
  59144: "Linea",
  250: "Fantom",
  5000: "Mantle",
};

export function createMockAdapterControls(): MockAdapterControls {
  const adapters = new Map<number, MockChainAdapter>();

  function getOrCreate(chainId: number): MockChainAdapter {
    if (!adapters.has(chainId)) {
      const nativeSymbols: Record<number, string> = { 900: "SOL", 137: "MATIC", 56: "BNB", 43114: "AVAX", 100: "XDAI", 250: "FTM", 5000: "MNT" };
      const symbol = nativeSymbols[chainId] ?? "ETH";
      const name = chainId === 900 ? "Solana" : (CHAIN_NAMES[chainId] ?? "Unknown");
      const decimals = chainId === 900 ? 9 : 18;

      adapters.set(chainId, {
        chainId,
        getBalance: vi.fn().mockResolvedValue({
          symbol,
          name: name === "Ethereum" ? "Ether" : name,
          address: null,
          decimals,
          balance: "0",
          formatted: "0.0",
          chainId,
        }),
        getTokenBalances: vi.fn().mockResolvedValue([]),
        getGasPrice: vi.fn().mockResolvedValue(BigInt("30000000000")),
        getBlockNumber: vi.fn().mockResolvedValue(BigInt("19000000")),
      });
    }
    return adapters.get(chainId)!;
  }

  return {
    setBalance(chainId: number, balance: TokenBalance): void {
      getOrCreate(chainId).getBalance.mockResolvedValue(balance);
    },

    setTokenBalances(chainId: number, tokens: TokenBalance[]): void {
      getOrCreate(chainId).getTokenBalances.mockResolvedValue(tokens);
    },

    getAdapter(chainId: number): MockChainAdapter {
      return getOrCreate(chainId);
    },
  };
}
