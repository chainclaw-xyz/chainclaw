import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { HistoricalDataProvider } from "../historical-data.js";
import { BacktestEngine } from "../backtest-engine.js";
import { createSampleDcaAgent } from "../samples/dca-agent.js";

// Mock fetch globally
const mockFetch = vi.fn();

// Mock @chainclaw/core logger
vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("BacktestEngine", () => {
  let db: Database.Database;
  let dataProvider: HistoricalDataProvider;
  let engine: BacktestEngine;

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    dataProvider = new HistoricalDataProvider(db);
    engine = new BacktestEngine(dataProvider);
  });

  afterEach(() => {
    db.close();
  });

  it("runs a backtest with stablecoin (no API call needed)", async () => {
    const agent = createSampleDcaAgent({
      targetToken: "USDC",
      amountPerBuy: 100,
    });

    const startDate = new Date("2024-06-01");
    const endDate = new Date("2024-06-10");

    const result = await engine.run({
      agentDefinition: agent,
      startDate,
      endDate,
      startingCapitalUsd: 10000,
      feePercent: 0.3,
      slippagePercent: 0.5,
    });

    expect(result.config.agentName).toBe("sample-dca");
    expect(result.equityCurve.length).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics).toBeDefined();
  });

  it("runs a backtest with cached historical data", async () => {
    // Pre-populate the cache with historical ETH data
    const startTs = Math.floor(new Date("2024-06-01").getTime() / 1000);
    const insertStmt = db.prepare(
      "INSERT INTO historical_prices (token, timestamp, price) VALUES (?, ?, ?)",
    );

    // Insert 30 daily prices
    for (let i = 0; i < 30; i++) {
      const ts = startTs + i * 86400;
      const price = 3000 + Math.sin(i / 5) * 200; // oscillating price
      insertStmt.run("ETH", ts, price);
    }

    const agent = createSampleDcaAgent({ amountPerBuy: 100 });

    const result = await engine.run({
      agentDefinition: agent,
      startDate: new Date("2024-06-01"),
      endDate: new Date("2024-06-30"),
      startingCapitalUsd: 10000,
      feePercent: 0.3,
      slippagePercent: 0.5,
      benchmarkToken: "ETH",
    });

    expect(result.metrics.totalTrades).toBeGreaterThan(0);
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.metrics.totalReturnPercent).toBeDefined();
    expect(result.metrics.benchmarkReturnPercent).toBeDefined();

    // Verify trades have expected structure
    for (const trade of result.trades) {
      expect(trade.action).toBe("buy");
      expect(trade.token).toBe("ETH");
      expect(trade.status).toBe("executed");
    }
  });

  it("formatReport produces readable output", async () => {
    // Pre-populate cache
    const startTs = Math.floor(new Date("2024-01-01").getTime() / 1000);
    const insertStmt = db.prepare(
      "INSERT INTO historical_prices (token, timestamp, price) VALUES (?, ?, ?)",
    );
    for (let i = 0; i < 10; i++) {
      insertStmt.run("ETH", startTs + i * 86400, 2500 + i * 10);
    }

    const agent = createSampleDcaAgent();
    const result = await engine.run({
      agentDefinition: agent,
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-01-10"),
      startingCapitalUsd: 5000,
      feePercent: 0.3,
      slippagePercent: 0.5,
      benchmarkToken: "ETH",
    });

    const report = engine.formatReport(result);

    expect(report).toContain("Backtest Report: sample-dca");
    expect(report).toContain("Starting capital: $5,000");
    expect(report).toContain("Total return:");
    expect(report).toContain("Max drawdown:");
    expect(report).toContain("Sharpe ratio:");
    expect(report).toContain("Win rate:");
  });
});
