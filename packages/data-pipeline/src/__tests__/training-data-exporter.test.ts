import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { createTrainingDataExporter } from "../training-data-exporter.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function seedAllTables(db: Database.Database): void {
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
      action TEXT NOT NULL,
      token TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      price_at_execution REAL NOT NULL,
      chain_id INTEGER NOT NULL,
      reasoning TEXT NOT NULL,
      signals_json TEXT NOT NULL DEFAULT '[]',
      tx_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
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

    CREATE TABLE IF NOT EXISTS outcome_labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      token TEXT NOT NULL,
      action TEXT NOT NULL,
      price_at_execution REAL NOT NULL,
      window TEXT NOT NULL,
      price_at_window REAL NOT NULL,
      pnl_usd REAL NOT NULL,
      pnl_percent REAL NOT NULL,
      labeled_at INTEGER NOT NULL,
      UNIQUE(trade_id, window)
    );

    CREATE TABLE IF NOT EXISTS enriched_reasoning (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id INTEGER NOT NULL UNIQUE,
      agent_id TEXT NOT NULL,
      enriched_text TEXT NOT NULL,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      enriched_at INTEGER NOT NULL
    );
  `);
}

function seedCompleteExample(db: Database.Database): void {
  // Agent
  db.prepare(
    "INSERT INTO agent_instances (id, name, version, user_id, mode, config_json) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("agent-1", "test-agent", "1.0.0", "user-1", "dry_run", "{}");

  // Trade
  db.prepare(
    `INSERT INTO agent_trades (id, agent_id, timestamp, action, token, amount_usd, price_at_execution, chain_id, reasoning, signals_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("trade-1", "agent-1", 1700000000, "buy", "ETH", 100, 2000, 1, "bullish momentum", "[]", "executed");

  // Reasoning trace (same agent + timestamp as trade)
  db.prepare(
    "INSERT INTO reasoning_traces (agent_id, timestamp, context_json, decisions_json, reasoning) VALUES (?, ?, ?, ?, ?)",
  ).run(
    "agent-1",
    1700000000,
    JSON.stringify({ prices: { ETH: 2000, BTC: 40000 }, portfolio: { ETH: 0.5 }, totalValueUsd: 1000 }),
    JSON.stringify([{ action: "buy", token: "ETH", amountUsd: 100, chainId: 1, reasoning: "bullish momentum" }]),
    "bullish momentum",
  );

  // Outcome labels
  db.prepare(
    `INSERT INTO outcome_labels (trade_id, agent_id, token, action, price_at_execution, window, price_at_window, pnl_usd, pnl_percent, labeled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("trade-1", "agent-1", "ETH", "buy", 2000, "1h", 2050, 2.5, 2.5, Date.now());

  db.prepare(
    `INSERT INTO outcome_labels (trade_id, agent_id, token, action, price_at_execution, window, price_at_window, pnl_usd, pnl_percent, labeled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("trade-1", "agent-1", "ETH", "buy", 2000, "24h", 2200, 10, 10, Date.now());

  // Enriched reasoning (trace_id = 1)
  db.prepare(
    "INSERT INTO enriched_reasoning (trace_id, agent_id, enriched_text, tokens_used, enriched_at) VALUES (?, ?, ?, ?, ?)",
  ).run(1, "agent-1", "1. MARKET CONTEXT: ETH strong. 2. PORTFOLIO STATE: Moderate.", 300, Date.now());
}

describe("createTrainingDataExporter", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    seedAllTables(db);
  });

  afterEach(() => {
    db.close();
  });

  it("builds training examples from joined data", () => {
    seedCompleteExample(db);
    const exporter = createTrainingDataExporter(db);

    const examples = exporter.buildExamples({ format: "jsonl" });
    expect(examples).toHaveLength(1);
    expect(examples[0]!.tradeId).toBe("trade-1");
    expect(examples[0]!.decision.action).toBe("buy");
    expect(examples[0]!.decision.token).toBe("ETH");
    expect(examples[0]!.context.prices.ETH).toBe(2000);
    expect(examples[0]!.outcomes?.["24h"]?.pnlUsd).toBe(10);
    expect(examples[0]!.enrichedReasoning).toContain("MARKET CONTEXT");
  });

  it("formats as Alpaca correctly", () => {
    seedCompleteExample(db);
    const exporter = createTrainingDataExporter(db);

    const examples = exporter.buildExamples({ format: "alpaca" });
    const alpaca = exporter.formatAsAlpaca(examples[0]!);

    expect(alpaca.instruction).toContain("DeFi trading agent");
    expect(alpaca.input).toContain("ETH");
    expect(alpaca.output).toContain("DECISION: BUY ETH");
    expect(alpaca.output).toContain("REASONING:");
  });

  it("formats as ChatML correctly", () => {
    seedCompleteExample(db);
    const exporter = createTrainingDataExporter(db);

    const examples = exporter.buildExamples({ format: "chatml" });
    const chatml = exporter.formatAsChatML(examples[0]!);

    expect(chatml.messages).toHaveLength(3);
    expect(chatml.messages[0]!.role).toBe("system");
    expect(chatml.messages[1]!.role).toBe("user");
    expect(chatml.messages[2]!.role).toBe("assistant");
  });

  it("exports to JSONL file", () => {
    seedCompleteExample(db);
    const exporter = createTrainingDataExporter(db);

    const tmpDir = mkdtempSync(join(tmpdir(), "chainclaw-export-"));
    const outputPath = join(tmpDir, "training.jsonl");

    try {
      const stats = exporter.exportToFile(outputPath, { format: "alpaca" });

      expect(stats.exportedExamples).toBe(1);
      expect(stats.format).toBe("alpaca");

      const content = readFileSync(outputPath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]!);
      expect(parsed.instruction).toBeDefined();
      expect(parsed.input).toBeDefined();
      expect(parsed.output).toBeDefined();
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it("filters by profitability", () => {
    seedCompleteExample(db);

    // Add a losing trade
    db.prepare(
      `INSERT INTO agent_trades (id, agent_id, timestamp, action, token, amount_usd, price_at_execution, chain_id, reasoning, signals_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("trade-2", "agent-1", 1700001000, "buy", "BTC", 200, 40000, 1, "bad call", "[]", "executed");

    db.prepare(
      "INSERT INTO reasoning_traces (agent_id, timestamp, context_json, decisions_json, reasoning) VALUES (?, ?, ?, ?, ?)",
    ).run("agent-1", 1700001000, JSON.stringify({ prices: { BTC: 40000 }, portfolio: {}, totalValueUsd: 0 }),
      JSON.stringify([{ action: "buy", token: "BTC", amountUsd: 200, chainId: 1 }]), "bad call");

    db.prepare(
      `INSERT INTO outcome_labels (trade_id, agent_id, token, action, price_at_execution, window, price_at_window, pnl_usd, pnl_percent, labeled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("trade-2", "agent-1", "BTC", "buy", 40000, "24h", 38000, -10, -5, Date.now());

    const exporter = createTrainingDataExporter(db);

    const all = exporter.buildExamples({ format: "jsonl" });
    expect(all).toHaveLength(2);

    const profitable = exporter.buildExamples({ format: "jsonl", onlyProfitable: true });
    expect(profitable).toHaveLength(1);
    expect(profitable[0]!.tradeId).toBe("trade-1");
  });

  it("returns empty array when no data", () => {
    const exporter = createTrainingDataExporter(db);
    const examples = exporter.buildExamples({ format: "jsonl" });
    expect(examples).toHaveLength(0);
  });

  it("counts exportable examples", () => {
    seedCompleteExample(db);
    const exporter = createTrainingDataExporter(db);
    expect(exporter.getExportableCount()).toBe(1);
  });

  it("filters by includeEnrichedOnly", () => {
    seedCompleteExample(db);

    // Add trade without enrichment
    db.prepare(
      `INSERT INTO agent_trades (id, agent_id, timestamp, action, token, amount_usd, price_at_execution, chain_id, reasoning, signals_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("trade-3", "agent-1", 1700002000, "sell", "ETH", 50, 2200, 1, "taking profits", "[]", "executed");

    db.prepare(
      "INSERT INTO reasoning_traces (agent_id, timestamp, context_json, decisions_json, reasoning) VALUES (?, ?, ?, ?, ?)",
    ).run("agent-1", 1700002000, JSON.stringify({ prices: { ETH: 2200 }, portfolio: { ETH: 0.5 }, totalValueUsd: 1100 }),
      JSON.stringify([{ action: "sell", token: "ETH", amountUsd: 50, chainId: 1 }]), "taking profits");

    db.prepare(
      `INSERT INTO outcome_labels (trade_id, agent_id, token, action, price_at_execution, window, price_at_window, pnl_usd, pnl_percent, labeled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("trade-3", "agent-1", "ETH", "sell", 2200, "24h", 2100, 4.55, 4.55, Date.now());

    const exporter = createTrainingDataExporter(db);

    const all = exporter.buildExamples({ format: "jsonl" });
    expect(all).toHaveLength(2);

    const enrichedOnly = exporter.buildExamples({ format: "jsonl", includeEnrichedOnly: true });
    expect(enrichedOnly).toHaveLength(1);
    expect(enrichedOnly[0]!.enrichedReasoning).toBeDefined();
  });
});
