import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { AgentRegistry } from "../agent-registry.js";
import { SubscriptionManager } from "../subscription-manager.js";
import { PerformanceTracker, AgentRunner, createSampleDcaAgent } from "@chainclaw/agent-sdk";

// Mock @chainclaw/core logger
vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("SubscriptionManager", () => {
  let db: Database.Database;
  let registry: AgentRegistry;
  let tracker: PerformanceTracker;
  let runner: AgentRunner;
  let subscriptions: SubscriptionManager;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    registry = new AgentRegistry(db);
    tracker = new PerformanceTracker(db);
    runner = new AgentRunner(tracker, async () => 3000);
    subscriptions = new SubscriptionManager(db, registry, runner);

    // Register and publish a test agent
    registry.registerFactory("dca", (opts) =>
      createSampleDcaAgent({ targetToken: (opts?.targetToken as string) ?? "ETH" }),
    );
    registry.publish("dca", {
      version: "1.0.0",
      description: "DCA agent",
      author: "test",
      category: "dca",
    });
  });

  afterEach(() => {
    runner.stopAll();
    db.close();
  });

  it("subscribes a user to an agent", () => {
    const sub = subscriptions.subscribe("user1", "dca");

    expect(sub.userId).toBe("user1");
    expect(sub.agentName).toBe("dca");
    expect(sub.status).toBe("active");
    expect(sub.instanceId).not.toBeNull();
  });

  it("starts an agent instance on subscribe", () => {
    const sub = subscriptions.subscribe("user1", "dca");

    const agentIds = runner.getRunningAgentIds();
    expect(agentIds).toContain(sub.instanceId);
  });

  it("throws when subscribing to nonexistent agent", () => {
    expect(() => subscriptions.subscribe("user1", "nonexistent")).toThrow("not found");
  });

  it("throws when already subscribed", () => {
    subscriptions.subscribe("user1", "dca");
    expect(() => subscriptions.subscribe("user1", "dca")).toThrow("Already subscribed");
  });

  it("unsubscribes and stops agent", () => {
    const sub = subscriptions.subscribe("user1", "dca");
    const instanceId = sub.instanceId!;

    const result = subscriptions.unsubscribe(sub.id);
    expect(result).toBe(true);

    // Agent should be stopped
    expect(runner.getRunningAgentIds()).not.toContain(instanceId);

    // Subscription should be cancelled
    const updated = subscriptions.getSubscription(sub.id);
    expect(updated!.status).toBe("cancelled");
    expect(updated!.cancelledAt).not.toBeNull();
  });

  it("returns false for unsubscribing invalid subscription", () => {
    const result = subscriptions.unsubscribe("nonexistent");
    expect(result).toBe(false);
  });

  it("lists user subscriptions", () => {
    subscriptions.subscribe("user1", "dca");

    // Register another agent
    registry.registerFactory("dca2", () => createSampleDcaAgent());
    registry.publish("dca2", { version: "1.0.0", description: "test", author: "test", category: "dca" });
    subscriptions.subscribe("user1", "dca2");

    const subs = subscriptions.getUserSubscriptions("user1");
    expect(subs).toHaveLength(2);

    // Different user has no subscriptions
    const subs2 = subscriptions.getUserSubscriptions("user2");
    expect(subs2).toHaveLength(0);
  });

  it("lists agent subscribers", () => {
    subscriptions.subscribe("user1", "dca");
    subscriptions.subscribe("user2", "dca");

    const subs = subscriptions.getAgentSubscribers("dca");
    expect(subs).toHaveLength(2);
  });

  it("checks subscription status", () => {
    expect(subscriptions.isSubscribed("user1", "dca")).toBe(false);

    subscriptions.subscribe("user1", "dca");
    expect(subscriptions.isSubscribed("user1", "dca")).toBe(true);
  });

  it("filters active subscriptions only", () => {
    const sub = subscriptions.subscribe("user1", "dca");
    subscriptions.unsubscribe(sub.id);

    const activeSubs = subscriptions.getUserSubscriptions("user1", true);
    expect(activeSubs).toHaveLength(0);

    const allSubs = subscriptions.getUserSubscriptions("user1", false);
    expect(allSubs).toHaveLength(1);
    expect(allSubs[0]!.status).toBe("cancelled");
  });

  it("passes options to agent factory", () => {
    const sub = subscriptions.subscribe("user1", "dca", { targetToken: "BTC" });

    // The agent should have been started — verify via instance
    const instance = tracker.getInstance(sub.instanceId!);
    expect(instance).not.toBeNull();
    // Config stored should reflect BTC watchlist
    const config = JSON.parse(instance!.config_json) as { watchlist: string[] };
    expect(config.watchlist).toEqual(["BTC"]);
  });

  it("reflects subscriber count in registry", () => {
    subscriptions.subscribe("user1", "dca");
    subscriptions.subscribe("user2", "dca");

    const agent = registry.getAgent("dca");
    expect(agent!.subscriberCount).toBe(2);
  });
});
