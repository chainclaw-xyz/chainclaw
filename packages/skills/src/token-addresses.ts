import type { Address } from "viem";

export interface TokenInfo {
  address: Address;
  decimals: number;
}

// Merged superset of all token addresses across swap, dca, and bridge skills
export const TOKEN_INFO: Record<number, Record<string, TokenInfo>> = {
  1: {
    ETH: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
    DAI: { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
  },
  8453: {
    ETH: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    DAI: { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
  },
  42161: {
    ETH: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    USDT: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
    WETH: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
    DAI: { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 },
    ARB: { address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18 },
  },
  10: {
    ETH: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
    USDT: { address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
    WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    DAI: { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 },
    OP: { address: "0x4200000000000000000000000000000000000042", decimals: 18 },
  },
  137: {
    MATIC: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
    USDT: { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
    WETH: { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18 },
    DAI: { address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", decimals: 18 },
    WMATIC: { address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", decimals: 18 },
  },
  56: {
    BNB: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
    USDT: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
    WETH: { address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18 },
    DAI: { address: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3", decimals: 18 },
    WBNB: { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18 },
  },
  43114: {
    AVAX: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6 },
    USDT: { address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6 },
    WETH: { address: "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", decimals: 18 },
    DAI: { address: "0xd586E7F844cEa2F87f50152665BCbc2C279D8d70", decimals: 18 },
    WAVAX: { address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", decimals: 18 },
  },
  324: {
    ETH: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4", decimals: 6 },
    USDT: { address: "0x493257fD37EDB34451f62EDf8D2a0C418852bA4C", decimals: 6 },
    WETH: { address: "0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91", decimals: 18 },
  },
  534352: {
    ETH: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4", decimals: 6 },
    USDT: { address: "0xf55BEC9cafDbE8730f096Aa55dad6D22d44099Df", decimals: 6 },
    WETH: { address: "0x5300000000000000000000000000000000000004", decimals: 18 },
  },
  81457: {
    ETH: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDB: { address: "0x4300000000000000000000000000000000000003", decimals: 18 },
    WETH: { address: "0x4300000000000000000000000000000000000004", decimals: 18 },
  },
  100: {
    XDAI: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83", decimals: 6 },
    USDT: { address: "0x4ECaBa5870353805a9F068101A40E0f32ed605C6", decimals: 6 },
    WETH: { address: "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1", decimals: 18 },
    WXDAI: { address: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d", decimals: 18 },
    GNO: { address: "0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb", decimals: 18 },
  },
  59144: {
    ETH: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff", decimals: 6 },
    USDT: { address: "0xA219439258ca9da29E9Cc4cE5596924745e12B93", decimals: 6 },
    WETH: { address: "0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f", decimals: 18 },
    DAI: { address: "0x4AF15ec2A0BD43Db75dd04E62FAA3B8EF36b00d5", decimals: 18 },
  },
  250: {
    FTM: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0x04068DA6C83AFCFA0e13ba15A6696662335D5B75", decimals: 6 },
    fUSDT: { address: "0x049d68029688eAbF473097a2fC38ef61633A3C7A", decimals: 6 },
    WETH: { address: "0x74b23882a30290451A17c44f4F05243b6b58C76d", decimals: 18 },
    DAI: { address: "0x8D11eC38a3EB5E956B052f67Da8Bdc9bef8Abf3E", decimals: 18 },
    WFTM: { address: "0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83", decimals: 18 },
  },
  5000: {
    MNT: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0x09Bc4E0D10C00CCaBc6EB90B4A4F81e99aa11E3C", decimals: 6 },
    USDT: { address: "0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE", decimals: 6 },
    WETH: { address: "0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111", decimals: 18 },
    WMNT: { address: "0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8", decimals: 18 },
  },
};

export const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum",
  10: "Optimism",
  137: "Polygon",
  56: "BNB Chain",
  43114: "Avalanche",
  324: "zkSync Era",
  534352: "Scroll",
  81457: "Blast",
  100: "Gnosis",
  59144: "Linea",
  250: "Fantom",
  5000: "Mantle",
};

// Native token address used by Li.Fi (different format from 1inch)
export const LIFI_NATIVE_TOKEN = "0x0000000000000000000000000000000000000000" as Address;

export function resolveToken(chainId: number, symbol: string): TokenInfo | undefined {
  return TOKEN_INFO[chainId]?.[symbol.toUpperCase()];
}

export function getChainName(chainId: number): string {
  return CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
}
