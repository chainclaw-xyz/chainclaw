import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBalanceSkill } from "../balance.js";
import type { SkillExecutionContext } from "../types.js";

function mockContext(overrides?: Partial<SkillExecutionContext>): SkillExecutionContext {
  return {
    userId: "user-1",
    walletAddress: "0xABCdef1234567890abcdef1234567890ABCDEF12",
    chainIds: [1, 8453],
    sendReply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("createBalanceSkill", () => {
  const mockChainManager = {
    getPortfolio: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns formatted balances for multi-chain portfolio", async () => {
    mockChainManager.getPortfolio.mockResolvedValue({
      address: "0xABCdef1234567890abcdef1234567890ABCDEF12",
      chains: [
        { chainId: 1, chainName: "Ethereum", tokens: [{ symbol: "ETH", formatted: "2.5", address: null }] },
        { chainId: 8453, chainName: "Base", tokens: [{ symbol: "USDC", formatted: "1000", address: "0x833" }] },
      ],
    });
    const skill = createBalanceSkill(mockChainManager as any);
    const result = await skill.execute({}, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("Ethereum");
    expect(result.message).toContain("ETH");
    expect(result.message).toContain("Base");
    expect(result.message).toContain("USDC");
  });

  it("filters to single chain when chainId provided", async () => {
    mockChainManager.getPortfolio.mockResolvedValue({
      address: "0xABCdef1234567890abcdef1234567890ABCDEF12",
      chains: [
        { chainId: 1, chainName: "Ethereum", tokens: [{ symbol: "ETH", formatted: "1.0", address: null }] },
        { chainId: 8453, chainName: "Base", tokens: [{ symbol: "ETH", formatted: "0.5", address: null }] },
      ],
    });
    const skill = createBalanceSkill(mockChainManager as any);
    const result = await skill.execute({ chainId: 8453 }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("Base");
    expect(result.message).not.toContain("Ethereum");
  });

  it("returns error when walletAddress is null", async () => {
    const skill = createBalanceSkill(mockChainManager as any);
    const result = await skill.execute({}, mockContext({ walletAddress: undefined }));
    expect(result.success).toBe(false);
    expect(result.message).toContain("No wallet configured");
  });

  it("handles empty portfolio", async () => {
    mockChainManager.getPortfolio.mockResolvedValue({ address: "0xABC", chains: [] });
    const skill = createBalanceSkill(mockChainManager as any);
    const result = await skill.execute({}, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("No balances found");
  });

  it("shows 'No tokens found' for chain with empty tokens", async () => {
    mockChainManager.getPortfolio.mockResolvedValue({
      address: "0xABC",
      chains: [{ chainId: 1, chainName: "Ethereum", tokens: [] }],
    });
    const skill = createBalanceSkill(mockChainManager as any);
    const result = await skill.execute({}, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("No tokens found");
  });
});
