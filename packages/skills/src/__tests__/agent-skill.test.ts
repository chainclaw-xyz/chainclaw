import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAgentSkill } from "../agent-skill.js";
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

describe("createAgentSkill", () => {
  const mockRunner = {
    startAgent: vi.fn().mockReturnValue("agent-abc-123"),
    stopAgent: vi.fn().mockReturnValue(true),
    pauseAgent: vi.fn().mockReturnValue(true),
    resumeAgent: vi.fn().mockReturnValue(true),
    getRunningAgentIds: vi.fn().mockReturnValue(["agent-abc-123"]),
  };

  const mockTracker = {
    formatPerformanceSummary: vi.fn().mockReturnValue("*Performance*\n+5.2% return"),
    getActiveInstances: vi.fn().mockReturnValue([
      { id: "agent-abc-123", name: "DCA ETH", version: "1.0", status: "running", mode: "dry_run", started_at: "2024-01-01" },
    ]),
    getAgentTrades: vi.fn().mockReturnValue([
      { action: "buy", token: "ETH", amountUsd: 100, pnlUsd: 5.5, status: "filled", timestamp: 1704067200 },
    ]),
    getReasoningTraces: vi.fn().mockReturnValue([
      { timestamp: 1704067200, decisions_json: '[{"action":"buy","token":"ETH"}]', reasoning: "RSI oversold" },
    ]),
  };

  const mockResolveAgent = vi.fn().mockReturnValue({
    name: "DCA ETH",
    strategy: { evaluationIntervalMs: 300000 },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("start action returns agent ID", async () => {
    const skill = createAgentSkill(mockRunner as any, mockTracker as any, mockResolveAgent);
    const result = await skill.execute(
      { action: "start", strategy: "dca", token: "ETH", mode: "dry_run" },
      mockContext(),
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain("agent-abc-123");
    expect(mockRunner.startAgent).toHaveBeenCalledOnce();
  });

  it("stop action calls runner.stopAgent", async () => {
    const skill = createAgentSkill(mockRunner as any, mockTracker as any, mockResolveAgent);
    const result = await skill.execute({ action: "stop", agentId: "agent-abc-123" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("stopped");
    expect(mockRunner.stopAgent).toHaveBeenCalledWith("agent-abc-123");
  });

  it("pause action calls runner.pauseAgent", async () => {
    const skill = createAgentSkill(mockRunner as any, mockTracker as any, mockResolveAgent);
    const result = await skill.execute({ action: "pause", agentId: "agent-abc-123" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("paused");
  });

  it("resume action calls runner.resumeAgent", async () => {
    const skill = createAgentSkill(mockRunner as any, mockTracker as any, mockResolveAgent);
    const result = await skill.execute({ action: "resume", agentId: "agent-abc-123" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("resumed");
  });

  it("status action returns formatted performance summary", async () => {
    const skill = createAgentSkill(mockRunner as any, mockTracker as any, mockResolveAgent);
    const result = await skill.execute({ action: "status", agentId: "agent-abc-123" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("Performance");
    expect(mockTracker.formatPerformanceSummary).toHaveBeenCalledWith("agent-abc-123");
  });

  it("list action returns running agents", async () => {
    const skill = createAgentSkill(mockRunner as any, mockTracker as any, mockResolveAgent);
    const result = await skill.execute({ action: "list" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("DCA ETH");
    expect(result.message).toContain("agent-abc-123");
  });

  it("trades action returns formatted trade history", async () => {
    const skill = createAgentSkill(mockRunner as any, mockTracker as any, mockResolveAgent);
    const result = await skill.execute({ action: "trades", agentId: "agent-abc-123" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("BUY");
    expect(result.message).toContain("ETH");
  });

  it("reasoning action returns formatted reasoning traces", async () => {
    const skill = createAgentSkill(mockRunner as any, mockTracker as any, mockResolveAgent);
    const result = await skill.execute({ action: "reasoning", agentId: "agent-abc-123" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("buy ETH");
    expect(result.message).toContain("RSI oversold");
  });
});
