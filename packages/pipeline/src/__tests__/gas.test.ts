import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseGwei } from "viem";
import { GasOptimizer } from "../gas.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Mock viem's createPublicClient
const mockGetBlock = vi.fn();
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      getBlock: mockGetBlock,
    }),
  };
});

describe("GasOptimizer", () => {
  let optimizer: GasOptimizer;

  beforeEach(() => {
    vi.clearAllMocks();
    optimizer = new GasOptimizer({ 1: "http://localhost:8545" });
  });

  it("returns slow fees with 1.1x baseFee + 1 gwei priority", async () => {
    const baseFee = parseGwei("20");
    mockGetBlock.mockResolvedValue({ baseFeePerGas: baseFee });

    const result = await optimizer.estimateFees(1, "slow");

    expect(result.strategy).toBe("slow");
    expect(result.maxPriorityFeePerGas).toBe(parseGwei("1"));
    // maxFee = (20 * 11 / 10) + 1 = 22 + 1 = 23 gwei
    expect(result.maxFeePerGas).toBe((baseFee * 11n) / 10n + parseGwei("1"));
  });

  it("returns standard fees with 1.25x baseFee + 1.5 gwei priority", async () => {
    const baseFee = parseGwei("20");
    mockGetBlock.mockResolvedValue({ baseFeePerGas: baseFee });

    const result = await optimizer.estimateFees(1, "standard");

    expect(result.strategy).toBe("standard");
    expect(result.maxPriorityFeePerGas).toBe(parseGwei("1.5"));
    // maxFee = (20 * 125 / 100) + 1.5 = 25 + 1.5 = 26.5 gwei
    expect(result.maxFeePerGas).toBe((baseFee * 125n) / 100n + parseGwei("1.5"));
  });

  it("returns fast fees with 2x baseFee + 3 gwei priority", async () => {
    const baseFee = parseGwei("20");
    mockGetBlock.mockResolvedValue({ baseFeePerGas: baseFee });

    const result = await optimizer.estimateFees(1, "fast");

    expect(result.strategy).toBe("fast");
    expect(result.maxPriorityFeePerGas).toBe(parseGwei("3"));
    // maxFee = (20 * 2 / 1) + 3 = 40 + 3 = 43 gwei
    expect(result.maxFeePerGas).toBe((baseFee * 2n) / 1n + parseGwei("3"));
  });

  it("defaults to standard strategy", async () => {
    mockGetBlock.mockResolvedValue({ baseFeePerGas: parseGwei("30") });

    const result = await optimizer.estimateFees(1);
    expect(result.strategy).toBe("standard");
  });

  it("handles pre-EIP-1559 chains (no baseFeePerGas)", async () => {
    mockGetBlock.mockResolvedValue({ baseFeePerGas: null });

    const result = await optimizer.estimateFees(1, "fast");
    expect(result.maxFeePerGas).toBe(parseGwei("50"));
    expect(result.maxPriorityFeePerGas).toBe(parseGwei("3"));
  });

  it("throws for unsupported chain", async () => {
    await expect(optimizer.estimateFees(999)).rejects.toThrow("Unsupported chain");
  });

  it("fast fees are always higher than standard, which are higher than slow", async () => {
    mockGetBlock.mockResolvedValue({ baseFeePerGas: parseGwei("15") });

    const slow = await optimizer.estimateFees(1, "slow");
    const standard = await optimizer.estimateFees(1, "standard");
    const fast = await optimizer.estimateFees(1, "fast");

    expect(fast.maxFeePerGas).toBeGreaterThan(standard.maxFeePerGas);
    expect(standard.maxFeePerGas).toBeGreaterThan(slow.maxFeePerGas);
    expect(fast.maxPriorityFeePerGas).toBeGreaterThan(standard.maxPriorityFeePerGas);
    expect(standard.maxPriorityFeePerGas).toBeGreaterThan(slow.maxPriorityFeePerGas);
  });
});
