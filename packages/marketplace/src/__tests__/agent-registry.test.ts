import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { AgentRegistry } from "../agent-registry.js";
import { createSampleDcaAgent } from "@chainclaw/agent-sdk";

// Mock @chainclaw/core logger
vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("AgentRegistry", () => {
  let db: Database.Database;
  let registry: AgentRegistry;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    registry = new AgentRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  it("registers and checks a factory", () => {
    registry.registerFactory("dca", () => createSampleDcaAgent());

    expect(registry.hasFactory("dca")).toBe(true);
    expect(registry.hasFactory("nonexistent")).toBe(false);
  });

  it("creates an agent from a factory", () => {
    registry.registerFactory("dca", (opts) =>
      createSampleDcaAgent({ targetToken: (opts?.targetToken as string) ?? "ETH" }),
    );

    const agent = registry.createAgent("dca", { targetToken: "BTC" });
    expect(agent).not.toBeNull();
    expect(agent!.strategy.watchlist).toEqual(["BTC"]);
  });

  it("returns null for unregistered factory", () => {
    const agent = registry.createAgent("nonexistent");
    expect(agent).toBeNull();
  });

  it("publishes an agent with metadata", () => {
    registry.registerFactory("dca", () => createSampleDcaAgent());
    registry.publish("dca", {
      version: "1.0.0",
      description: "DCA agent",
      author: "ChainClaw",
      category: "dca",
      chainSupport: [1, 8453],
    });

    const agent = registry.getAgent("dca");
    expect(agent).not.toBeNull();
    expect(agent!.name).toBe("dca");
    expect(agent!.version).toBe("1.0.0");
    expect(agent!.author).toBe("ChainClaw");
    expect(agent!.category).toBe("dca");
    expect(agent!.chainSupport).toEqual([1, 8453]);
    expect(agent!.status).toBe("active");
    expect(agent!.pricingModel).toEqual({ type: "free" });
  });

  it("throws when publishing without factory", () => {
    expect(() =>
      registry.publish("missing", {
        version: "1.0.0",
        description: "test",
        author: "test",
        category: "dca",
      }),
    ).toThrow("no factory registered");
  });

  it("updates an existing published agent", () => {
    registry.registerFactory("dca", () => createSampleDcaAgent());
    registry.publish("dca", {
      version: "1.0.0",
      description: "v1",
      author: "ChainClaw",
      category: "dca",
    });

    registry.publish("dca", {
      version: "2.0.0",
      description: "v2 updated",
      author: "ChainClaw",
      category: "dca",
    });

    const agent = registry.getAgent("dca");
    expect(agent!.version).toBe("2.0.0");
    expect(agent!.description).toBe("v2 updated");
  });

  it("lists active agents", () => {
    registry.registerFactory("a", () => createSampleDcaAgent());
    registry.registerFactory("b", () => createSampleDcaAgent());

    registry.publish("a", { version: "1.0.0", description: "Agent A", author: "test", category: "dca" });
    registry.publish("b", { version: "1.0.0", description: "Agent B", author: "test", category: "trading" });

    const agents = registry.listAgents();
    expect(agents).toHaveLength(2);
  });

  it("unpublishes an agent", () => {
    registry.registerFactory("dca", () => createSampleDcaAgent());
    registry.publish("dca", { version: "1.0.0", description: "test", author: "test", category: "dca" });

    const result = registry.unpublish("dca");
    expect(result).toBe(true);

    // Should not appear in active list
    const agents = registry.listAgents();
    expect(agents).toHaveLength(0);

    // But should appear with includeInactive
    const allAgents = registry.listAgents(true);
    expect(allAgents).toHaveLength(1);
    expect(allAgents[0]!.status).toBe("deprecated");
  });

  it("searches agents by name/description", () => {
    registry.registerFactory("eth-dca", () => createSampleDcaAgent());
    registry.registerFactory("btc-trader", () => createSampleDcaAgent());

    registry.publish("eth-dca", { version: "1.0.0", description: "Dollar cost average into ETH", author: "test", category: "dca" });
    registry.publish("btc-trader", { version: "1.0.0", description: "Active BTC trading", author: "test", category: "trading" });

    const ethResults = registry.search("ETH");
    expect(ethResults).toHaveLength(1);
    expect(ethResults[0]!.name).toBe("eth-dca");

    const tradingResults = registry.search("trading");
    expect(tradingResults).toHaveLength(1);
    expect(tradingResults[0]!.name).toBe("btc-trader");
  });

  it("filters agents by category", () => {
    registry.registerFactory("a", () => createSampleDcaAgent());
    registry.registerFactory("b", () => createSampleDcaAgent());

    registry.publish("a", { version: "1.0.0", description: "test", author: "test", category: "dca" });
    registry.publish("b", { version: "1.0.0", description: "test", author: "test", category: "trading" });

    const dcaAgents = registry.getByCategory("dca");
    expect(dcaAgents).toHaveLength(1);
    expect(dcaAgents[0]!.name).toBe("a");
  });

  it("stores and retrieves backtest metrics", () => {
    registry.registerFactory("dca", () => createSampleDcaAgent());
    registry.publish("dca", {
      version: "1.0.0",
      description: "test",
      author: "test",
      category: "dca",
      backtestMetrics: {
        totalReturnPercent: 15.5,
        maxDrawdownPercent: 8.2,
        sharpeRatio: 1.3,
        winRate: 65,
        totalTrades: 24,
        profitableTrades: 16,
        avgTradeReturnPercent: 0.6,
        avgTradeDurationMs: 86400000,
        benchmarkReturnPercent: 10,
        alpha: 5.5,
      },
    });

    const agent = registry.getAgent("dca");
    expect(agent!.backtestMetrics).not.toBeUndefined();
    expect(agent!.backtestMetrics!.totalReturnPercent).toBe(15.5);
    expect(agent!.backtestMetrics!.winRate).toBe(65);
  });

  it("publishes with custom pricing model", () => {
    registry.registerFactory("premium", () => createSampleDcaAgent());
    registry.publish("premium", {
      version: "1.0.0",
      description: "Premium agent",
      author: "test",
      category: "trading",
      pricingModel: { type: "monthly", priceUsd: 29.99 },
    });

    const agent = registry.getAgent("premium");
    expect(agent!.pricingModel).toEqual({ type: "monthly", priceUsd: 29.99 });
  });
});
