import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { computeMetrics, formatReport } from "../performance-reviewer.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");

  // Create tx_log table (same schema as guardrails creates)
  db.exec(`
    CREATE TABLE tx_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      from_addr TEXT NOT NULL,
      to_addr TEXT NOT NULL,
      value TEXT NOT NULL,
      hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      skill_name TEXT NOT NULL DEFAULT '',
      intent_description TEXT NOT NULL DEFAULT '',
      simulation_result TEXT,
      guardrail_checks TEXT,
      gas_used TEXT,
      gas_price TEXT,
      gas_cost_usd REAL,
      block_number INTEGER,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tx_log_user ON tx_log(user_id, created_at);

    CREATE TABLE agent_trades (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      action TEXT NOT NULL,
      token TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      price_at_execution REAL NOT NULL,
      chain_id INTEGER NOT NULL,
      reasoning TEXT NOT NULL DEFAULT '',
      signals_json TEXT NOT NULL DEFAULT '[]',
      tx_hash TEXT,
      status TEXT NOT NULL DEFAULT 'executed',
      pnl_usd REAL
    );
  `);

  return db;
}

function insertTx(
  db: Database.Database,
  overrides: Partial<{
    id: string; userId: string; chainId: number; skillName: string;
    status: string; gasCostUsd: number; value: string;
  }> = {},
): void {
  const id = overrides.id ?? `tx-${Math.random().toString(36).slice(2)}`;
  db.prepare(
    `INSERT INTO tx_log (id, user_id, chain_id, from_addr, to_addr, value, status, skill_name, gas_cost_usd)
     VALUES (?, ?, ?, '0x1', '0x2', ?, ?, ?, ?)`,
  ).run(
    id,
    overrides.userId ?? "user1",
    overrides.chainId ?? 1,
    overrides.value ?? "0",
    overrides.status ?? "confirmed",
    overrides.skillName ?? "swap",
    overrides.gasCostUsd ?? null,
  );
}

function insertTrade(
  db: Database.Database,
  overrides: Partial<{
    id: string; agentId: string; action: string; token: string;
    amountUsd: number; chainId: number; pnlUsd: number; timestamp: number;
  }> = {},
): void {
  const id = overrides.id ?? `trade-${Math.random().toString(36).slice(2)}`;
  db.prepare(
    `INSERT INTO agent_trades (id, agent_id, timestamp, action, token, amount_usd, price_at_execution, chain_id, status, pnl_usd)
     VALUES (?, ?, ?, ?, ?, ?, 100, ?, 'executed', ?)`,
  ).run(
    id,
    overrides.agentId ?? "agent1",
    overrides.timestamp ?? Date.now(),
    overrides.action ?? "buy",
    overrides.token ?? "ETH",
    overrides.amountUsd ?? 100,
    overrides.chainId ?? 1,
    overrides.pnlUsd ?? null,
  );
}

describe("Performance Reviewer", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("computeMetrics", () => {
    it("returns zero metrics for empty data", () => {
      const m = computeMetrics(db, "user1", 1);
      expect(m.txCount).toBe(0);
      expect(m.tradeCount).toBe(0);
      expect(m.winRate).toBe(0);
      expect(m.grossPnl).toBe(0);
      expect(m.netPnl).toBe(0);
    });

    it("computes tx success rate", () => {
      insertTx(db, { status: "confirmed" });
      insertTx(db, { status: "confirmed" });
      insertTx(db, { status: "failed" });

      const m = computeMetrics(db, "user1", 1);
      expect(m.txCount).toBe(3);
      expect(m.txSuccessRate).toBeCloseTo(66.67, 0);
      expect(m.txFailureCount).toBe(1);
    });

    it("computes gas cost totals", () => {
      insertTx(db, { gasCostUsd: 5.0, chainId: 1 });
      insertTx(db, { gasCostUsd: 2.5, chainId: 1 });
      insertTx(db, { gasCostUsd: 1.0, chainId: 137 });

      const m = computeMetrics(db, "user1", 1);
      expect(m.totalGasCost).toBe(8.5);
    });

    it("computes skill breakdown", () => {
      insertTx(db, { skillName: "swap", status: "confirmed" });
      insertTx(db, { skillName: "swap", status: "failed" });
      insertTx(db, { skillName: "bridge", status: "confirmed" });

      const m = computeMetrics(db, "user1", 1);
      expect(m.skillBreakdown.swap.count).toBe(2);
      expect(m.skillBreakdown.swap.successRate).toBe(50);
      expect(m.skillBreakdown.bridge.count).toBe(1);
      expect(m.skillBreakdown.bridge.successRate).toBe(100);
    });

    it("computes win rate and PnL from trades", () => {
      insertTrade(db, { pnlUsd: 50 });
      insertTrade(db, { pnlUsd: 30 });
      insertTrade(db, { pnlUsd: -20 });

      const m = computeMetrics(db, "user1", 1);
      expect(m.tradeCount).toBe(3);
      expect(m.winRate).toBeCloseTo(66.67, 0);
      expect(m.grossPnl).toBe(60);
      expect(m.avgWinner).toBe(40); // (50+30)/2
      expect(m.avgLoser).toBe(20);
    });

    it("computes profit factor correctly", () => {
      insertTrade(db, { pnlUsd: 100 });
      insertTrade(db, { pnlUsd: -50 });
      insertTx(db, { gasCostUsd: 10 });

      const m = computeMetrics(db, "user1", 1);
      expect(m.profitFactor.gross).toBe(2); // 100/50
      expect(m.profitFactor.net).toBe(1.8); // (100-10)/50
      expect(m.netPnl).toBe(40); // 50 gross - 10 gas
    });

    it("detects fee-eaten profits", () => {
      insertTrade(db, { pnlUsd: 20 });
      insertTrade(db, { pnlUsd: -10 });
      insertTx(db, { gasCostUsd: 15 });

      const m = computeMetrics(db, "user1", 1);
      expect(m.grossPnl).toBe(10); // 20 - 10
      expect(m.netPnl).toBe(-5);   // 10 - 15 gas
    });

    it("filters by user", () => {
      insertTx(db, { userId: "user1", gasCostUsd: 5 });
      insertTx(db, { userId: "user2", gasCostUsd: 10 });

      const m = computeMetrics(db, "user1", 1);
      expect(m.txCount).toBe(1);
      expect(m.totalGasCost).toBe(5);
    });

    it("computes fee drag ratio", () => {
      insertTrade(db, { amountUsd: 1000, pnlUsd: 50 });
      insertTrade(db, { amountUsd: 500, pnlUsd: -20 });
      insertTx(db, { gasCostUsd: 15 });

      const m = computeMetrics(db, "user1", 1);
      // FDR = 15 / 1500 * 100 = 1%
      expect(m.feeDragRatio).toBe(1);
    });
  });

  describe("formatReport", () => {
    it("produces readable markdown", () => {
      insertTx(db, { status: "confirmed", gasCostUsd: 5, skillName: "swap" });
      insertTrade(db, { pnlUsd: 50 });
      insertTrade(db, { pnlUsd: -20 });

      const m = computeMetrics(db, "user1", 1);
      const report = formatReport(m);

      expect(report).toContain("Performance Review");
      expect(report).toContain("Win rate");
      expect(report).toContain("Gross PnL");
      expect(report).toContain("Gas costs");
      expect(report).toContain("Net PnL");
      expect(report).toContain("Fee drag ratio");
      expect(report).toContain("Profit factor");
    });

    it("warns when gross positive but net negative", () => {
      insertTrade(db, { pnlUsd: 10 });
      insertTx(db, { gasCostUsd: 15 });

      const m = computeMetrics(db, "user1", 1);
      const report = formatReport(m);

      expect(report).toContain("fees are eating profits");
    });

    it("warns on high fee drag ratio", () => {
      insertTrade(db, { amountUsd: 100, pnlUsd: 10 });
      insertTx(db, { gasCostUsd: 12 }); // FDR = 12%

      const m = computeMetrics(db, "user1", 1);
      const report = formatReport(m);

      expect(report).toContain("Fee drag ratio > 10%");
    });
  });
});
