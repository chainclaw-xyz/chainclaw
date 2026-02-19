import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMarketplaceSkill } from "../marketplace.js";
import type { SkillExecutionContext } from "../types.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function mockContext(): SkillExecutionContext {
  return {
    userId: "user-1",
    walletAddress: "0xABCdef1234567890abcdef1234567890ABCDEF12",
    chainIds: [1],
    sendReply: vi.fn().mockResolvedValue(undefined),
  };
}

const sampleAgent = {
  name: "eth-dca-pro",
  version: "1.0",
  author: "alice",
  category: "dca",
  status: "active",
  description: "Professional ETH DCA strategy",
  chainSupport: ["ethereum", "base"],
  subscriberCount: 42,
  publishedAt: "2024-01-01",
  pricingModel: { type: "monthly", priceUsd: 9.99 },
  backtestMetrics: {
    totalReturnPercent: 15.3,
    winRate: 62,
    maxDrawdownPercent: 8.1,
    totalTrades: 156,
    sharpeRatio: 1.45,
  },
};

describe("createMarketplaceSkill", () => {
  const mockRegistry = {
    listAgents: vi.fn().mockReturnValue([sampleAgent]),
    getByCategory: vi.fn().mockReturnValue([sampleAgent]),
    search: vi.fn().mockReturnValue([sampleAgent]),
    getAgent: vi.fn().mockReturnValue(sampleAgent),
  };
  const mockSubscriptions = {
    subscribe: vi.fn().mockReturnValue({ id: "sub-1", instanceId: "inst-1" }),
    unsubscribe: vi.fn().mockReturnValue(true),
    getUserSubscriptions: vi.fn().mockReturnValue([
      { agentName: "eth-dca-pro", status: "active", id: "sub-1", instanceId: "inst-1", subscribedAt: "2024-01-01" },
    ]),
  };
  const mockLeaderboard = {
    formatLeaderboard: vi.fn().mockReturnValue("*Leaderboard*\n1. eth-dca-pro +15.3%"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("browse lists agents with descriptions and pricing", async () => {
    const skill = createMarketplaceSkill(mockRegistry as any, mockSubscriptions as any, mockLeaderboard as any);
    const result = await skill.execute({ action: "browse" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("eth-dca-pro");
    expect(result.message).toContain("$9.99/mo");
    expect(result.message).toContain("42 subscribers");
  });

  it("search returns matching agents", async () => {
    const skill = createMarketplaceSkill(mockRegistry as any, mockSubscriptions as any, mockLeaderboard as any);
    const result = await skill.execute({ action: "search", query: "dca" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("eth-dca-pro");
    expect(mockRegistry.search).toHaveBeenCalledWith("dca");
  });

  it("detail returns full agent info with backtest metrics", async () => {
    const skill = createMarketplaceSkill(mockRegistry as any, mockSubscriptions as any, mockLeaderboard as any);
    const result = await skill.execute({ action: "detail", agentName: "eth-dca-pro" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("eth-dca-pro");
    expect(result.message).toContain("alice");
    expect(result.message).toContain("+15.3%");
    expect(result.message).toContain("Sharpe");
  });

  it("subscribe creates subscription and returns IDs", async () => {
    const skill = createMarketplaceSkill(mockRegistry as any, mockSubscriptions as any, mockLeaderboard as any);
    const result = await skill.execute({ action: "subscribe", agentName: "eth-dca-pro" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("sub-1");
    expect(result.message).toContain("inst-1");
    expect(mockSubscriptions.subscribe).toHaveBeenCalledWith("user-1", "eth-dca-pro", undefined);
  });

  it("unsubscribe cancels subscription", async () => {
    const skill = createMarketplaceSkill(mockRegistry as any, mockSubscriptions as any, mockLeaderboard as any);
    const result = await skill.execute({ action: "unsubscribe", subscriptionId: "sub-1" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("cancelled");
    expect(mockSubscriptions.unsubscribe).toHaveBeenCalledWith("sub-1");
  });

  it("my-agents lists active subscriptions", async () => {
    const skill = createMarketplaceSkill(mockRegistry as any, mockSubscriptions as any, mockLeaderboard as any);
    const result = await skill.execute({ action: "my-agents" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("eth-dca-pro");
    expect(result.message).toContain("sub-1");
  });

  it("leaderboard returns ranked agents", async () => {
    const skill = createMarketplaceSkill(mockRegistry as any, mockSubscriptions as any, mockLeaderboard as any);
    const result = await skill.execute({ action: "leaderboard" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("Leaderboard");
    expect(mockLeaderboard.formatLeaderboard).toHaveBeenCalled();
  });
});
