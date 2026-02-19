import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentRunner } from "../agent-runner.js";
import type { AgentDefinition } from "../types.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function createMockDefinition(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    name: "Test DCA",
    version: "1.0",
    category: "dca",
    strategy: {
      watchlist: ["ETH", "BTC"],
      evaluationIntervalMs: 60000,
      evaluate: vi.fn().mockResolvedValue([]),
    },
    knowledgeSources: [],
    riskParams: {
      maxPositionSizeUsd: 10000,
      maxDrawdownPercent: 20,
      stopLossPercent: 5,
    },
    ...overrides,
  } as any;
}

describe("AgentRunner", () => {
  let runner: AgentRunner;
  let mockTracker: any;
  let mockFetchPrice: any;

  beforeEach(() => {
    vi.useFakeTimers();
    mockTracker = {
      createInstance: vi.fn(),
      updateInstanceStatus: vi.fn(),
      getInstance: vi.fn().mockReturnValue({ status: "paused" }),
      getAgentTrades: vi.fn().mockReturnValue([]),
      logReasoning: vi.fn(),
      logTrade: vi.fn(),
    };
    mockFetchPrice = vi.fn().mockResolvedValue(3000);
    runner = new AgentRunner(mockTracker, mockFetchPrice);
  });

  afterEach(() => {
    runner.stopAll();
    vi.useRealTimers();
  });

  it("startAgent returns unique agent ID", () => {
    const def = createMockDefinition();
    const id = runner.startAgent(def, "user-1");
    expect(id).toMatch(/^agent-/);
    expect(mockTracker.createInstance).toHaveBeenCalledOnce();
  });

  it("startAgent adds to running agents list", () => {
    const def = createMockDefinition();
    const id = runner.startAgent(def, "user-1");
    expect(runner.getRunningAgentIds()).toContain(id);
  });

  it("stopAgent removes agent and clears interval", () => {
    const def = createMockDefinition();
    const id = runner.startAgent(def, "user-1");
    const stopped = runner.stopAgent(id);
    expect(stopped).toBe(true);
    expect(runner.getRunningAgentIds()).not.toContain(id);
    expect(mockTracker.updateInstanceStatus).toHaveBeenCalledWith(id, "stopped");
  });

  it("stopAgent returns false for unknown ID", () => {
    expect(runner.stopAgent("nonexistent")).toBe(false);
  });

  it("pauseAgent pauses without removing", () => {
    const def = createMockDefinition();
    const id = runner.startAgent(def, "user-1");
    const paused = runner.pauseAgent(id);
    expect(paused).toBe(true);
    expect(mockTracker.updateInstanceStatus).toHaveBeenCalledWith(id, "paused");
    // Agent is still in the map
    expect(runner.getAgent(id)).toBeDefined();
  });

  it("resumeAgent restarts evaluation", () => {
    const def = createMockDefinition();
    const id = runner.startAgent(def, "user-1");
    runner.pauseAgent(id);
    const resumed = runner.resumeAgent(id);
    expect(resumed).toBe(true);
    expect(mockTracker.updateInstanceStatus).toHaveBeenCalledWith(id, "running");
  });

  it("evaluateAgent calls strategy.evaluate with context", async () => {
    const evaluate = vi.fn().mockResolvedValue([]);
    const def = createMockDefinition({
      strategy: {
        watchlist: ["ETH"],
        evaluationIntervalMs: 60000,
        evaluate,
      },
    } as any);

    runner.startAgent(def, "user-1");

    // Advance timer to trigger evaluation
    await vi.advanceTimersByTimeAsync(60001);

    expect(evaluate).toHaveBeenCalledOnce();
    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        prices: expect.objectContaining({ ETH: 3000 }),
      }),
    );
  });

  it("evaluateAgent skips decisions exceeding maxPositionSizeUsd", async () => {
    const evaluate = vi.fn().mockResolvedValue([
      { action: "buy", token: "ETH", amountUsd: 50000, chainId: 1, reasoning: "test", signals: [] },
    ]);
    const def = createMockDefinition({
      strategy: {
        watchlist: ["ETH"],
        evaluationIntervalMs: 60000,
        evaluate,
      },
      riskParams: { maxPositionSizeUsd: 10000, maxDrawdownPercent: 20, stopLossPercent: 5 },
    } as any);

    runner.startAgent(def, "user-1");
    await vi.advanceTimersByTimeAsync(60001);

    // Trade should be skipped — not logged
    expect(mockTracker.logTrade).not.toHaveBeenCalled();
  });

  it("evaluateAgent logs trades and reasoning to tracker", async () => {
    const evaluate = vi.fn().mockResolvedValue([
      { action: "buy", token: "ETH", amountUsd: 500, chainId: 1, reasoning: "RSI low", signals: ["rsi_30"] },
    ]);
    const def = createMockDefinition({
      strategy: {
        watchlist: ["ETH"],
        evaluationIntervalMs: 60000,
        evaluate,
      },
    } as any);

    runner.startAgent(def, "user-1");
    await vi.advanceTimersByTimeAsync(60001);

    expect(mockTracker.logReasoning).toHaveBeenCalledOnce();
    expect(mockTracker.logTrade).toHaveBeenCalledOnce();
    expect(mockTracker.logTrade).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "buy",
        token: "ETH",
        amountUsd: 500,
      }),
    );
  });
});
