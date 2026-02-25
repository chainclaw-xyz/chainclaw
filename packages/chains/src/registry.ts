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
  137: {
    id: 137,
    name: "Polygon",
    shortName: "MATIC",
    nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
    rpcUrls: ["https://polygon-rpc.com"],
    blockExplorerUrl: "https://polygonscan.com",
  },
  56: {
    id: 56,
    name: "BNB Chain",
    shortName: "BNB",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: ["https://bsc-dataseed1.bnbchain.org"],
    blockExplorerUrl: "https://bscscan.com",
  },
  43114: {
    id: 43114,
    name: "Avalanche C-Chain",
    shortName: "AVAX",
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    rpcUrls: ["https://api.avax.network/ext/bc/C/rpc"],
    blockExplorerUrl: "https://snowtrace.io",
  },
  324: {
    id: 324,
    name: "zkSync Era",
    shortName: "zkSync",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.era.zksync.io"],
    blockExplorerUrl: "https://explorer.zksync.io",
  },
  534352: {
    id: 534352,
    name: "Scroll",
    shortName: "Scroll",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://rpc.scroll.io"],
    blockExplorerUrl: "https://scrollscan.com",
  },
  81457: {
    id: 81457,
    name: "Blast",
    shortName: "Blast",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://rpc.blast.io"],
    blockExplorerUrl: "https://blastscan.io",
  },
  100: {
    id: 100,
    name: "Gnosis",
    shortName: "GNO",
    nativeCurrency: { name: "xDAI", symbol: "XDAI", decimals: 18 },
    rpcUrls: ["https://rpc.gnosischain.com"],
    blockExplorerUrl: "https://gnosisscan.io",
  },
  59144: {
    id: 59144,
    name: "Linea",
    shortName: "Linea",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://rpc.linea.build"],
    blockExplorerUrl: "https://lineascan.build",
  },
  250: {
    id: 250,
    name: "Fantom",
    shortName: "FTM",
    nativeCurrency: { name: "Fantom", symbol: "FTM", decimals: 18 },
    rpcUrls: ["https://rpc.ftm.tools"],
    blockExplorerUrl: "https://ftmscan.com",
  },
  5000: {
    id: 5000,
    name: "Mantle",
    shortName: "MNT",
    nativeCurrency: { name: "Mantle", symbol: "MNT", decimals: 18 },
    rpcUrls: ["https://rpc.mantle.xyz"],
    blockExplorerUrl: "https://mantlescan.xyz",
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
