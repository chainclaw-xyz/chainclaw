import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRiskCheckSkill } from "../risk-check.js";
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

describe("createRiskCheckSkill", () => {
  const mockRiskEngine = {
    analyzeToken: vi.fn(),
    formatRiskReport: vi.fn().mockReturnValue("*Risk Report*\nDetails here"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'DO NOT interact' for critical/honeypot", async () => {
    mockRiskEngine.analyzeToken.mockResolvedValue({ riskLevel: "critical", isHoneypot: true });
    const skill = createRiskCheckSkill(mockRiskEngine as any);
    const result = await skill.execute(
      { contractAddress: "0x1234567890abcdef1234567890abcdef12345678", chainId: 1 },
      mockContext(),
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain("DO NOT interact");
  });

  it("returns 'Exercise extreme caution' for high risk", async () => {
    mockRiskEngine.analyzeToken.mockResolvedValue({ riskLevel: "high", isHoneypot: false });
    const skill = createRiskCheckSkill(mockRiskEngine as any);
    const result = await skill.execute(
      { contractAddress: "0x1234567890abcdef1234567890abcdef12345678", chainId: 1 },
      mockContext(),
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain("Exercise extreme caution");
  });

  it("returns 'Proceed with caution' for medium risk", async () => {
    mockRiskEngine.analyzeToken.mockResolvedValue({ riskLevel: "medium", isHoneypot: false });
    const skill = createRiskCheckSkill(mockRiskEngine as any);
    const result = await skill.execute(
      { contractAddress: "0x1234567890abcdef1234567890abcdef12345678", chainId: 1 },
      mockContext(),
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain("Proceed with caution");
  });

  it("returns 'No major risks detected' for low risk", async () => {
    mockRiskEngine.analyzeToken.mockResolvedValue({ riskLevel: "low", isHoneypot: false });
    const skill = createRiskCheckSkill(mockRiskEngine as any);
    const result = await skill.execute(
      { contractAddress: "0x1234567890abcdef1234567890abcdef12345678", chainId: 1 },
      mockContext(),
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain("No major risks detected");
  });

  it("returns error when analyzeToken returns null", async () => {
    mockRiskEngine.analyzeToken.mockResolvedValue(null);
    const skill = createRiskCheckSkill(mockRiskEngine as any);
    const result = await skill.execute(
      { contractAddress: "0x1234567890abcdef1234567890abcdef12345678", chainId: 1 },
      mockContext(),
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("Could not analyze");
  });
});
