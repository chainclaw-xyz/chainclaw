import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBacktestSkill } from "../backtest.js";
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

describe("createBacktestSkill", () => {
  const mockEngine = {
    run: vi.fn(),
    formatReport: vi.fn().mockReturnValue("*Backtest Report*\n+15.3% return"),
  };
  const mockResolveAgent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns formatted report on success", async () => {
    mockResolveAgent.mockReturnValue({ name: "DCA ETH", strategy: {} });
    mockEngine.run.mockResolvedValue({ totalReturn: 15.3 });

    const skill = createBacktestSkill(mockEngine as any, mockResolveAgent);
    const result = await skill.execute({ action: "run", strategy: "dca", token: "ETH" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("Backtest Report");
    expect(mockEngine.run).toHaveBeenCalledOnce();
  });

  it("unknown strategy returns error", async () => {
    mockResolveAgent.mockReturnValue(null);
    const skill = createBacktestSkill(mockEngine as any, mockResolveAgent);
    const result = await skill.execute({ action: "run", strategy: "dca", token: "ETH" }, mockContext());
    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown strategy");
  });

  it("engine.run throws returns error reply", async () => {
    mockResolveAgent.mockReturnValue({ name: "DCA ETH", strategy: {} });
    mockEngine.run.mockRejectedValue(new Error("Insufficient price data"));

    const skill = createBacktestSkill(mockEngine as any, mockResolveAgent);
    const result = await skill.execute({ action: "run", strategy: "dca", token: "ETH" }, mockContext());
    expect(result.success).toBe(false);
    expect(result.message).toContain("Backtest failed");
    expect(result.message).toContain("Insufficient price data");
  });

  it("sends progress message via sendReply", async () => {
    mockResolveAgent.mockReturnValue({ name: "DCA ETH", strategy: {} });
    mockEngine.run.mockResolvedValue({});
    const ctx = mockContext();

    const skill = createBacktestSkill(mockEngine as any, mockResolveAgent);
    await skill.execute({ action: "run" }, ctx);
    expect(ctx.sendReply).toHaveBeenCalledWith(expect.stringContaining("Running backtest"));
  });
});
