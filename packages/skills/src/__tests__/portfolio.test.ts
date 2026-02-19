import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPortfolioSkill } from "../portfolio.js";
import type { SkillExecutionContext } from "../types.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const mockGetTokenPrice = vi.fn();
vi.mock("../prices.js", () => ({
  getTokenPrice: (...args: any[]) => mockGetTokenPrice(...args),
}));

function mockContext(overrides?: Partial<SkillExecutionContext>): SkillExecutionContext {
  return {
    userId: "user-1",
    walletAddress: "0xABCdef1234567890abcdef1234567890ABCDEF12",
    chainIds: [1, 8453],
    sendReply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("createPortfolioSkill", () => {
  const mockChainManager = {
    getPortfolio: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns balances with USD values", async () => {
    mockChainManager.getPortfolio.mockResolvedValue({
      address: "0xABCdef1234567890abcdef1234567890ABCDEF12",
      chains: [
        { chainId: 1, chainName: "Ethereum", tokens: [{ symbol: "ETH", formatted: "2.0", address: null }] },
      ],
    });
    mockGetTokenPrice.mockResolvedValue(3000);

    const skill = createPortfolioSkill(mockChainManager as any);
    const result = await skill.execute({}, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("ETH");
    expect(result.message).toContain("$6,000");
  });

  it("shows total USD at bottom", async () => {
    mockChainManager.getPortfolio.mockResolvedValue({
      address: "0xABCdef1234567890abcdef1234567890ABCDEF12",
      chains: [
        { chainId: 1, chainName: "Ethereum", tokens: [{ symbol: "ETH", formatted: "1.0", address: null }] },
      ],
    });
    mockGetTokenPrice.mockResolvedValue(3000);

    const skill = createPortfolioSkill(mockChainManager as any);
    const result = await skill.execute({}, mockContext());
    expect(result.message).toContain("Total:");
    expect(result.message).toContain("$3,000");
  });

  it("handles price fetch failure gracefully", async () => {
    mockChainManager.getPortfolio.mockResolvedValue({
      address: "0xABCdef1234567890abcdef1234567890ABCDEF12",
      chains: [
        { chainId: 1, chainName: "Ethereum", tokens: [{ symbol: "ETH", formatted: "1.0", address: null }] },
      ],
    });
    mockGetTokenPrice.mockResolvedValue(null);

    const skill = createPortfolioSkill(mockChainManager as any);
    const result = await skill.execute({}, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("ETH");
  });

  it("returns error when walletAddress is null", async () => {
    const skill = createPortfolioSkill(mockChainManager as any);
    const result = await skill.execute({}, mockContext({ walletAddress: undefined }));
    expect(result.success).toBe(false);
    expect(result.message).toContain("No wallet configured");
  });

  it("filters by chainId", async () => {
    mockChainManager.getPortfolio.mockResolvedValue({
      address: "0xABCdef1234567890abcdef1234567890ABCDEF12",
      chains: [
        { chainId: 1, chainName: "Ethereum", tokens: [{ symbol: "ETH", formatted: "1.0", address: null }] },
        { chainId: 8453, chainName: "Base", tokens: [{ symbol: "USDC", formatted: "500", address: "0x833" }] },
      ],
    });
    mockGetTokenPrice.mockResolvedValue(1);

    const skill = createPortfolioSkill(mockChainManager as any);
    const result = await skill.execute({ chainId: 8453 }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("Base");
    expect(result.message).not.toContain("Ethereum");
  });
});
