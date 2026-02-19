import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { OutcomeLabeler } from "../outcome-labeler.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function seedTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_instances (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      mode TEXT NOT NULL DEFAULT 'dry_run',
      config_json TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      stopped_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_trades (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('buy', 'sell')),
      token TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      price_at_execution REAL NOT NULL,
      chain_id INTEGER NOT NULL,
      reasoning TEXT NOT NULL,
      signals_json TEXT NOT NULL DEFAULT '[]',
      tx_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'executed', 'failed')),
      pnl_usd REAL
    );

    CREATE TABLE IF NOT EXISTS reasoning_traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      context_json TEXT NOT NULL,
      decisions_json TEXT NOT NULL,
      reasoning TEXT NOT NULL
    );
  `);
}

function insertAgent(db: Database.Database, id: string): void {
  db.prepare(
    "INSERT INTO agent_instances (id, name, version, user_id, mode, config_json) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, "test-agent", "1.0.0", "user-1", "dry_run", "{}");
}

function insertTrade(
  db: Database.Database,
  id: string,
  agentId: string,
  token: string,
  action: "buy" | "sell",
  amountUsd: number,
  priceAtExecution: number,
  timestamp: number,
): void {
  db.prepare(
    `INSERT INTO agent_trades (id, agent_id, timestamp, action, token, amount_usd, price_at_execution, chain_id, reasoning, signals_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, agentId, timestamp, action, token, amountUsd, priceAtExecution, 1, "test reasoning", "[]", "executed");
}

describe("OutcomeLabeler", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    seedTables(db);
    insertAgent(db, "agent-1");
  });

  afterEach(() => {
    db.close();
  });

  it("initializes outcome_labels table", () => {
    const fetchPrice = vi.fn();
    new OutcomeLabeler(db, fetchPrice);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='outcome_labels'",
    ).get();
    expect(tables).toBeDefined();
  });

  it("labels a buy trade correctly", () => {
    const fetchPrice = vi.fn();
    const labeler = new OutcomeLabeler(db, fetchPrice);

    const trade = {
      id: "trade-1",
      agentId: "agent-1",
      timestamp: 1700000000,
      action: "buy" as const,
      token: "ETH",
      amountUsd: 100,
      priceAtExecution: 2000,
      chainId: 1,
      reasoning: "bullish",
      signals: [],
      status: "executed" as const,
    };

    // Price went up 10% → $2200
    labeler.labelTrade(trade, "24h", 2200);

    const labels = labeler.getLabelsForTrade("trade-1");
    expect(labels).toHaveLength(1);
    expect(labels[0]!.pnl_usd).toBeCloseTo(10); // 10% of $100
    expect(labels[0]!.pnl_percent).toBeCloseTo(10);
    expect(labels[0]!.window).toBe("24h");
  });

  it("labels a sell trade correctly (inverted PnL)", () => {
    const fetchPrice = vi.fn();
    const labeler = new OutcomeLabeler(db, fetchPrice);

    const trade = {
      id: "trade-2",
      agentId: "agent-1",
      timestamp: 1700000000,
      action: "sell" as const,
      token: "ETH",
      amountUsd: 100,
      priceAtExecution: 2000,
      chainId: 1,
      reasoning: "bearish",
      signals: [],
      status: "executed" as const,
    };

    // Price went up 10% → sell was wrong
    labeler.labelTrade(trade, "24h", 2200);

    const labels = labeler.getLabelsForTrade("trade-2");
    expect(labels).toHaveLength(1);
    expect(labels[0]!.pnl_usd).toBeCloseTo(-10); // Sell + price up = loss
    expect(labels[0]!.pnl_percent).toBeCloseTo(-10);
  });

  it("updates agent_trades.pnl_usd for 24h window", () => {
    insertTrade(db, "trade-3", "agent-1", "ETH", "buy", 100, 2000, 1700000000);

    const fetchPrice = vi.fn();
    const labeler = new OutcomeLabeler(db, fetchPrice);

    const trade = {
      id: "trade-3",
      agentId: "agent-1",
      timestamp: 1700000000,
      action: "buy" as const,
      token: "ETH",
      amountUsd: 100,
      priceAtExecution: 2000,
      chainId: 1,
      reasoning: "bullish",
      signals: [],
      status: "executed" as const,
    };

    labeler.labelTrade(trade, "24h", 2100);

    const row = db.prepare("SELECT pnl_usd FROM agent_trades WHERE id = ?").get("trade-3") as { pnl_usd: number };
    expect(row.pnl_usd).toBeCloseTo(5); // 5% of $100
  });

  it("does not update agent_trades.pnl_usd for 1h window", () => {
    insertTrade(db, "trade-4", "agent-1", "ETH", "buy", 100, 2000, 1700000000);

    const fetchPrice = vi.fn();
    const labeler = new OutcomeLabeler(db, fetchPrice);

    const trade = {
      id: "trade-4",
      agentId: "agent-1",
      timestamp: 1700000000,
      action: "buy" as const,
      token: "ETH",
      amountUsd: 100,
      priceAtExecution: 2000,
      chainId: 1,
      reasoning: "test",
      signals: [],
      status: "executed" as const,
    };

    labeler.labelTrade(trade, "1h", 2100);

    const row = db.prepare("SELECT pnl_usd FROM agent_trades WHERE id = ?").get("trade-4") as { pnl_usd: number | null };
    expect(row.pnl_usd).toBeNull();
  });

  it("is idempotent (does not re-label same trade+window)", () => {
    const fetchPrice = vi.fn();
    const labeler = new OutcomeLabeler(db, fetchPrice);

    const trade = {
      id: "trade-5",
      agentId: "agent-1",
      timestamp: 1700000000,
      action: "buy" as const,
      token: "ETH",
      amountUsd: 100,
      priceAtExecution: 2000,
      chainId: 1,
      reasoning: "test",
      signals: [],
      status: "executed" as const,
    };

    labeler.labelTrade(trade, "24h", 2200);
    labeler.labelTrade(trade, "24h", 2400); // Should be ignored (INSERT OR IGNORE)

    const labels = labeler.getLabelsForTrade("trade-5");
    expect(labels).toHaveLength(1);
    expect(labels[0]!.pnl_usd).toBeCloseTo(10); // First label preserved
  });

  it("labels multiple windows for same trade", () => {
    const fetchPrice = vi.fn();
    const labeler = new OutcomeLabeler(db, fetchPrice);

    const trade = {
      id: "trade-6",
      agentId: "agent-1",
      timestamp: 1700000000,
      action: "buy" as const,
      token: "ETH",
      amountUsd: 100,
      priceAtExecution: 2000,
      chainId: 1,
      reasoning: "test",
      signals: [],
      status: "executed" as const,
    };

    labeler.labelTrade(trade, "1h", 2050);
    labeler.labelTrade(trade, "24h", 2200);
    labeler.labelTrade(trade, "7d", 2400);

    const labels = labeler.getLabelsForTrade("trade-6");
    expect(labels).toHaveLength(3);
  });

  it("labelPendingTrades processes only trades old enough for window", async () => {
    const now = Date.now();
    const twoHoursAgo = Math.floor((now - 2 * 60 * 60 * 1000) / 1000);
    const twoDaysAgo = Math.floor((now - 2 * 24 * 60 * 60 * 1000) / 1000);

    insertTrade(db, "recent-trade", "agent-1", "ETH", "buy", 100, 2000, twoHoursAgo);
    insertTrade(db, "old-trade", "agent-1", "BTC", "buy", 200, 40000, twoDaysAgo);

    const fetchPrice = vi.fn().mockResolvedValue(2100);
    const labeler = new OutcomeLabeler(db, fetchPrice);

    const stats = await labeler.labelPendingTrades();

    // recent-trade: eligible for 1h (2 hours > 1h), not yet for 24h or 7d
    // old-trade: eligible for 1h and 24h, not yet for 7d
    expect(stats.labeled).toBeGreaterThan(0);

    const recentLabels = labeler.getLabelsForTrade("recent-trade");
    const oldLabels = labeler.getLabelsForTrade("old-trade");

    // recent: should have 1h label only
    expect(recentLabels.some((l) => l.window === "1h")).toBe(true);
    expect(recentLabels.some((l) => l.window === "7d")).toBe(false);

    // old: should have 1h and 24h labels
    expect(oldLabels.some((l) => l.window === "1h")).toBe(true);
    expect(oldLabels.some((l) => l.window === "24h")).toBe(true);
    expect(oldLabels.some((l) => l.window === "7d")).toBe(false);
  });

  it("skips trades when price is unavailable", async () => {
    const oneHourAgo = Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000);
    insertTrade(db, "no-price-trade", "agent-1", "OBSCURE", "buy", 50, 10, oneHourAgo);

    const fetchPrice = vi.fn().mockResolvedValue(null);
    const labeler = new OutcomeLabeler(db, fetchPrice);

    const stats = await labeler.labelPendingTrades();

    expect(stats.skipped).toBeGreaterThan(0);
    expect(stats.labeled).toBe(0);
  });

  it("tracks cumulative stats", async () => {
    const twoHoursAgo = Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000);
    insertTrade(db, "stats-trade", "agent-1", "ETH", "buy", 100, 2000, twoHoursAgo);

    const fetchPrice = vi.fn().mockResolvedValue(2100);
    const labeler = new OutcomeLabeler(db, fetchPrice);

    await labeler.labelPendingTrades();
    const stats = labeler.getStats();

    expect(stats.processed).toBeGreaterThan(0);
    expect(stats.labeled).toBeGreaterThan(0);
  });
});
