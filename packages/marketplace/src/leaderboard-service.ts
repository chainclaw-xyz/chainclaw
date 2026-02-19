import type Database from "better-sqlite3";
import { getLogger } from "@chainclaw/core";
import type { PerformanceTracker } from "@chainclaw/agent-sdk";
import type { AgentRegistry } from "./agent-registry.js";
import type { LeaderboardEntry, LeaderboardOptions, LeaderboardTimeWindow } from "./types.js";

const logger = getLogger("leaderboard-service");

const TIME_WINDOW_MS: Record<LeaderboardTimeWindow, number> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  "all": 0,
};

interface LiveTradeRow {
  agent_name: string;
  pnl_usd: number | null;
  amount_usd: number;
  status: string;
}

export class LeaderboardService {
  constructor(
    private registry: AgentRegistry,
    private tracker: PerformanceTracker,
    private db?: Database.Database,
  ) {}

  getLeaderboard(options: LeaderboardOptions = {}): LeaderboardEntry[] {
    const { category, limit = 20, timeWindow } = options;

    let agents = this.registry.listAgents();
    if (category) {
      agents = agents.filter((a) => a.category === category);
    }

    const entries: LeaderboardEntry[] = [];

    for (const agent of agents) {
      // Use live data for specific time windows when DB is available
      if (timeWindow && timeWindow !== "all" && this.db) {
        const liveEntry = this.computeLiveMetrics(agent.name, timeWindow);
        if (liveEntry) {
          liveEntry.category = agent.category;
          liveEntry.subscriberCount = agent.subscriberCount;
          entries.push(liveEntry);
          continue;
        }
      }

      // Fall back to static backtest metrics
      const metrics = agent.backtestMetrics;
      if (metrics && metrics.totalTrades > 0) {
        entries.push({
          rank: 0,
          agentName: agent.name,
          category: agent.category,
          totalReturnPercent: metrics.totalReturnPercent,
          winRate: metrics.winRate,
          sharpeRatio: metrics.sharpeRatio,
          maxDrawdownPercent: metrics.maxDrawdownPercent,
          totalTrades: metrics.totalTrades,
          subscriberCount: agent.subscriberCount,
        });
      }
    }

    // Sort by total return descending
    entries.sort((a, b) => b.totalReturnPercent - a.totalReturnPercent);

    // Assign ranks
    for (let i = 0; i < entries.length; i++) {
      entries[i]!.rank = i + 1;
    }

    return entries.slice(0, limit);
  }

  getAgentRank(agentName: string): number | null {
    const leaderboard = this.getLeaderboard({ limit: 1000 });
    const entry = leaderboard.find((e) => e.agentName === agentName);
    return entry?.rank ?? null;
  }

  formatLeaderboard(options: LeaderboardOptions = {}): string {
    const entries = this.getLeaderboard(options);
    const timeLabel = this.getTimeLabel(options.timeWindow);

    if (entries.length === 0) {
      return `*Marketplace Leaderboard (${timeLabel})*\n\n_No agents with performance data yet._`;
    }

    const lines = [
      `*Marketplace Leaderboard (${timeLabel})*`,
      "",
    ];

    for (const entry of entries) {
      const medal = entry.rank <= 3 ? ["", "\u{1F947}", "\u{1F948}", "\u{1F949}"][entry.rank] : `#${entry.rank}`;
      const returnStr = entry.totalReturnPercent >= 0
        ? `+${entry.totalReturnPercent.toFixed(1)}%`
        : `${entry.totalReturnPercent.toFixed(1)}%`;
      lines.push(
        `${medal} *${entry.agentName}* (${entry.category})`,
        `   Return: ${returnStr} | Win: ${entry.winRate.toFixed(0)}% | DD: ${entry.maxDrawdownPercent.toFixed(1)}%`,
        `   Trades: ${entry.totalTrades} | Subs: ${entry.subscriberCount}`,
      );
    }

    return lines.join("\n");
  }

  private computeLiveMetrics(agentName: string, timeWindow: LeaderboardTimeWindow): LeaderboardEntry | null {
    if (!this.db) return null;

    const windowMs = TIME_WINDOW_MS[timeWindow];
    if (!windowMs) return null;

    const windowStart = Math.floor((Date.now() - windowMs) / 1000);

    const rows = this.db.prepare(
      `SELECT t.pnl_usd, t.amount_usd, t.status
       FROM agent_trades t
       INNER JOIN marketplace_subscriptions s ON t.agent_id = s.instance_id
       WHERE s.agent_name = ?
         AND t.status = 'executed'
         AND t.timestamp >= ?`,
    ).all(agentName, windowStart) as LiveTradeRow[];

    if (rows.length === 0) return null;

    const totalPnl = rows.reduce((sum, r) => sum + (r.pnl_usd ?? 0), 0);
    const profitableTrades = rows.filter((r) => (r.pnl_usd ?? 0) > 0).length;
    const winRate = rows.length > 0 ? (profitableTrades / rows.length) * 100 : 0;

    // Simple max drawdown from cumulative PnL
    let peak = 0;
    let maxDrawdown = 0;
    let cumulative = 0;
    for (const row of rows) {
      cumulative += row.pnl_usd ?? 0;
      if (cumulative > peak) peak = cumulative;
      const drawdown = peak > 0 ? ((peak - cumulative) / peak) * 100 : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    return {
      rank: 0,
      agentName,
      category: "trading", // overridden by caller
      totalReturnPercent: totalPnl,
      winRate,
      sharpeRatio: 0,
      maxDrawdownPercent: maxDrawdown,
      totalTrades: rows.length,
      subscriberCount: 0, // overridden by caller
    };
  }

  private getTimeLabel(window?: LeaderboardTimeWindow): string {
    switch (window) {
      case "7d": return "7 days";
      case "30d": return "30 days";
      case "90d": return "90 days";
      default: return "All time";
    }
  }
}
