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
import { mainnet, base, arbitrum, optimism, polygon, bsc, avalanche, zkSync, scroll, blast, gnosis, linea, fantom, mantle } from "viem/chains";
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
  137: [
    { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", symbol: "USDT", name: "Tether USD", decimals: 6 },
    { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    { address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
    { address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", symbol: "WMATIC", name: "Wrapped MATIC", decimals: 18 },
  ],
  56: [
    { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", symbol: "USDC", name: "USD Coin", decimals: 18 },
    { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT", name: "Tether USD", decimals: 18 },
    { address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    { address: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3", symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
    { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", symbol: "WBNB", name: "Wrapped BNB", decimals: 18 },
  ],
  43114: [
    { address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", symbol: "USDT", name: "Tether USD", decimals: 6 },
    { address: "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    { address: "0xd586E7F844cEa2F87f50152665BCbc2C279D8d70", symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
    { address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", symbol: "WAVAX", name: "Wrapped AVAX", decimals: 18 },
  ],
  324: [
    { address: "0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0x493257fD37EDB34451f62EDf8D2a0C418852bA4C", symbol: "USDT", name: "Tether USD", decimals: 6 },
    { address: "0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
  ],
  534352: [
    { address: "0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0xf55BEC9cafDbE8730f096Aa55dad6D22d44099Df", symbol: "USDT", name: "Tether USD", decimals: 6 },
    { address: "0x5300000000000000000000000000000000000004", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
  ],
  81457: [
    { address: "0x4300000000000000000000000000000000000003", symbol: "USDB", name: "USDB", decimals: 18 },
    { address: "0x4300000000000000000000000000000000000004", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
  ],
  100: [
    { address: "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0x4ECaBa5870353805a9F068101A40E0f32ed605C6", symbol: "USDT", name: "Tether USD", decimals: 6 },
    { address: "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    { address: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d", symbol: "WXDAI", name: "Wrapped xDAI", decimals: 18 },
    { address: "0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb", symbol: "GNO", name: "Gnosis Token", decimals: 18 },
  ],
  59144: [
    { address: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0xA219439258ca9da29E9Cc4cE5596924745e12B93", symbol: "USDT", name: "Tether USD", decimals: 6 },
    { address: "0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    { address: "0x4AF15ec2A0BD43Db75dd04E62FAA3B8EF36b00d5", symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
  ],
  250: [
    { address: "0x04068DA6C83AFCFA0e13ba15A6696662335D5B75", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0x049d68029688eAbF473097a2fC38ef61633A3C7A", symbol: "fUSDT", name: "Frapped USDT", decimals: 6 },
    { address: "0x74b23882a30290451A17c44f4F05243b6b58C76d", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    { address: "0x8D11eC38a3EB5E956B052f67Da8Bdc9bef8Abf3E", symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
    { address: "0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83", symbol: "WFTM", name: "Wrapped FTM", decimals: 18 },
  ],
  5000: [
    { address: "0x09Bc4E0D10C00CCaBc6EB90B4A4F81e99aa11E3C", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE", symbol: "USDT", name: "Tether USD", decimals: 6 },
    { address: "0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    { address: "0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8", symbol: "WMNT", name: "Wrapped MNT", decimals: 18 },
  ],
};

const viemChains: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
  137: polygon,
  56: bsc,
  43114: avalanche,
  324: zkSync,
  534352: scroll,
  81457: blast,
  100: gnosis,
  59144: linea,
  250: fantom,
  5000: mantle,
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
