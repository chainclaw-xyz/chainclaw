import { writeFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { getLogger } from "@chainclaw/core";
import type {
  TrainingExample,
  AlpacaExample,
  ChatMLExample,
  ExportOptions,
  ExportStats,
} from "./types.js";

const logger = getLogger("training-data-exporter");

interface JoinedRow {
  trade_id: string;
  agent_id: string;
  timestamp: number;
  action: string;
  token: string;
  amount_usd: number;
  price_at_execution: number;
  chain_id: number;
  reasoning: string;
  context_json: string;
  decisions_json: string;
  enriched_text: string | null;
  label_1h_pnl: number | null;
  label_1h_percent: number | null;
  label_1h_price: number | null;
  label_24h_pnl: number | null;
  label_24h_percent: number | null;
  label_24h_price: number | null;
  label_7d_pnl: number | null;
  label_7d_percent: number | null;
  label_7d_price: number | null;
}

const SYSTEM_PROMPT = "You are a DeFi trading agent. Analyze the market context and portfolio state, then make a trading decision with detailed reasoning.";

export function createTrainingDataExporter(db: Database.Database) {
  function buildExamples(options: ExportOptions = { format: "jsonl" }): TrainingExample[] {
    const { minOutcomeWindow = "24h", onlyProfitable, agentId, limit, includeEnrichedOnly } = options;

    const windowColumn = minOutcomeWindow === "1h" ? "label_1h_pnl" : minOutcomeWindow === "7d" ? "label_7d_pnl" : "label_24h_pnl";

    let sql = `
      SELECT
        t.id AS trade_id,
        t.agent_id,
        t.timestamp,
        t.action,
        t.token,
        t.amount_usd,
        t.price_at_execution,
        t.chain_id,
        t.reasoning,
        rt.context_json,
        rt.decisions_json,
        er.enriched_text,
        ol1h.pnl_usd AS label_1h_pnl,
        ol1h.pnl_percent AS label_1h_percent,
        ol1h.price_at_window AS label_1h_price,
        ol24h.pnl_usd AS label_24h_pnl,
        ol24h.pnl_percent AS label_24h_percent,
        ol24h.price_at_window AS label_24h_price,
        ol7d.pnl_usd AS label_7d_pnl,
        ol7d.pnl_percent AS label_7d_percent,
        ol7d.price_at_window AS label_7d_price
      FROM agent_trades t
      INNER JOIN reasoning_traces rt
        ON rt.agent_id = t.agent_id
        AND rt.timestamp = t.timestamp
      LEFT JOIN enriched_reasoning er ON er.trace_id = rt.id
      LEFT JOIN outcome_labels ol1h ON ol1h.trade_id = t.id AND ol1h.window = '1h'
      LEFT JOIN outcome_labels ol24h ON ol24h.trade_id = t.id AND ol24h.window = '24h'
      LEFT JOIN outcome_labels ol7d ON ol7d.trade_id = t.id AND ol7d.window = '7d'
      WHERE t.status = 'executed'
    `;

    const params: unknown[] = [];

    // Require the minimum window label to exist
    sql += ` AND ${windowColumn} IS NOT NULL`;

    if (onlyProfitable) {
      sql += ` AND ${windowColumn} > 0`;
    }

    if (agentId) {
      sql += " AND t.agent_id = ?";
      params.push(agentId);
    }

    if (includeEnrichedOnly) {
      sql += " AND er.enriched_text IS NOT NULL";
    }

    sql += " ORDER BY t.timestamp ASC";

    if (limit) {
      sql += " LIMIT ?";
      params.push(limit);
    }

    const rows = db.prepare(sql).all(...params) as JoinedRow[];

    return rows.map((row, idx) => {
      const context = JSON.parse(row.context_json);
      const outcomes: Record<string, { pnlUsd: number; pnlPercent: number; priceAtWindow: number }> = {};

      if (row.label_1h_pnl != null) {
        outcomes["1h"] = { pnlUsd: row.label_1h_pnl, pnlPercent: row.label_1h_percent!, priceAtWindow: row.label_1h_price! };
      }
      if (row.label_24h_pnl != null) {
        outcomes["24h"] = { pnlUsd: row.label_24h_pnl, pnlPercent: row.label_24h_percent!, priceAtWindow: row.label_24h_price! };
      }
      if (row.label_7d_pnl != null) {
        outcomes["7d"] = { pnlUsd: row.label_7d_pnl, pnlPercent: row.label_7d_percent!, priceAtWindow: row.label_7d_price! };
      }

      return {
        id: `ex-${row.trade_id}-${idx}`,
        tradeId: row.trade_id,
        agentId: row.agent_id,
        context: {
          prices: context.prices ?? {},
          portfolio: context.portfolio ?? {},
          totalValueUsd: context.totalValueUsd ?? 0,
          timestamp: row.timestamp,
        },
        decision: {
          action: row.action as "buy" | "sell" | "hold",
          token: row.token,
          amountUsd: row.amount_usd,
          chainId: row.chain_id,
        },
        reasoning: row.reasoning,
        enrichedReasoning: row.enriched_text ?? undefined,
        outcomes: Object.keys(outcomes).length > 0 ? outcomes : undefined,
        createdAt: Date.now(),
      };
    });
  }

  function formatAsAlpaca(example: TrainingExample): AlpacaExample {
    const priceLines = Object.entries(example.context.prices)
      .map(([token, price]) => `${token}: $${price}`)
      .join(", ");
    const portfolioLines = Object.entries(example.context.portfolio)
      .map(([token, qty]) => `${token}: ${qty}`)
      .join(", ");

    const input = [
      `Portfolio: ${portfolioLines || "empty"}`,
      `Total Value: $${example.context.totalValueUsd}`,
      `Prices: ${priceLines || "none"}`,
    ].join(". ");

    const reasoning = example.enrichedReasoning ?? example.reasoning;
    const outcomeStr = example.outcomes?.["24h"]
      ? ` Outcome after 24h: ${example.outcomes["24h"].pnlUsd >= 0 ? "+" : ""}$${example.outcomes["24h"].pnlUsd.toFixed(2)} (${example.outcomes["24h"].pnlPercent >= 0 ? "+" : ""}${example.outcomes["24h"].pnlPercent.toFixed(1)}%)`
      : "";

    const output = `DECISION: ${example.decision.action.toUpperCase()} ${example.decision.token} $${example.decision.amountUsd} on chain ${example.decision.chainId}\n\nREASONING: ${reasoning}${outcomeStr}`;

    return {
      instruction: SYSTEM_PROMPT,
      input,
      output,
    };
  }

  function formatAsChatML(example: TrainingExample): ChatMLExample {
    const alpaca = formatAsAlpaca(example);
    return {
      messages: [
        { role: "system", content: alpaca.instruction },
        { role: "user", content: alpaca.input },
        { role: "assistant", content: alpaca.output },
      ],
    };
  }

  function exportToFile(outputPath: string, options: ExportOptions): ExportStats {
    const examples = buildExamples(options);
    const lines: string[] = [];

    for (const example of examples) {
      let formatted: unknown;
      switch (options.format) {
        case "alpaca":
          formatted = formatAsAlpaca(example);
          break;
        case "chatml":
          formatted = formatAsChatML(example);
          break;
        default:
          formatted = example;
      }
      lines.push(JSON.stringify(formatted));
    }

    writeFileSync(outputPath, lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf-8");

    logger.info({ format: options.format, count: examples.length, outputPath }, "Training data exported");

    return {
      totalExamples: examples.length,
      exportedExamples: lines.length,
      format: options.format,
      outputPath,
    };
  }

  function getExportableCount(): number {
    const row = db.prepare(
      `SELECT COUNT(*) AS cnt FROM agent_trades t
       INNER JOIN reasoning_traces rt ON rt.agent_id = t.agent_id AND rt.timestamp = t.timestamp
       INNER JOIN outcome_labels ol ON ol.trade_id = t.id AND ol.window = '24h'
       WHERE t.status = 'executed'`,
    ).get() as { cnt: number };
    return row.cnt;
  }

  return {
    buildExamples,
    formatAsAlpaca,
    formatAsChatML,
    exportToFile,
    getExportableCount,
  };
}
