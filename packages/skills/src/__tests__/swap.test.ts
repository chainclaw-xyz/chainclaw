import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSwapSkill } from "../swap.js";
import type { SkillExecutionContext } from "../types.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../prices.js", () => ({
  getEthPriceUsd: vi.fn(async () => 3000),
}));

const mockFetch = vi.fn();

function mockContext(overrides?: Partial<SkillExecutionContext>): SkillExecutionContext {
  return {
    userId: "user-1",
    walletAddress: "0xABCdef1234567890abcdef1234567890ABCDEF12",
    chainIds: [1],
    sendReply: vi.fn().mockResolvedValue(undefined),
    requestConfirmation: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("createSwapSkill", () => {
  const mockExecutor = {
    execute: vi.fn().mockResolvedValue({ success: true, message: "Swap complete" }),
  };
  const mockWalletManager = {
    getSigner: vi.fn().mockReturnValue({ address: "0xABC" }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("returns quote with formatted amounts", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        toAmount: "1000000000000000000", // 1 ETH in wei
      }),
    });

    const skill = createSwapSkill(mockExecutor as any, mockWalletManager as any);
    const result = await skill.execute(
      { fromToken: "USDC", toToken: "ETH", amount: "3000", chainId: 1 },
      mockContext(),
    );
    expect(result.success).toBe(true);
    // No tx data means quote-only mode
    expect(result.message).toContain("Quote");
  });

  it("no wallet returns error", async () => {
    const skill = createSwapSkill(mockExecutor as any, mockWalletManager as any);
    const result = await skill.execute(
      { fromToken: "USDC", toToken: "ETH", amount: "100", chainId: 1 },
      mockContext({ walletAddress: undefined }),
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("No wallet configured");
  });

  it("missing 1inch API key shows quote-only mode", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ toAmount: "500000" }),
    });

    const skill = createSwapSkill(mockExecutor as any, mockWalletManager as any);
    const result = await skill.execute(
      { fromToken: "USDC", toToken: "USDT", amount: "500", chainId: 1 },
      mockContext(),
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain("quotes only");
  });

  it("invalid token pair returns error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400 });

    const skill = createSwapSkill(mockExecutor as any, mockWalletManager as any);
    const result = await skill.execute(
      { fromToken: "USDC", toToken: "UNKNOWN_TOKEN", amount: "100", chainId: 1 },
      mockContext(),
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("Could not get a swap quote");
  });

  it("executor failure returns error reply", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        toAmount: "1000000",
        tx: { to: "0x123", data: "0xabc", value: "0", gas: 200000 },
      }),
    });
    mockExecutor.execute.mockResolvedValue({ success: false, message: "Tx reverted" });

    const skill = createSwapSkill(mockExecutor as any, mockWalletManager as any, "test-api-key");
    const result = await skill.execute(
      { fromToken: "USDC", toToken: "ETH", amount: "100", chainId: 1 },
      mockContext(),
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("Tx reverted");
  });

  it("resolves slippage from preferences fallback", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ toAmount: "1000000" }),
    });

    const skill = createSwapSkill(mockExecutor as any, mockWalletManager as any);
    const ctx = mockContext({ preferences: { slippageTolerance: 0.5 } });
    await skill.execute(
      { fromToken: "ETH", toToken: "USDC", amount: "1", chainId: 1 },
      ctx,
    );
    // Verify the sendReply was called with 0.5% slippage
    expect(ctx.sendReply).toHaveBeenCalledWith(expect.stringContaining("0.5%"));
  });
});
