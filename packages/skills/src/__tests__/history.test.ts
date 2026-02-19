import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHistorySkill } from "../history.js";
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

const sampleRecords = [
  {
    id: 1,
    skillName: "swap",
    status: "confirmed",
    chainId: 1,
    from: "0xABC",
    to: "0xDEF",
    value: "1000000",
    hash: "0xhash1",
    gasUsed: "21000",
    error: null,
    createdAt: "2024-01-15T10:30:00Z",
  },
  {
    id: 2,
    skillName: "bridge",
    status: "confirmed",
    chainId: 8453,
    from: "0xABC",
    to: "0xGHI",
    value: "2000000",
    hash: "0xhash2",
    gasUsed: "45000",
    error: null,
    createdAt: "2024-01-16T14:00:00Z",
  },
];

describe("createHistorySkill", () => {
  const mockTxLog = {
    getByUser: vi.fn(),
    formatHistory: vi.fn().mockReturnValue("*Transaction History*\nFormatted output"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("text format calls formatHistory", async () => {
    mockTxLog.getByUser.mockReturnValue(sampleRecords);
    const skill = createHistorySkill(mockTxLog as any);
    const result = await skill.execute({ format: "text" }, mockContext());
    expect(result.success).toBe(true);
    expect(mockTxLog.formatHistory).toHaveBeenCalledWith(sampleRecords);
  });

  it("csv format produces CSV with headers", async () => {
    mockTxLog.getByUser.mockReturnValue(sampleRecords);
    const skill = createHistorySkill(mockTxLog as any);
    const result = await skill.execute({ format: "csv" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("id,date,skill,status,chain,from,to,value,hash,gas_used,error");
    expect(result.message).toContain("swap");
    expect(result.message).toContain("bridge");
  });

  it("json format returns JSON code block", async () => {
    mockTxLog.getByUser.mockReturnValue(sampleRecords);
    const skill = createHistorySkill(mockTxLog as any);
    const result = await skill.execute({ format: "json" }, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("```json");
    expect(result.message).toContain('"skillName"');
  });

  it("empty history returns 'no transactions' message", async () => {
    mockTxLog.getByUser.mockReturnValue([]);
    const skill = createHistorySkill(mockTxLog as any);
    const result = await skill.execute({}, mockContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("No transactions found");
  });

  it("respects limit parameter", async () => {
    mockTxLog.getByUser.mockReturnValue(sampleRecords.slice(0, 1));
    const skill = createHistorySkill(mockTxLog as any);
    await skill.execute({ limit: 1 }, mockContext());
    expect(mockTxLog.getByUser).toHaveBeenCalledWith("user-1", 1);
  });
});
