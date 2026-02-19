import type { ChainInfo } from "@chainclaw/core";

export const CHAIN_REGISTRY: Record<number, ChainInfo> = {
  1: {
    id: 1,
    name: "Ethereum Mainnet",
    shortName: "ETH",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://eth.llamarpc.com"],
    blockExplorerUrl: "https://etherscan.io",
  },
  8453: {
    id: 8453,
    name: "Base",
    shortName: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorerUrl: "https://basescan.org",
  },
  42161: {
    id: 42161,
    name: "Arbitrum One",
    shortName: "ARB",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
    blockExplorerUrl: "https://arbiscan.io",
  },
  10: {
    id: 10,
    name: "Optimism",
    shortName: "OP",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.optimism.io"],
    blockExplorerUrl: "https://optimistic.etherscan.io",
  },
  900: {
    id: 900,
    name: "Solana",
    shortName: "SOL",
    nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
    rpcUrls: ["https://api.mainnet-beta.solana.com"],
    blockExplorerUrl: "https://solscan.io",
  },
};

export function getChainInfo(chainId: number): ChainInfo | undefined {
  return CHAIN_REGISTRY[chainId];
}

export function getSupportedChainIds(): number[] {
  return Object.keys(CHAIN_REGISTRY).map(Number);
}
