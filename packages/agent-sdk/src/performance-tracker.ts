import type Database from "better-sqlite3";
import { getLogger } from "@chainclaw/core";
import type { TradeRecord, Signal, BacktestMetrics } from "./types.js";

const logger = getLogger("performance-tracker");

interface AgentInstanceRow {
  id: string;
  name: string;
  version: string;
  user_id: string;
  status: string;
  mode: string;
  config_json: string;
  started_at: string;
  stopped_at: string | null;
}

interface AgentTradeRow {
  id: string;
  agent_id: string;
  timestamp: number;
  action: string;
  token: string;
  amount_usd: number;
  price_at_execution: number;
  chain_id: number;
  reasoning: string;
  signals_json: string;
  tx_hash: string | null;
  status: string;
  pnl_usd: number | null;
}

interface ReasoningTraceRow {
  id: number;
  agent_id: string;
  timestamp: number;
  context_json: string;
  decisions_json: string;
  reasoning: string;
}

export class PerformanceTracker {
  constructor(private db: Database.Database) {
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_instances (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'paused', 'stopped')),
        mode TEXT NOT NULL DEFAULT 'dry_run' CHECK(mode IN ('dry_run', 'live')),
        config_json TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        stopped_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_agent_instances_user ON agent_instances(user_id);
      CREATE INDEX IF NOT EXISTS idx_agent_instances_status ON agent_instances(status);

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
        pnl_usd REAL,
        FOREIGN KEY (agent_id) REFERENCES agent_instances(id)
      );

      CREATE INDEX IF NOT EXISTS idx_agent_trades_agent ON agent_trades(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_trades_ts ON agent_trades(timestamp);

      CREATE TABLE IF NOT EXISTS reasoning_traces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        context_json TEXT NOT NULL,
        decisions_json TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agent_instances(id)
      );

      CREATE INDEX IF NOT EXISTS idx_reasoning_agent ON reasoning_traces(agent_id);
    `);
    logger.debug("Performance tracker tables initialized");
  }

  // ─── Agent Instance CRUD ─────────────────────────────────────

  createInstance(
    id: string,
    name: string,
    version: string,
    userId: string,
    mode: "dry_run" | "live",
    config: Record<string, unknown>,
  ): void {
    this.db.prepare(
      "INSERT INTO agent_instances (id, name, version, user_id, mode, config_json) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, name, version, userId, mode, JSON.stringify(config));
  }

  getInstance(id: string): AgentInstanceRow | null {
    return this.db.prepare(
      "SELECT * FROM agent_instances WHERE id = ?",
    ).get(id) as AgentInstanceRow | null;
  }

  getUserInstances(userId: string): AgentInstanceRow[] {
    return this.db.prepare(
      "SELECT * FROM agent_instances WHERE user_id = ? ORDER BY started_at DESC",
    ).all(userId) as AgentInstanceRow[];
  }

  getActiveInstances(userId: string): AgentInstanceRow[] {
    return this.db.prepare(
      "SELECT * FROM agent_instances WHERE user_id = ? AND status IN ('running', 'paused') ORDER BY started_at DESC",
    ).all(userId) as AgentInstanceRow[];
  }

  updateInstanceStatus(id: string, status: "running" | "paused" | "stopped"): void {
    const stoppedAt = status === "stopped" ? "datetime('now')" : null;
    if (stoppedAt) {
      this.db.prepare(
        "UPDATE agent_instances SET status = ?, stopped_at = datetime('now') WHERE id = ?",
      ).run(status, id);
    } else {
      this.db.prepare(
        "UPDATE agent_instances SET status = ? WHERE id = ?",
      ).run(status, id);
    }
  }

  // ─── Trade Logging ───────────────────────────────────────────

  logTrade(trade: TradeRecord): void {
    this.db.prepare(
      `INSERT INTO agent_trades (id, agent_id, timestamp, action, token, amount_usd, price_at_execution, chain_id, reasoning, signals_json, tx_hash, status, pnl_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      trade.id,
      trade.agentId,
      trade.timestamp,
      trade.action,
      trade.token,
      trade.amountUsd,
      trade.priceAtExecution,
      trade.chainId,
      trade.reasoning,
      JSON.stringify(trade.signals),
      trade.txHash ?? null,
      trade.status,
      trade.pnlUsd ?? null,
    );
  }

  getAgentTrades(agentId: string, limit = 50): TradeRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM agent_trades WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?",
    ).all(agentId, limit) as AgentTradeRow[];

    return rows.map((r) => this.rowToTradeRecord(r));
  }

  getUnlabeledTrades(beforeTimestamp: number, limit = 100): TradeRecord[] {
    const rows = this.db.prepare(
      `SELECT * FROM agent_trades
       WHERE status = 'executed' AND pnl_usd IS NULL AND timestamp <= ?
       ORDER BY timestamp ASC LIMIT ?`,
    ).all(beforeTimestamp, limit) as AgentTradeRow[];

    return rows.map((r) => this.rowToTradeRecord(r));
  }

  updateTradePnl(tradeId: string, pnlUsd: number): void {
    this.db.prepare(
      "UPDATE agent_trades SET pnl_usd = ? WHERE id = ? AND pnl_usd IS NULL",
    ).run(pnlUsd, tradeId);
  }

  private rowToTradeRecord(r: AgentTradeRow): TradeRecord {
    return {
      id: r.id,
      agentId: r.agent_id,
      timestamp: r.timestamp,
      action: r.action as "buy" | "sell",
      token: r.token,
      amountUsd: r.amount_usd,
      priceAtExecution: r.price_at_execution,
      chainId: r.chain_id,
      reasoning: r.reasoning,
      signals: JSON.parse(r.signals_json) as Signal[],
      txHash: r.tx_hash ?? undefined,
      status: r.status as "pending" | "executed" | "failed",
      pnlUsd: r.pnl_usd ?? undefined,
    };
  }

  // ─── Reasoning Traces ────────────────────────────────────────

  logReasoning(
    agentId: string,
    timestamp: number,
    context: Record<string, unknown>,
    decisions: unknown[],
    reasoning: string,
  ): void {
    this.db.prepare(
      "INSERT INTO reasoning_traces (agent_id, timestamp, context_json, decisions_json, reasoning) VALUES (?, ?, ?, ?, ?)",
    ).run(agentId, timestamp, JSON.stringify(context), JSON.stringify(decisions), reasoning);
  }

  getReasoningTraces(agentId: string, limit = 20): ReasoningTraceRow[] {
    return this.db.prepare(
      "SELECT * FROM reasoning_traces WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?",
    ).all(agentId, limit) as ReasoningTraceRow[];
  }

  // ─── Metrics Computation ─────────────────────────────────────

  computeMetrics(agentId: string): BacktestMetrics | null {
    const trades = this.getAgentTrades(agentId, 10000);
    if (trades.length === 0) return null;

    const executedTrades = trades.filter((t) => t.status === "executed");
    if (executedTrades.length === 0) return null;

    const profitableTrades = executedTrades.filter((t) => (t.pnlUsd ?? 0) > 0);
    const totalPnl = executedTrades.reduce((sum, t) => sum + (t.pnlUsd ?? 0), 0);
    const avgReturn = executedTrades.length > 0
      ? executedTrades.reduce((sum, t) => sum + (t.pnlUsd ?? 0), 0) / executedTrades.length
      : 0;

    // Simple max drawdown estimation from trade PnL
    let peak = 0;
    let maxDrawdown = 0;
    let cumulative = 0;
    for (const trade of executedTrades.reverse()) {
      cumulative += trade.pnlUsd ?? 0;
      if (cumulative > peak) peak = cumulative;
      const drawdown = peak > 0 ? ((peak - cumulative) / peak) * 100 : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    return {
      totalReturnPercent: totalPnl, // simplified — would need starting capital for %
      maxDrawdownPercent: maxDrawdown,
      sharpeRatio: 0, // requires daily returns time series
      winRate: executedTrades.length > 0 ? (profitableTrades.length / executedTrades.length) * 100 : 0,
      totalTrades: executedTrades.length,
      profitableTrades: profitableTrades.length,
      avgTradeReturnPercent: avgReturn,
      avgTradeDurationMs: 0,
      benchmarkReturnPercent: 0,
      alpha: 0,
    };
  }

  // ─── Formatted Summary ───────────────────────────────────────

  formatPerformanceSummary(agentId: string): string {
    const instance = this.getInstance(agentId);
    if (!instance) return "Agent not found.";

    const metrics = this.computeMetrics(agentId);
    const trades = this.getAgentTrades(agentId, 5);

    const lines = [
      `*Agent: ${instance.name} v${instance.version}*`,
      `Status: ${instance.status} | Mode: ${instance.mode}`,
      `Started: ${instance.started_at}`,
      instance.stopped_at ? `Stopped: ${instance.stopped_at}` : "",
      "",
    ];

    if (metrics) {
      lines.push(
        "*Performance*",
        `Total trades: ${metrics.totalTrades}`,
        `Win rate: ${metrics.winRate.toFixed(1)}%`,
        `Profitable: ${metrics.profitableTrades}/${metrics.totalTrades}`,
        `Max drawdown: ${metrics.maxDrawdownPercent.toFixed(1)}%`,
        "",
      );
    } else {
      lines.push("_No executed trades yet._", "");
    }

    if (trades.length > 0) {
      lines.push("*Recent Trades*");
      for (const t of trades) {
        const pnl = t.pnlUsd != null ? ` (${t.pnlUsd >= 0 ? "+" : ""}$${t.pnlUsd.toFixed(2)})` : "";
        lines.push(`${t.action.toUpperCase()} ${t.token} $${t.amountUsd.toFixed(2)}${pnl} [${t.status}]`);
      }
    }

    return lines.filter((l) => l !== "").join("\n");
  }
}
