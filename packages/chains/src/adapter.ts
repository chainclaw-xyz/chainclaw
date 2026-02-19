import {
  createPublicClient,
  http,
  formatEther,
  formatUnits,
  type PublicClient,
  type Address,
  type Chain,
  erc20Abi,
} from "viem";
import { mainnet, base, arbitrum, optimism } from "viem/chains";
import { getLogger, type TokenBalance } from "@chainclaw/core";

const logger = getLogger("chains");

// Known tokens per chain for balance lookups
const KNOWN_TOKENS: Record<number, { address: Address; symbol: string; name: string; decimals: number }[]> = {
  1: [
    { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", name: "Tether USD", decimals: 6 },
    { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
  ],
  8453: [
    { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
  ],
  42161: [
    { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", symbol: "USDT", name: "Tether USD", decimals: 6 },
    { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
    { address: "0x912CE59144191C1204E64559FE8253a0e49E6548", symbol: "ARB", name: "Arbitrum", decimals: 18 },
  ],
  10: [
    { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", symbol: "USDT", name: "Tether USD", decimals: 6 },
    { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
    { address: "0x4200000000000000000000000000000000000042", symbol: "OP", name: "Optimism", decimals: 18 },
  ],
};

const viemChains: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
};

export interface ChainAdapter {
  chainId: number;
  getBalance(address: string): Promise<TokenBalance>;
  getTokenBalances(address: string): Promise<TokenBalance[]>;
  getGasPrice(): Promise<bigint>;
  getBlockNumber(): Promise<bigint>;
}

export function createChainAdapter(
  chainId: number,
  rpcUrl?: string,
): ChainAdapter {
  const viemChain = viemChains[chainId];
  if (!viemChain) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  const client: PublicClient = createPublicClient({
    chain: viemChain,
    transport: http(rpcUrl),
  });

  return {
    chainId,

    async getBalance(address: string): Promise<TokenBalance> {
      const addr = address as Address;
      logger.debug({ chainId, address }, "Fetching native balance");
      const balance = await client.getBalance({ address: addr });
      return {
        symbol: viemChain.nativeCurrency.symbol,
        name: viemChain.nativeCurrency.name,
        address: null,
        decimals: viemChain.nativeCurrency.decimals,
        balance: balance.toString(),
        formatted: formatEther(balance),
        chainId,
      };
    },

    async getTokenBalances(address: string): Promise<TokenBalance[]> {
      const addr = address as Address;
      const tokens = KNOWN_TOKENS[chainId] ?? [];
      logger.debug({ chainId, address, tokenCount: tokens.length }, "Fetching token balances");

      const results: TokenBalance[] = [];

      // Fetch all token balances concurrently
      const balancePromises = tokens.map(async (token) => {
        try {
          const balance = await client.readContract({
            address: token.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [addr],
          });
          return {
            symbol: token.symbol,
            name: token.name,
            address: token.address,
            decimals: token.decimals,
            balance: balance.toString(),
            formatted: formatUnits(balance, token.decimals),
            chainId,
          };
        } catch (err) {
          logger.warn({ chainId, token: token.symbol, err }, "Failed to fetch token balance");
          return null;
        }
      });

      const settled = await Promise.all(balancePromises);
      for (const result of settled) {
        if (result && BigInt(result.balance) > 0n) {
          results.push(result);
        }
      }

      return results;
    },

    async getGasPrice(): Promise<bigint> {
      return client.getGasPrice();
    },

    async getBlockNumber(): Promise<bigint> {
      return client.getBlockNumber();
    },
  };
}
