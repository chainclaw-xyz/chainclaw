import type Database from "better-sqlite3";
import { getLogger } from "@chainclaw/core";
import type { TradeRecord } from "@chainclaw/agent-sdk";
import { LABEL_WINDOWS, labelWindowMs, type LabelWindow, type LabelingStats } from "./types.js";

const logger = getLogger("outcome-labeler");

export type PriceFetcher = (symbol: string) => Promise<number | null>;

interface OutcomeLabelRow {
  id: number;
  trade_id: string;
  agent_id: string;
  token: string;
  action: string;
  price_at_execution: number;
  window: string;
  price_at_window: number;
  pnl_usd: number;
  pnl_percent: number;
  labeled_at: number;
}

export class OutcomeLabeler {
  private interval: ReturnType<typeof setInterval> | null = null;
  private stats: LabelingStats = { processed: 0, labeled: 0, skipped: 0, errors: 0 };

  constructor(
    private db: Database.Database,
    private fetchPrice: PriceFetcher,
  ) {
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outcome_labels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        token TEXT NOT NULL,
        action TEXT NOT NULL,
        price_at_execution REAL NOT NULL,
        window TEXT NOT NULL CHECK(window IN ('1h', '24h', '7d')),
        price_at_window REAL NOT NULL,
        pnl_usd REAL NOT NULL,
        pnl_percent REAL NOT NULL,
        labeled_at INTEGER NOT NULL,
        UNIQUE(trade_id, window)
      );

      CREATE INDEX IF NOT EXISTS idx_outcome_labels_trade ON outcome_labels(trade_id);
      CREATE INDEX IF NOT EXISTS idx_outcome_labels_agent ON outcome_labels(agent_id);
    `);
    logger.debug("Outcome labeler tables initialized");
  }

  start(intervalMs: number): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      this.labelPendingTrades().catch((err) =>
        logger.error({ err }, "Outcome labeling error"),
      );
    }, intervalMs);
    logger.info({ intervalMs }, "Outcome labeler started");
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async labelPendingTrades(batchSize = 50): Promise<LabelingStats> {
    const batchStats: LabelingStats = { processed: 0, labeled: 0, skipped: 0, errors: 0 };
    const now = Date.now();

    for (const window of LABEL_WINDOWS) {
      const windowMs = labelWindowMs[window];
      const cutoff = Math.floor((now - windowMs) / 1000); // unix seconds

      const trades = this.getUnlabeledTradesForWindow(cutoff, window, batchSize);

      for (const trade of trades) {
        batchStats.processed++;
        try {
          const currentPrice = await this.fetchPrice(trade.token);
          if (currentPrice == null) {
            batchStats.skipped++;
            continue;
          }
          this.labelTrade(trade, window, currentPrice);
          batchStats.labeled++;
        } catch (err) {
          batchStats.errors++;
          logger.warn({ err, tradeId: trade.id, window }, "Failed to label trade");
        }
      }
    }

    // Accumulate global stats
    this.stats.processed += batchStats.processed;
    this.stats.labeled += batchStats.labeled;
    this.stats.skipped += batchStats.skipped;
    this.stats.errors += batchStats.errors;

    if (batchStats.labeled > 0) {
      logger.info(batchStats, "Labeling batch complete");
    }

    return batchStats;
  }

  labelTrade(trade: TradeRecord, window: LabelWindow, priceAtWindow: number): void {
    const priceDiff = priceAtWindow - trade.priceAtExecution;
    // For buy: profit when price goes up; for sell: profit when price goes down
    const direction = trade.action === "buy" ? 1 : -1;
    const pnlPercent = trade.priceAtExecution > 0
      ? (priceDiff / trade.priceAtExecution) * 100 * direction
      : 0;
    const pnlUsd = (priceDiff / trade.priceAtExecution) * trade.amountUsd * direction;

    this.db.prepare(
      `INSERT OR IGNORE INTO outcome_labels
       (trade_id, agent_id, token, action, price_at_execution, window, price_at_window, pnl_usd, pnl_percent, labeled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      trade.id,
      trade.agentId,
      trade.token,
      trade.action,
      trade.priceAtExecution,
      window,
      priceAtWindow,
      pnlUsd,
      pnlPercent,
      Date.now(),
    );

    // Also update agent_trades.pnl_usd for the 24h window (canonical PnL)
    if (window === "24h") {
      this.db.prepare(
        "UPDATE agent_trades SET pnl_usd = ? WHERE id = ? AND pnl_usd IS NULL",
      ).run(pnlUsd, trade.id);
    }
  }

  getLabelsForTrade(tradeId: string): OutcomeLabelRow[] {
    return this.db.prepare(
      "SELECT * FROM outcome_labels WHERE trade_id = ? ORDER BY window",
    ).all(tradeId) as OutcomeLabelRow[];
  }

  getStats(): LabelingStats {
    return { ...this.stats };
  }

  private getUnlabeledTradesForWindow(
    beforeTimestamp: number,
    window: LabelWindow,
    limit: number,
  ): TradeRecord[] {
    const rows = this.db.prepare(
      `SELECT t.* FROM agent_trades t
       WHERE t.status = 'executed'
         AND t.timestamp <= ?
         AND NOT EXISTS (
           SELECT 1 FROM outcome_labels ol
           WHERE ol.trade_id = t.id AND ol.window = ?
         )
       ORDER BY t.timestamp ASC
       LIMIT ?`,
    ).all(beforeTimestamp, window, limit) as Array<{
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
    }>;

    return rows.map((r) => ({
      id: r.id,
      agentId: r.agent_id,
      timestamp: r.timestamp,
      action: r.action as "buy" | "sell",
      token: r.token,
      amountUsd: r.amount_usd,
      priceAtExecution: r.price_at_execution,
      chainId: r.chain_id,
      reasoning: r.reasoning,
      signals: JSON.parse(r.signals_json),
      txHash: r.tx_hash ?? undefined,
      status: r.status as "pending" | "executed" | "failed",
      pnlUsd: r.pnl_usd ?? undefined,
    }));
  }
}
