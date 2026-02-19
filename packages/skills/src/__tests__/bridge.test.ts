import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBridgeSkill } from "../bridge.js";
import type { SkillExecutionContext } from "../types.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../prices.js", () => ({
  getEthPriceUsd: vi.fn(async () => 3000),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockContext(overrides?: Partial<SkillExecutionContext>): SkillExecutionContext {
  return {
    userId: "user-1",
    walletAddress: "0xABCdef1234567890abcdef1234567890ABCDEF12",
    chainIds: [1, 8453],
    sendReply: vi.fn().mockResolvedValue(undefined),
    requestConfirmation: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const lifiQuoteResponse = {
  estimate: {
    toAmount: "990000000000000000",
    toAmountMin: "980000000000000000",
    executionDuration: 300,
    gasCosts: [{ amountUSD: "2.50" }],
    feeCosts: [{ amountUSD: "0.50" }],
  },
  transactionRequest: {
    to: "0xLiFiRouter",
    data: "0xbridge_data",
    value: "1000000000000000000",
    gasLimit: "300000",
    chainId: 1,
  },
  tool: "stargate",
  toolDetails: { name: "Stargate" },
  action: {
    fromChainId: 1,
    toChainId: 8453,
    fromToken: { symbol: "ETH", decimals: 18 },
    toToken: { symbol: "ETH", decimals: 18 },
  },
};

describe("createBridgeSkill", () => {
  const mockExecutor = {
    execute: vi.fn().mockResolvedValue({ success: true, message: "Bridge complete" }),
  };
  const mockWalletManager = {
    getSigner: vi.fn().mockReturnValue({ address: "0xABC" }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns bridge quote with fee and estimated time", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => lifiQuoteResponse,
    });

    const skill = createBridgeSkill(mockExecutor as any, mockWalletManager as any);
    const result = await skill.execute(
      { token: "ETH", amount: "1", fromChainId: 1, toChainId: 8453 },
      mockContext(),
    );
    expect(result.success).toBe(true);
    expect(mockExecutor.execute).toHaveBeenCalledOnce();
  });

  it("calls requestConfirmation before execution", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => lifiQuoteResponse,
    });

    const ctx = mockContext();
    const skill = createBridgeSkill(mockExecutor as any, mockWalletManager as any);
    await skill.execute(
      { token: "ETH", amount: "1", fromChainId: 1, toChainId: 8453 },
      ctx,
    );
    expect(ctx.requestConfirmation).toHaveBeenCalledOnce();
  });

  it("cancellation returns 'Bridge cancelled'", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => lifiQuoteResponse,
    });

    const skill = createBridgeSkill(mockExecutor as any, mockWalletManager as any);
    const result = await skill.execute(
      { token: "ETH", amount: "1", fromChainId: 1, toChainId: 8453 },
      mockContext({ requestConfirmation: vi.fn().mockResolvedValue(false) }),
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("Bridge cancelled");
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it("no wallet returns error", async () => {
    const skill = createBridgeSkill(mockExecutor as any, mockWalletManager as any);
    const result = await skill.execute(
      { token: "ETH", amount: "1", fromChainId: 1, toChainId: 8453 },
      mockContext({ walletAddress: undefined }),
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("No wallet configured");
  });

  it("same chain returns error", async () => {
    const skill = createBridgeSkill(mockExecutor as any, mockWalletManager as any);
    const result = await skill.execute(
      { token: "ETH", amount: "1", fromChainId: 1, toChainId: 1 },
      mockContext(),
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("must be different");
  });

  it("Li.Fi API failure returns error reply", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const skill = createBridgeSkill(mockExecutor as any, mockWalletManager as any);
    const result = await skill.execute(
      { token: "ETH", amount: "1", fromChainId: 1, toChainId: 8453 },
      mockContext(),
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("Could not find a bridge route");
  });
});
