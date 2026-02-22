import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { PerformanceTracker } from "../performance-tracker.js";
import type { TradeRecord } from "../types.js";

// Mock @chainclaw/core logger
vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("PerformanceTracker", () => {
  let db: Database.Database;
  let tracker: PerformanceTracker;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    tracker = new PerformanceTracker(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates and retrieves an agent instance", () => {
    tracker.createInstance("test-1", "test-agent", "1.0.0", "user1", "dry_run", { watchlist: ["ETH"] });

    const instance = tracker.getInstance("test-1");
    expect(instance).not.toBeNull();
    expect(instance!.name).toBe("test-agent");
    expect(instance!.version).toBe("1.0.0");
    expect(instance!.user_id).toBe("user1");
    expect(instance!.mode).toBe("dry_run");
    expect(instance!.status).toBe("running");
  });

  it("lists user instances", () => {
    tracker.createInstance("a1", "agent-a", "1.0.0", "user1", "dry_run", {});
    tracker.createInstance("a2", "agent-b", "1.0.0", "user1", "live", {});
    tracker.createInstance("a3", "agent-c", "1.0.0", "user2", "dry_run", {});

    const user1Agents = tracker.getUserInstances("user1");
    expect(user1Agents).toHaveLength(2);

    const user2Agents = tracker.getUserInstances("user2");
    expect(user2Agents).toHaveLength(1);
  });

  it("updates instance status", () => {
    tracker.createInstance("test-1", "agent", "1.0.0", "user1", "dry_run", {});

    tracker.updateInstanceStatus("test-1", "paused");
    expect(tracker.getInstance("test-1")!.status).toBe("paused");

    tracker.updateInstanceStatus("test-1", "stopped");
    const stopped = tracker.getInstance("test-1")!;
    expect(stopped.status).toBe("stopped");
    expect(stopped.stopped_at).not.toBeNull();
  });

  it("logs and retrieves trades", () => {
    tracker.createInstance("test-1", "agent", "1.0.0", "user1", "dry_run", {});

    const trade: TradeRecord = {
      id: "t1",
      agentId: "test-1",
      timestamp: 1700000000,
      action: "buy",
      token: "ETH",
      amountUsd: 100,
      priceAtExecution: 2500,
      chainId: 1,
      reasoning: "DCA buy",
      signals: [{ token: "ETH", strength: "buy", confidence: 0.8, reasoning: "DCA", timestamp: 1700000000 }],
      status: "executed",
    };

    tracker.logTrade(trade);

    const trades = tracker.getAgentTrades("test-1");
    expect(trades).toHaveLength(1);
    expect(trades[0].token).toBe("ETH");
    expect(trades[0].amountUsd).toBe(100);
    expect(trades[0].signals).toHaveLength(1);
  });

  it("logs and retrieves reasoning traces", () => {
    tracker.createInstance("test-1", "agent", "1.0.0", "user1", "dry_run", {});

    tracker.logReasoning(
      "test-1",
      1700000000,
      { prices: { ETH: 2500 } },
      [{ action: "buy", token: "ETH" }],
      "Price looks good for DCA entry",
    );

    const traces = tracker.getReasoningTraces("test-1");
    expect(traces).toHaveLength(1);
    expect(traces[0].reasoning).toBe("Price looks good for DCA entry");
  });

  it("computes metrics from trades", () => {
    tracker.createInstance("test-1", "agent", "1.0.0", "user1", "dry_run", {});

    // Log some trades with PnL
    for (let i = 0; i < 5; i++) {
      const trade: TradeRecord = {
        id: `t${i}`,
        agentId: "test-1",
        timestamp: 1700000000 + i * 86400,
        action: "buy",
        token: "ETH",
        amountUsd: 100,
        priceAtExecution: 2500 + i * 10,
        chainId: 1,
        reasoning: "DCA",
        signals: [],
        status: "executed",
        pnlUsd: i % 2 === 0 ? 10 : -5, // alternating profit/loss
      };
      tracker.logTrade(trade);
    }

    const metrics = tracker.computeMetrics("test-1");
    expect(metrics).not.toBeNull();
    expect(metrics!.totalTrades).toBe(5);
    expect(metrics!.profitableTrades).toBe(3); // i=0,2,4 are profitable
    expect(metrics!.winRate).toBe(60);
  });

  it("formatPerformanceSummary returns formatted string", () => {
    tracker.createInstance("test-1", "my-agent", "2.0.0", "user1", "live", {});

    const summary = tracker.formatPerformanceSummary("test-1");
    expect(summary).toContain("my-agent");
    expect(summary).toContain("v2.0.0");
    expect(summary).toContain("live");
  });

  it("returns null metrics when no trades", () => {
    tracker.createInstance("test-1", "agent", "1.0.0", "user1", "dry_run", {});
    const metrics = tracker.computeMetrics("test-1");
    expect(metrics).toBeNull();
  });
});
