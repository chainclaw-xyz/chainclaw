import { z } from "zod";
import type Database from "better-sqlite3";
import { getLogger, triggerHook, createHookEvent, type SkillResult } from "@chainclaw/core";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";
import { getChainName } from "./token-addresses.js";

const logger = getLogger("skill-performance-reviewer");

// ─── Types ──────────────────────────────────────────────────

interface TxRow {
  chain_id: number;
  skill_name: string;
  status: string;
  gas_cost_usd: number | null;
  value: string;
  created_at: string;
}

interface TradeRow {
  action: string;
  token: string;
  amount_usd: number;
  price_at_execution: number;
  chain_id: number;
  status: string;
  pnl_usd: number | null;
  timestamp: number;
}

export interface ReviewMetrics {
  period: string;
  txCount: number;
  txSuccessRate: number;
  txFailureCount: number;
  tradeCount: number;
  winRate: number;
  grossPnl: number;
  totalGasCost: number;
  netPnl: number;
  feeDragRatio: number;
  profitFactor: { gross: number; net: number };
  avgWinner: number;
  avgLoser: number;
  skillBreakdown: Record<string, { count: number; successRate: number }>;
  chainBreakdown: Record<string, { txCount: number; gasCost: number; tradePnl: number }>;
  holdingBuckets: Record<string, { count: number; winRate: number; pnl: number }>;
}

// ─── Metric Computation (pure TypeScript, zero LLM) ─────────

function computeMetrics(
  db: Database.Database,
  userId: string,
  periodDays: number,
  agentId?: string,
): ReviewMetrics {
  const periodLabel = periodDays === 1 ? "24h" : periodDays === 7 ? "7d" : `${periodDays}d`;

  // ─── Transaction log analysis ─────────────────────────────
  const txRows = db.prepare(
    `SELECT chain_id, skill_name, status, gas_cost_usd, value, created_at
     FROM tx_log
     WHERE user_id = ? AND created_at >= datetime('now', '-' || ? || ' day')
     ORDER BY created_at ASC`,
  ).all(userId, periodDays) as TxRow[];

  const txCount = txRows.length;
  const txSuccesses = txRows.filter((t) => t.status === "confirmed").length;
  const txFailures = txRows.filter((t) => t.status === "failed").length;
  const txSuccessRate = txCount > 0 ? (txSuccesses / txCount) * 100 : 0;

  // Gas cost totals
  let totalGasCost = 0;
  const chainGas: Record<number, number> = {};
  for (const tx of txRows) {
    if (tx.gas_cost_usd) {
      totalGasCost += tx.gas_cost_usd;
      chainGas[tx.chain_id] = (chainGas[tx.chain_id] ?? 0) + tx.gas_cost_usd;
    }
  }

  // Skill execution breakdown
  const skillMap: Record<string, { total: number; successes: number }> = {};
  for (const tx of txRows) {
    const name = tx.skill_name || "unknown";
    if (!skillMap[name]) skillMap[name] = { total: 0, successes: 0 };
    skillMap[name].total++;
    if (tx.status === "confirmed") skillMap[name].successes++;
  }

  const skillBreakdown: Record<string, { count: number; successRate: number }> = {};
  for (const [name, data] of Object.entries(skillMap)) {
    skillBreakdown[name] = {
      count: data.total,
      successRate: data.total > 0 ? (data.successes / data.total) * 100 : 0,
    };
  }

  // ─── Agent trades analysis ────────────────────────────────
  const timestampCutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  let tradeQuery = `SELECT action, token, amount_usd, price_at_execution, chain_id, status, pnl_usd, timestamp
     FROM agent_trades WHERE timestamp >= ?`;
  const tradeParams: unknown[] = [timestampCutoff];

  if (agentId) {
    tradeQuery += " AND agent_id = ?";
    tradeParams.push(agentId);
  }

  tradeQuery += " ORDER BY timestamp ASC";

  let tradeRows: TradeRow[] = [];
  try {
    tradeRows = db.prepare(tradeQuery).all(...tradeParams) as TradeRow[];
  } catch {
    // agent_trades table may not exist if agent-sdk isn't used
    logger.debug("agent_trades table not available, skipping trade analysis");
  }

  const executedTrades = tradeRows.filter((t) => t.status === "executed");
  const withPnl = executedTrades.filter((t) => t.pnl_usd != null);
  const winners = withPnl.filter((t) => t.pnl_usd! > 0);
  const losers = withPnl.filter((t) => t.pnl_usd! < 0);

  const grossPnl = withPnl.reduce((s, t) => s + t.pnl_usd!, 0);
  const netPnl = grossPnl - totalGasCost;
  const winRate = withPnl.length > 0 ? (winners.length / withPnl.length) * 100 : 0;

  const totalWins = winners.reduce((s, t) => s + t.pnl_usd!, 0);
  const totalLosses = Math.abs(losers.reduce((s, t) => s + t.pnl_usd!, 0));
  const avgWinner = winners.length > 0 ? totalWins / winners.length : 0;
  const avgLoser = losers.length > 0 ? totalLosses / losers.length : 0;

  const grossPF = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
  const netWins = totalWins - totalGasCost;
  const netPF = totalLosses > 0 ? Math.max(0, netWins) / totalLosses : netWins > 0 ? Infinity : 0;

  // Chain breakdown for trades
  const chainTrades: Record<number, { txCount: number; pnl: number }> = {};
  for (const t of withPnl) {
    if (!chainTrades[t.chain_id]) chainTrades[t.chain_id] = { txCount: 0, pnl: 0 };
    chainTrades[t.chain_id].txCount++;
    chainTrades[t.chain_id].pnl += t.pnl_usd!;
  }

  const chainBreakdown: Record<string, { txCount: number; gasCost: number; tradePnl: number }> = {};
  const allChainIds = new Set([...Object.keys(chainGas).map(Number), ...Object.keys(chainTrades).map(Number)]);
  for (const cid of allChainIds) {
    const name = getChainName(cid) || `Chain ${cid}`;
    chainBreakdown[name] = {
      txCount: txRows.filter((t) => t.chain_id === cid).length,
      gasCost: chainGas[cid] ?? 0,
      tradePnl: chainTrades[cid]?.pnl ?? 0,
    };
  }

  // Holding period buckets (based on trades only — pair buys with sells)
  const holdingBuckets: Record<string, { count: number; wins: number; pnl: number }> = {
    "< 1h": { count: 0, wins: 0, pnl: 0 },
    "1-6h": { count: 0, wins: 0, pnl: 0 },
    "6-24h": { count: 0, wins: 0, pnl: 0 },
    "> 24h": { count: 0, wins: 0, pnl: 0 },
  };

  // Simple heuristic: pair sequential buy/sell of same token
  const buyTimestamps: Record<string, number> = {};
  for (const t of tradeRows) {
    if (t.action === "buy") {
      buyTimestamps[t.token] = t.timestamp;
    } else if (t.action === "sell" && buyTimestamps[t.token]) {
      const durationMs = t.timestamp - buyTimestamps[t.token];
      const durationH = durationMs / (1000 * 60 * 60);
      const bucket = durationH < 1 ? "< 1h" : durationH < 6 ? "1-6h" : durationH < 24 ? "6-24h" : "> 24h";
      holdingBuckets[bucket].count++;
      holdingBuckets[bucket].pnl += t.pnl_usd ?? 0;
      if ((t.pnl_usd ?? 0) > 0) holdingBuckets[bucket].wins++;
      delete buyTimestamps[t.token];
    }
  }

  const formattedBuckets: Record<string, { count: number; winRate: number; pnl: number }> = {};
  for (const [key, data] of Object.entries(holdingBuckets)) {
    formattedBuckets[key] = {
      count: data.count,
      winRate: data.count > 0 ? (data.wins / data.count) * 100 : 0,
      pnl: data.pnl,
    };
  }

  // Fee drag ratio: gas / portfolio proxy (total trade volume as rough proxy)
  const totalVolume = executedTrades.reduce((s, t) => s + t.amount_usd, 0);
  const feeDragRatio = totalVolume > 0 ? (totalGasCost / totalVolume) * 100 : 0;

  return {
    period: periodLabel,
    txCount,
    txSuccessRate,
    txFailureCount: txFailures,
    tradeCount: withPnl.length,
    winRate,
    grossPnl,
    totalGasCost,
    netPnl,
    feeDragRatio,
    profitFactor: { gross: grossPF, net: netPF },
    avgWinner,
    avgLoser,
    skillBreakdown,
    chainBreakdown,
    holdingBuckets: formattedBuckets,
  };
}

// ─── Report Formatting ──────────────────────────────────────

function formatReport(m: ReviewMetrics): string {
  const lines: string[] = [];

  lines.push(`## Performance Review — ${m.period}`);
  lines.push("");

  // Summary
  lines.push("### Summary");
  lines.push(`- Transactions: ${m.txCount} (${m.txSuccessRate.toFixed(0)}% success, ${m.txFailureCount} failed)`);
  lines.push(`- Trades with PnL: ${m.tradeCount}`);
  lines.push(`- Win rate: ${m.winRate.toFixed(1)}%`);
  lines.push(`- Gross PnL: ${m.grossPnl >= 0 ? "+" : ""}$${m.grossPnl.toFixed(2)}`);
  lines.push(`- Gas costs: $${m.totalGasCost.toFixed(2)}`);
  lines.push(`- Net PnL: ${m.netPnl >= 0 ? "+" : ""}$${m.netPnl.toFixed(2)}`);
  lines.push(`- Fee drag ratio: ${m.feeDragRatio.toFixed(2)}%`);
  lines.push(`- Profit factor: ${fmtPF(m.profitFactor.gross)} gross / ${fmtPF(m.profitFactor.net)} net`);
  lines.push(`- Avg winner: +$${m.avgWinner.toFixed(2)} | Avg loser: -$${m.avgLoser.toFixed(2)}`);

  // Fee drag warning
  if (m.grossPnl > 0 && m.netPnl < 0) {
    lines.push("");
    lines.push("**Warning: Gross positive but net negative — fees are eating profits.**");
  }
  if (m.feeDragRatio > 10) {
    lines.push("");
    lines.push("**Critical: Fee drag ratio > 10%. Consider fewer, higher-quality trades.**");
  } else if (m.feeDragRatio > 5) {
    lines.push("");
    lines.push("**Warning: Fee drag ratio > 5%. Monitor gas costs closely.**");
  }

  // Skill breakdown
  if (Object.keys(m.skillBreakdown).length > 0) {
    lines.push("");
    lines.push("### Skill Execution");
    lines.push("```");
    lines.push("Skill            | Count | Success Rate");
    for (const [name, data] of Object.entries(m.skillBreakdown)) {
      lines.push(`${name.padEnd(17)}| ${String(data.count).padEnd(6)}| ${data.successRate.toFixed(0)}%`);
    }
    lines.push("```");
  }

  // Chain breakdown
  if (Object.keys(m.chainBreakdown).length > 0) {
    lines.push("");
    lines.push("### Per-Chain Breakdown");
    lines.push("```");
    lines.push("Chain            | TXs   | Gas Cost  | Trade PnL");
    for (const [name, data] of Object.entries(m.chainBreakdown)) {
      lines.push(
        `${name.padEnd(17)}| ${String(data.txCount).padEnd(6)}| $${data.gasCost.toFixed(2).padEnd(8)}| ${data.tradePnl >= 0 ? "+" : ""}$${data.tradePnl.toFixed(2)}`,
      );
    }
    lines.push("```");
  }

  // Holding period buckets
  const bucketsWithTrades = Object.entries(m.holdingBuckets).filter(([, d]) => d.count > 0);
  if (bucketsWithTrades.length > 0) {
    lines.push("");
    lines.push("### Holding Period Analysis");
    lines.push("```");
    lines.push("Duration  | Trades | Win Rate | PnL");
    for (const [bucket, data] of bucketsWithTrades) {
      lines.push(
        `${bucket.padEnd(10)}| ${String(data.count).padEnd(7)}| ${data.winRate.toFixed(0)}%`.padEnd(28) + `| ${data.pnl >= 0 ? "+" : ""}$${data.pnl.toFixed(2)}`,
      );
    }
    lines.push("```");
  }

  return lines.join("\n");
}

function fmtPF(pf: number): string {
  if (pf === Infinity) return "INF";
  return pf.toFixed(2) + "x";
}

// ─── Skill Definition ───────────────────────────────────────

const performanceReviewerParams = z.object({
  period: z.enum(["24h", "7d", "30d"]).default("24h"),
  agentId: z.string().optional(),
});

export function createPerformanceReviewerSkill(db: Database.Database): SkillDefinition {
  return {
    name: "performance-reviewer",
    description: "Analyze trading performance with win rates, fee drag, per-chain breakdown, and holding period analysis",
    parameters: performanceReviewerParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = performanceReviewerParams.parse(params);

      const periodDays = parsed.period === "24h" ? 1 : parsed.period === "7d" ? 7 : 30;

      try {
        const metrics = computeMetrics(db, context.userId, periodDays, parsed.agentId);
        const report = formatReport(metrics);

        await context.sendReply(report);

        void triggerHook(createHookEvent("diag", "performance_review_completed", {
          userId: context.userId,
          period: parsed.period,
          txCount: metrics.txCount,
          netPnl: metrics.netPnl,
          winRate: metrics.winRate,
        }));

        return { success: true, message: `Performance review for ${parsed.period} completed.`, data: metrics };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logger.error({ err, userId: context.userId }, "Performance review failed");
        return { success: false, message: `Performance review failed: ${msg}` };
      }
    },
  };
}

export { computeMetrics, formatReport };
