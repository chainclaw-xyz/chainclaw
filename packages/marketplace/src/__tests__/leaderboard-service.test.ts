import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { AgentRegistry } from "../agent-registry.js";
import { LeaderboardService } from "../leaderboard-service.js";
import { PerformanceTracker, createSampleDcaAgent } from "@chainclaw/agent-sdk";

// Mock @chainclaw/core logger
vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("LeaderboardService", () => {
  let db: Database.Database;
  let registry: AgentRegistry;
  let tracker: PerformanceTracker;
  let leaderboard: LeaderboardService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    registry = new AgentRegistry(db);
    tracker = new PerformanceTracker(db);
    leaderboard = new LeaderboardService(registry, tracker);
  });

  afterEach(() => {
    db.close();
  });

  it("returns empty leaderboard when no agents", () => {
    const entries = leaderboard.getLeaderboard();
    expect(entries).toHaveLength(0);
  });

  it("returns empty leaderboard when agents have no metrics", () => {
    registry.registerFactory("dca", () => createSampleDcaAgent());
    registry.publish("dca", {
      version: "1.0.0",
      description: "test",
      author: "test",
      category: "dca",
    });

    const entries = leaderboard.getLeaderboard();
    expect(entries).toHaveLength(0);
  });

  it("ranks agents by total return", () => {
    registry.registerFactory("a", () => createSampleDcaAgent());
    registry.registerFactory("b", () => createSampleDcaAgent());
    registry.registerFactory("c", () => createSampleDcaAgent());

    registry.publish("a", {
      version: "1.0.0", description: "Agent A", author: "test", category: "dca",
      backtestMetrics: {
        totalReturnPercent: 10, maxDrawdownPercent: 5, sharpeRatio: 1.2, winRate: 60,
        totalTrades: 20, profitableTrades: 12, avgTradeReturnPercent: 0.5,
        avgTradeDurationMs: 86400000, benchmarkReturnPercent: 8, alpha: 2,
      },
    });

    registry.publish("b", {
      version: "1.0.0", description: "Agent B", author: "test", category: "trading",
      backtestMetrics: {
        totalReturnPercent: 25, maxDrawdownPercent: 12, sharpeRatio: 1.8, winRate: 70,
        totalTrades: 50, profitableTrades: 35, avgTradeReturnPercent: 0.5,
        avgTradeDurationMs: 86400000, benchmarkReturnPercent: 8, alpha: 17,
      },
    });

    registry.publish("c", {
      version: "1.0.0", description: "Agent C", author: "test", category: "dca",
      backtestMetrics: {
        totalReturnPercent: 15, maxDrawdownPercent: 7, sharpeRatio: 1.5, winRate: 65,
        totalTrades: 30, profitableTrades: 20, avgTradeReturnPercent: 0.5,
        avgTradeDurationMs: 86400000, benchmarkReturnPercent: 8, alpha: 7,
      },
    });

    const entries = leaderboard.getLeaderboard();
    expect(entries).toHaveLength(3);
    expect(entries[0]!.agentName).toBe("b"); // 25% return
    expect(entries[0]!.rank).toBe(1);
    expect(entries[1]!.agentName).toBe("c"); // 15% return
    expect(entries[1]!.rank).toBe(2);
    expect(entries[2]!.agentName).toBe("a"); // 10% return
    expect(entries[2]!.rank).toBe(3);
  });

  it("filters leaderboard by category", () => {
    registry.registerFactory("a", () => createSampleDcaAgent());
    registry.registerFactory("b", () => createSampleDcaAgent());

    registry.publish("a", {
      version: "1.0.0", description: "test", author: "test", category: "dca",
      backtestMetrics: {
        totalReturnPercent: 10, maxDrawdownPercent: 5, sharpeRatio: 1, winRate: 60,
        totalTrades: 20, profitableTrades: 12, avgTradeReturnPercent: 0.5,
        avgTradeDurationMs: 0, benchmarkReturnPercent: 0, alpha: 0,
      },
    });

    registry.publish("b", {
      version: "1.0.0", description: "test", author: "test", category: "trading",
      backtestMetrics: {
        totalReturnPercent: 20, maxDrawdownPercent: 10, sharpeRatio: 1.5, winRate: 70,
        totalTrades: 40, profitableTrades: 28, avgTradeReturnPercent: 0.5,
        avgTradeDurationMs: 0, benchmarkReturnPercent: 0, alpha: 0,
      },
    });

    const dcaOnly = leaderboard.getLeaderboard({ category: "dca" });
    expect(dcaOnly).toHaveLength(1);
    expect(dcaOnly[0]!.agentName).toBe("a");
  });

  it("respects limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      const name = `agent-${i}`;
      registry.registerFactory(name, () => createSampleDcaAgent());
      registry.publish(name, {
        version: "1.0.0", description: "test", author: "test", category: "dca",
        backtestMetrics: {
          totalReturnPercent: i * 5, maxDrawdownPercent: 5, sharpeRatio: 1, winRate: 60,
          totalTrades: 10, profitableTrades: 6, avgTradeReturnPercent: 0.5,
          avgTradeDurationMs: 0, benchmarkReturnPercent: 0, alpha: 0,
        },
      });
    }

    const top3 = leaderboard.getLeaderboard({ limit: 3 });
    expect(top3).toHaveLength(3);
    expect(top3[0]!.totalReturnPercent).toBe(20); // agent-4
    expect(top3[2]!.totalReturnPercent).toBe(10); // agent-2
  });

  it("getAgentRank returns correct rank", () => {
    registry.registerFactory("a", () => createSampleDcaAgent());
    registry.registerFactory("b", () => createSampleDcaAgent());

    registry.publish("a", {
      version: "1.0.0", description: "test", author: "test", category: "dca",
      backtestMetrics: {
        totalReturnPercent: 10, maxDrawdownPercent: 5, sharpeRatio: 1, winRate: 60,
        totalTrades: 20, profitableTrades: 12, avgTradeReturnPercent: 0.5,
        avgTradeDurationMs: 0, benchmarkReturnPercent: 0, alpha: 0,
      },
    });

    registry.publish("b", {
      version: "1.0.0", description: "test", author: "test", category: "dca",
      backtestMetrics: {
        totalReturnPercent: 20, maxDrawdownPercent: 10, sharpeRatio: 1.5, winRate: 70,
        totalTrades: 40, profitableTrades: 28, avgTradeReturnPercent: 0.5,
        avgTradeDurationMs: 0, benchmarkReturnPercent: 0, alpha: 0,
      },
    });

    expect(leaderboard.getAgentRank("b")).toBe(1);
    expect(leaderboard.getAgentRank("a")).toBe(2);
    expect(leaderboard.getAgentRank("nonexistent")).toBeNull();
  });

  it("formatLeaderboard produces readable output", () => {
    registry.registerFactory("dca", () => createSampleDcaAgent());
    registry.publish("dca", {
      version: "1.0.0", description: "test", author: "test", category: "dca",
      backtestMetrics: {
        totalReturnPercent: 15.5, maxDrawdownPercent: 8.2, sharpeRatio: 1.3, winRate: 65,
        totalTrades: 24, profitableTrades: 16, avgTradeReturnPercent: 0.6,
        avgTradeDurationMs: 0, benchmarkReturnPercent: 10, alpha: 5.5,
      },
    });

    const report = leaderboard.formatLeaderboard();
    expect(report).toContain("Marketplace Leaderboard");
    expect(report).toContain("dca");
    expect(report).toContain("+15.5%");
    expect(report).toContain("65%");
  });

  it("formatLeaderboard shows empty message when no data", () => {
    const report = leaderboard.formatLeaderboard();
    expect(report).toContain("No agents with performance data");
  });

  describe("live trade data leaderboard", () => {
    let liveLeaderboard: LeaderboardService;

    beforeEach(() => {
      // Create leaderboard with db for live queries
      liveLeaderboard = new LeaderboardService(registry, tracker, db);

      // Need marketplace_subscriptions table
      db.exec(`
        CREATE TABLE IF NOT EXISTS marketplace_subscriptions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
          cancelled_at TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          instance_id TEXT
        );
      `);
    });

    it("uses live trade data when timeWindow is specified", () => {
      registry.registerFactory("live-agent", () => createSampleDcaAgent());
      registry.publish("live-agent", {
        version: "1.0.0", description: "test", author: "test", category: "dca",
      });

      // Create agent instance + subscription
      const agentId = "agent-live-1";
      tracker.createInstance(agentId, "live-agent", "1.0.0", "user-1", "dry_run", {});
      db.prepare(
        "INSERT INTO marketplace_subscriptions (id, user_id, agent_name, instance_id) VALUES (?, ?, ?, ?)",
      ).run("sub-1", "user-1", "live-agent", agentId);

      // Insert recent trades (within 7 days)
      const recentTs = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      tracker.logTrade({
        id: "t1", agentId, timestamp: recentTs, action: "buy", token: "ETH",
        amountUsd: 100, priceAtExecution: 2000, chainId: 1,
        reasoning: "test", signals: [], status: "executed", pnlUsd: 5,
      });
      tracker.logTrade({
        id: "t2", agentId, timestamp: recentTs + 100, action: "buy", token: "ETH",
        amountUsd: 100, priceAtExecution: 2000, chainId: 1,
        reasoning: "test", signals: [], status: "executed", pnlUsd: -2,
      });

      const entries = liveLeaderboard.getLeaderboard({ timeWindow: "7d" });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.agentName).toBe("live-agent");
      expect(entries[0]!.totalTrades).toBe(2);
      expect(entries[0]!.totalReturnPercent).toBe(3); // 5 + (-2) = 3
      expect(entries[0]!.winRate).toBe(50); // 1 of 2 profitable
    });

    it("falls back to backtestMetrics when no live trades", () => {
      registry.registerFactory("backtest-only", () => createSampleDcaAgent());
      registry.publish("backtest-only", {
        version: "1.0.0", description: "test", author: "test", category: "dca",
        backtestMetrics: {
          totalReturnPercent: 15, maxDrawdownPercent: 5, sharpeRatio: 1, winRate: 60,
          totalTrades: 20, profitableTrades: 12, avgTradeReturnPercent: 0.5,
          avgTradeDurationMs: 0, benchmarkReturnPercent: 0, alpha: 0,
        },
      });

      const entries = liveLeaderboard.getLeaderboard({ timeWindow: "7d" });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.totalReturnPercent).toBe(15); // From backtest
    });

    it("filters trades by time window correctly", () => {
      registry.registerFactory("window-agent", () => createSampleDcaAgent());
      registry.publish("window-agent", {
        version: "1.0.0", description: "test", author: "test", category: "trading",
      });

      const agentId = "agent-window-1";
      tracker.createInstance(agentId, "window-agent", "1.0.0", "user-1", "dry_run", {});
      db.prepare(
        "INSERT INTO marketplace_subscriptions (id, user_id, agent_name, instance_id) VALUES (?, ?, ?, ?)",
      ).run("sub-2", "user-1", "window-agent", agentId);

      const now = Math.floor(Date.now() / 1000);
      // Trade within 7d
      tracker.logTrade({
        id: "recent", agentId, timestamp: now - 86400, action: "buy", token: "ETH",
        amountUsd: 100, priceAtExecution: 2000, chainId: 1,
        reasoning: "recent", signals: [], status: "executed", pnlUsd: 10,
      });
      // Trade 30 days ago (outside 7d window)
      tracker.logTrade({
        id: "old", agentId, timestamp: now - 30 * 86400, action: "buy", token: "ETH",
        amountUsd: 100, priceAtExecution: 2000, chainId: 1,
        reasoning: "old", signals: [], status: "executed", pnlUsd: 50,
      });

      const entries7d = liveLeaderboard.getLeaderboard({ timeWindow: "7d" });
      expect(entries7d).toHaveLength(1);
      expect(entries7d[0]!.totalTrades).toBe(1); // Only the recent trade
      expect(entries7d[0]!.totalReturnPercent).toBe(10);

      const entries30d = liveLeaderboard.getLeaderboard({ timeWindow: "30d" });
      expect(entries30d).toHaveLength(1);
      expect(entries30d[0]!.totalTrades).toBe(2); // Both trades
      expect(entries30d[0]!.totalReturnPercent).toBe(60); // 10 + 50
    });
  });
});
