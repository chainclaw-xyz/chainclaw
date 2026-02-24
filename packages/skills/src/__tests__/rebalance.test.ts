import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRebalanceSkill } from "../rebalance.js";
import type { SkillExecutionContext } from "../types.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  fetchWithRetry: (...args: unknown[]) => globalThis.fetch(...(args as Parameters<typeof fetch>)),
}));

vi.mock("../prices.js", () => ({
  getEthPriceUsd: vi.fn(async () => 3000),
  getTokenPrice: vi.fn(async (symbol: string) => {
    const prices: Record<string, number> = { ETH: 3000, USDC: 1, DAI: 1, WETH: 3000 };
    return prices[symbol.toUpperCase()] ?? null;
  }),
}));

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

const mockPortfolio = {
  chains: [
    {
      chainId: 1,
      chainName: "Ethereum",
      tokens: [
        { symbol: "ETH", formatted: "1.0", address: "0xEee", decimals: 18 },
        { symbol: "USDC", formatted: "1000", address: "0xA0b", decimals: 6 },
        { symbol: "DAI", formatted: "500", address: "0x6B1", decimals: 18 },
      ],
    },
  ],
};

describe("createRebalanceSkill", () => {
  const mockExecutor = {
    execute: vi.fn().mockResolvedValue({ success: true, message: "Swap complete" }),
  };
  const mockWalletManager = {
    getSigner: vi.fn().mockReturnValue({ address: "0xABC" }),
  };
  const mockChainManager = {
    getPortfolio: vi.fn().mockResolvedValue(mockPortfolio),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("preview shows delta table without executing", async () => {
    const skill = createRebalanceSkill(
      mockExecutor as any, mockWalletManager as any, mockChainManager as any,
    );

    // Total: $3000 (ETH) + $1000 (USDC) + $500 (DAI) = $4500
    // Target: ETH 50% = $2250, USDC 30% = $1350, DAI 20% = $900
    const result = await skill.execute(
      { action: "preview", allocations: { ETH: 50, USDC: 30, DAI: 20 } },
      mockContext(),
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("Rebalance Plan");
    expect(result.message).toContain("ETH");
    expect(result.message).toContain("USDC");
    expect(result.message).toContain("DAI");
    // Should not execute any swaps
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it("rejects allocations that don't sum to 100", async () => {
    const skill = createRebalanceSkill(
      mockExecutor as any, mockWalletManager as any, mockChainManager as any,
    );

    const result = await skill.execute(
      { action: "preview", allocations: { ETH: 50, USDC: 30 } },
      mockContext(),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("sum to 100%");
  });

  it("no wallet returns error", async () => {
    const skill = createRebalanceSkill(
      mockExecutor as any, mockWalletManager as any, mockChainManager as any,
    );

    const result = await skill.execute(
      { action: "preview", allocations: { ETH: 100 } },
      mockContext({ walletAddress: undefined }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("No wallet configured");
  });

  it("already balanced portfolio says so", async () => {
    // Portfolio: ETH=$3000, USDC=$1000, DAI=$500 -> total=$4500
    // Target: ETH=66.67, USDC=22.22, DAI=11.11 -> approx current allocation
    const skill = createRebalanceSkill(
      mockExecutor as any, mockWalletManager as any, mockChainManager as any,
    );

    const result = await skill.execute(
      { action: "preview", allocations: { ETH: 66.67, USDC: 22.22, DAI: 11.11 } },
      mockContext(),
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("already balanced");
  });

  it("execute mode asks for confirmation", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        toAmount: "100000000",
        tx: { to: "0xRouter", data: "0xswap", value: "0", gas: 200000 },
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const ctx = mockContext();
    const skill = createRebalanceSkill(
      mockExecutor as any, mockWalletManager as any, mockChainManager as any,
    );

    await skill.execute(
      { action: "execute", allocations: { ETH: 50, USDC: 30, DAI: 20 } },
      ctx,
    );

    expect(ctx.requestConfirmation).toHaveBeenCalled();
  });

  it("cancellation returns cancelled message", async () => {
    const skill = createRebalanceSkill(
      mockExecutor as any, mockWalletManager as any, mockChainManager as any,
    );

    const result = await skill.execute(
      { action: "execute", allocations: { ETH: 50, USDC: 30, DAI: 20 } },
      mockContext({ requestConfirmation: vi.fn().mockResolvedValue(false) }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("cancelled");
  });
});
