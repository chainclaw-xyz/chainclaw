import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLendSkill } from "../lend.js";
import type { SkillExecutionContext } from "../types.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../prices.js", () => ({
  getEthPriceUsd: vi.fn(async () => 3000),
}));

// Mock viem functions
const mockReadContract = vi.fn();
vi.mock("viem", async () => {
  const actual = await vi.importActual("viem");
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue({
      readContract: (...args: any[]) => mockReadContract(...args),
    }),
    // Override encodeFunctionData to avoid address checksum validation in tests
    encodeFunctionData: vi.fn().mockReturnValue("0xmocked_calldata"),
  };
});

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

describe("createLendSkill", () => {
  const mockExecutor = {
    execute: vi.fn().mockResolvedValue({ success: true, message: "Tx confirmed" }),
  };
  const mockWalletManager = {
    getSigner: vi.fn().mockReturnValue({ address: "0xABC" }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("position action returns health factor and collateral info", async () => {
    // Mock getUserAccountData return: [collateral, debt, available, liqThreshold, ltv, healthFactor]
    mockReadContract.mockResolvedValue([
      BigInt(5000_0000_0000), // $50k in 8 decimals
      BigInt(2000_0000_0000), // $20k debt
      BigInt(1500_0000_0000), // $15k available
      BigInt(8250),           // 82.5% liq threshold
      BigInt(7500),           // 75% ltv
      BigInt("1800000000000000000"), // 1.8 health factor
    ]);

    const skill = createLendSkill(mockExecutor as any, mockWalletManager as any);
    const result = await skill.execute(
      { action: "position", chainId: 1 },
      mockContext(),
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain("Collateral");
    expect(result.message).toContain("Debt");
    expect(result.message).toContain("Health factor");
    expect(result.message).toContain("1.80");
  });

  it("supply action sends approval + supply tx", async () => {
    // Mock allowance check - needs approval
    mockReadContract.mockResolvedValue(BigInt(0));
    // First call: approval tx, second call: supply tx
    mockExecutor.execute
      .mockResolvedValueOnce({ success: true, message: "Approved" })
      .mockResolvedValueOnce({ success: true, message: "Supplied" });

    const skill = createLendSkill(mockExecutor as any, mockWalletManager as any);
    const result = await skill.execute(
      { action: "supply", token: "USDC", amount: "1000", chainId: 1 },
      mockContext(),
    );
    expect(result.success).toBe(true);
    // Two executor calls: approve + supply
    expect(mockExecutor.execute).toHaveBeenCalledTimes(2);
  });

  it("borrow action defaults to variable rate", async () => {
    const skill = createLendSkill(mockExecutor as any, mockWalletManager as any);
    const ctx = mockContext();
    await skill.execute(
      { action: "borrow", token: "USDC", amount: "500", chainId: 1 },
      ctx,
    );
    // Should mention variable rate
    expect(ctx.sendReply).toHaveBeenCalledWith(expect.stringContaining("variable"));
  });

  it("requestConfirmation cancellation stops action", async () => {
    mockReadContract.mockResolvedValue(BigInt("1000000000000000000000")); // already approved
    const skill = createLendSkill(mockExecutor as any, mockWalletManager as any);
    const result = await skill.execute(
      { action: "supply", token: "USDC", amount: "1000", chainId: 1 },
      mockContext({ requestConfirmation: vi.fn().mockResolvedValue(false) }),
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("cancelled");
  });

  it("no wallet returns error", async () => {
    const skill = createLendSkill(mockExecutor as any, mockWalletManager as any);
    const result = await skill.execute(
      { action: "supply", token: "USDC", amount: "1000", chainId: 1 },
      mockContext({ walletAddress: undefined }),
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("No wallet configured");
  });

  it("low health factor appends warning message", async () => {
    mockReadContract.mockResolvedValue([
      BigInt(5000_0000_0000),
      BigInt(4000_0000_0000),
      BigInt(100_0000_0000),
      BigInt(8250),
      BigInt(7500),
      BigInt("1200000000000000000"), // 1.2 health factor — low
    ]);

    const skill = createLendSkill(mockExecutor as any, mockWalletManager as any);
    const result = await skill.execute(
      { action: "position", chainId: 1 },
      mockContext(),
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain("Health factor is low");
  });
});
