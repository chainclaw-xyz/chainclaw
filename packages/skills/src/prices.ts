import { getLogger, fetchWithRetry } from "@chainclaw/core";

const logger = getLogger("prices");

interface CoinGeckoResponse {
  [id: string]: { usd: number };
}

// Map of common symbols → CoinGecko IDs
const COINGECKO_IDS: Record<string, string> = {
  ETH: "ethereum",
  WETH: "ethereum",
  BTC: "bitcoin",
  WBTC: "bitcoin",
  SOL: "solana",
  WSOL: "solana",
  USDC: "usd-coin",
  USDT: "tether",
  DAI: "dai",
  LINK: "chainlink",
  UNI: "uniswap",
  AAVE: "aave",
  ARB: "arbitrum",
  OP: "optimism",
  JUP: "jupiter-exchange-solana",
  BONK: "bonk",
  PYTH: "pyth-network",
  RAY: "raydium",
  ORCA: "orca",
};

// Simple in-memory cache with TTL
const priceCache: Map<string, { price: number; expiresAt: number }> = new Map();
const CACHE_TTL_MS = 60_000; // 1 minute

export async function getTokenPrice(symbol: string): Promise<number | null> {
  const upperSymbol = symbol.toUpperCase();

  // Stablecoins are ~$1
  if (["USDC", "USDT", "DAI"].includes(upperSymbol)) {
    return 1.0;
  }

  // Check cache
  const cached = priceCache.get(upperSymbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.price;
  }

  const geckoId = COINGECKO_IDS[upperSymbol];
  if (!geckoId) {
    logger.warn({ symbol }, "No CoinGecko ID for symbol");
    return null;
  }

  try {
    const response = await fetchWithRetry(
      `https://api.coingecko.com/api/v3/simple/price?ids=${geckoId}&vs_currencies=usd`,
    );

    if (!response.ok) {
      logger.warn({ status: response.status, symbol }, "CoinGecko API error");
      return null;
    }

    const data = (await response.json()) as CoinGeckoResponse;
    const price = data[geckoId]?.usd;

    if (price != null) {
      priceCache.set(upperSymbol, { price, expiresAt: Date.now() + CACHE_TTL_MS });
      logger.debug({ symbol, price }, "Price fetched");
      return price;
    }

    return null;
  } catch (err) {
    logger.error({ err, symbol }, "Failed to fetch price");
    return null;
  }
}

export async function getEthPriceUsd(): Promise<number> {
  const price = await getTokenPrice("ETH");
  return price ?? 2500; // fallback
}

export async function getSolPriceUsd(): Promise<number> {
  const price = await getTokenPrice("SOL");
  return price ?? 150; // fallback
}
