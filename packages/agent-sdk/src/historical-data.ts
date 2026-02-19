import type Database from "better-sqlite3";
import { getLogger } from "@chainclaw/core";

const logger = getLogger("historical-data");

// Map of common symbols → CoinGecko IDs (same as prices.ts)
const COINGECKO_IDS: Record<string, string> = {
  ETH: "ethereum",
  WETH: "ethereum",
  BTC: "bitcoin",
  WBTC: "bitcoin",
  USDC: "usd-coin",
  USDT: "tether",
  DAI: "dai",
  LINK: "chainlink",
  UNI: "uniswap",
  AAVE: "aave",
  ARB: "arbitrum",
  OP: "optimism",
};

interface PriceRow {
  token: string;
  timestamp: number;
  price: number;
}

export class HistoricalDataProvider {
  constructor(private db: Database.Database) {
    this.initTable();
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS historical_prices (
        token TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        price REAL NOT NULL,
        PRIMARY KEY (token, timestamp)
      );

      CREATE INDEX IF NOT EXISTS idx_historical_token_ts
        ON historical_prices(token, timestamp);
    `);
    logger.debug("Historical prices table initialized");
  }

  /**
   * Fetch historical price data from CoinGecko for a date range.
   * Results are cached in SQLite to avoid redundant API calls.
   */
  async fetchRange(
    symbol: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Array<{ timestamp: number; price: number }>> {
    const upperSymbol = symbol.toUpperCase();

    // Stablecoins: return $1 for every day
    if (["USDC", "USDT", "DAI"].includes(upperSymbol)) {
      return this.generateStablePrices(startDate, endDate);
    }

    const geckoId = COINGECKO_IDS[upperSymbol];
    if (!geckoId) {
      throw new Error(`Unsupported token: ${symbol}. Supported: ${Object.keys(COINGECKO_IDS).join(", ")}`);
    }

    // Check cache first
    const startTs = Math.floor(startDate.getTime() / 1000);
    const endTs = Math.floor(endDate.getTime() / 1000);

    const cached = this.db.prepare(
      "SELECT timestamp, price FROM historical_prices WHERE token = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp",
    ).all(upperSymbol, startTs, endTs) as PriceRow[];

    // If we have reasonable coverage (at least 80% of expected daily points), use cache
    const expectedDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    if (cached.length >= expectedDays * 0.8) {
      logger.debug({ symbol: upperSymbol, points: cached.length }, "Using cached historical data");
      return cached.map((r) => ({ timestamp: r.timestamp, price: r.price }));
    }

    // Fetch from CoinGecko
    logger.info({ symbol: upperSymbol, startDate: startDate.toISOString(), endDate: endDate.toISOString() }, "Fetching historical data from CoinGecko");

    const url = `https://api.coingecko.com/api/v3/coins/${geckoId}/market_chart/range?vs_currency=usd&from=${startTs}&to=${endTs}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { prices: [number, number][] };

    if (!data.prices || data.prices.length === 0) {
      throw new Error(`No historical data available for ${symbol}`);
    }

    // Deduplicate to daily prices (CoinGecko returns multiple points per day for short ranges)
    const dailyPrices = this.deduplicateToDaily(data.prices);

    // Cache in SQLite
    const insertStmt = this.db.prepare(
      "INSERT OR REPLACE INTO historical_prices (token, timestamp, price) VALUES (?, ?, ?)",
    );

    const insertMany = this.db.transaction((prices: Array<{ timestamp: number; price: number }>) => {
      for (const p of prices) {
        insertStmt.run(upperSymbol, p.timestamp, p.price);
      }
    });

    insertMany(dailyPrices);
    logger.info({ symbol: upperSymbol, points: dailyPrices.length }, "Cached historical data");

    return dailyPrices;
  }

  /**
   * Get the price of a token at a specific timestamp.
   * Returns the closest available price point.
   */
  getPriceAt(symbol: string, timestamp: number): number | null {
    const upperSymbol = symbol.toUpperCase();

    if (["USDC", "USDT", "DAI"].includes(upperSymbol)) {
      return 1.0;
    }

    const row = this.db.prepare(
      `SELECT price FROM historical_prices
       WHERE token = ? AND timestamp <= ?
       ORDER BY timestamp DESC LIMIT 1`,
    ).get(upperSymbol, timestamp) as { price: number } | undefined;

    return row?.price ?? null;
  }

  /**
   * Get prices for multiple tokens at a specific timestamp.
   */
  getPricesAt(symbols: string[], timestamp: number): Record<string, number> {
    const prices: Record<string, number> = {};
    for (const symbol of symbols) {
      const price = this.getPriceAt(symbol, timestamp);
      if (price != null) {
        prices[symbol.toUpperCase()] = price;
      }
    }
    return prices;
  }

  private generateStablePrices(
    startDate: Date,
    endDate: Date,
  ): Array<{ timestamp: number; price: number }> {
    const prices: Array<{ timestamp: number; price: number }> = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      prices.push({
        timestamp: Math.floor(current.getTime() / 1000),
        price: 1.0,
      });
      current.setDate(current.getDate() + 1);
    }
    return prices;
  }

  /**
   * CoinGecko returns [ms_timestamp, price] arrays. For short ranges it returns
   * hourly data. We deduplicate to one price per day (using midnight UTC).
   */
  private deduplicateToDaily(
    raw: [number, number][],
  ): Array<{ timestamp: number; price: number }> {
    const dailyMap = new Map<number, number>();

    for (const [msTimestamp, price] of raw) {
      // Normalize to midnight UTC
      const date = new Date(msTimestamp);
      date.setUTCHours(0, 0, 0, 0);
      const dayTs = Math.floor(date.getTime() / 1000);

      // Keep the last price for each day (most recent = most accurate close)
      dailyMap.set(dayTs, price);
    }

    return Array.from(dailyMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([timestamp, price]) => ({ timestamp, price }));
  }
}
