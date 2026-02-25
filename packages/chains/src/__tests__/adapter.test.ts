import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const mockGetBalance = vi.fn();
const mockReadContract = vi.fn();
const mockGetGasPrice = vi.fn();
const mockGetBlockNumber = vi.fn();

vi.mock("viem", async () => {
  const actual = await vi.importActual("viem");
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue({
      getBalance: (...args: any[]) => mockGetBalance(...args),
      readContract: (...args: any[]) => mockReadContract(...args),
      getGasPrice: (...args: any[]) => mockGetGasPrice(...args),
      getBlockNumber: (...args: any[]) => mockGetBlockNumber(...args),
    }),
  };
});

describe("createChainAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates adapter for supported chain IDs", { timeout: 15000 }, async () => {
    const { createChainAdapter } = await import("../adapter.js");
    for (const chainId of [1, 8453, 42161, 10, 137, 56, 43114, 324, 534352, 81457, 100, 59144, 250, 5000]) {
      const adapter = createChainAdapter(chainId);
      expect(adapter.chainId).toBe(chainId);
    }
  });

  it("throws for unsupported chain ID", async () => {
    const { createChainAdapter } = await import("../adapter.js");
    expect(() => createChainAdapter(999)).toThrow("Unsupported chain ID");
  });

  it("getBalance returns formatted ETH balance", async () => {
    mockGetBalance.mockResolvedValue(BigInt("2500000000000000000")); // 2.5 ETH
    const { createChainAdapter } = await import("../adapter.js");
    const adapter = createChainAdapter(1);
    const balance = await adapter.getBalance("0xABCdef1234567890abcdef1234567890ABCDEF12");
    expect(balance.symbol).toBe("ETH");
    expect(balance.formatted).toBe("2.5");
    expect(balance.chainId).toBe(1);
  });

  it("getTokenBalances returns non-zero token balances", async () => {
    // First call returns non-zero, second returns zero, etc.
    mockReadContract
      .mockResolvedValueOnce(BigInt("1000000000")) // 1000 USDC (6 decimals)
      .mockResolvedValueOnce(BigInt("0")) // 0 USDT
      .mockResolvedValueOnce(BigInt("500000000000000000")) // 0.5 WETH
      .mockResolvedValueOnce(BigInt("0")); // 0 DAI

    const { createChainAdapter } = await import("../adapter.js");
    const adapter = createChainAdapter(1);
    const tokens = await adapter.getTokenBalances("0xABCdef1234567890abcdef1234567890ABCDEF12");
    // Only non-zero balances returned
    expect(tokens.length).toBe(2);
    expect(tokens[0].symbol).toBe("USDC");
    expect(tokens[1].symbol).toBe("WETH");
  });

  it("getTokenBalances filters out zero-balance tokens", async () => {
    mockReadContract.mockResolvedValue(BigInt("0"));
    const { createChainAdapter } = await import("../adapter.js");
    const adapter = createChainAdapter(1);
    const tokens = await adapter.getTokenBalances("0xABCdef1234567890abcdef1234567890ABCDEF12");
    expect(tokens.length).toBe(0);
  });

  it("getTokenBalances handles readContract errors gracefully", async () => {
    mockReadContract.mockRejectedValue(new Error("RPC error"));
    const { createChainAdapter } = await import("../adapter.js");
    const adapter = createChainAdapter(1);
    const tokens = await adapter.getTokenBalances("0xABCdef1234567890abcdef1234567890ABCDEF12");
    expect(tokens.length).toBe(0);
  });

  it("getGasPrice returns bigint", async () => {
    mockGetGasPrice.mockResolvedValue(BigInt("30000000000"));
    const { createChainAdapter } = await import("../adapter.js");
    const adapter = createChainAdapter(1);
    const gasPrice = await adapter.getGasPrice();
    expect(gasPrice).toBe(BigInt("30000000000"));
  });

  it("getBlockNumber returns bigint", async () => {
    mockGetBlockNumber.mockResolvedValue(BigInt("19000000"));
    const { createChainAdapter } = await import("../adapter.js");
    const adapter = createChainAdapter(1);
    const blockNumber = await adapter.getBlockNumber();
    expect(blockNumber).toBe(BigInt("19000000"));
  });
});
