import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const mockGetBalance = vi.fn();
const mockGetParsedTokenAccountsByOwner = vi.fn();
const mockGetRecentPrioritizationFees = vi.fn();
const mockGetSlot = vi.fn();

vi.mock("@solana/web3.js", () => {
  return {
    Connection: vi.fn().mockImplementation(() => ({
      getBalance: (...args: any[]) => mockGetBalance(...args),
      getParsedTokenAccountsByOwner: (...args: any[]) => mockGetParsedTokenAccountsByOwner(...args),
      getRecentPrioritizationFees: (...args: any[]) => mockGetRecentPrioritizationFees(...args),
      getSlot: (...args: any[]) => mockGetSlot(...args),
    })),
    PublicKey: vi.fn().mockImplementation((key: string) => ({ toBase58: () => key })),
    LAMPORTS_PER_SOL: 1000000000,
  };
});

describe("createSolanaAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("chainId is always 900", async () => {
    const { createSolanaAdapter } = await import("../solana-adapter.js");
    const adapter = createSolanaAdapter("https://test-rpc.solana.com");
    expect(adapter.chainId).toBe(900);
  });

  it("getBalance converts lamports to SOL", async () => {
    mockGetBalance.mockResolvedValue(5000000000); // 5 SOL
    const { createSolanaAdapter } = await import("../solana-adapter.js");
    const adapter = createSolanaAdapter();
    const balance = await adapter.getBalance("SolanaAddress123");
    expect(balance.symbol).toBe("SOL");
    expect(balance.formatted).toBe("5.000000000");
    expect(balance.chainId).toBe(900);
  });

  it("getTokenBalances returns SPL token accounts", async () => {
    mockGetParsedTokenAccountsByOwner.mockResolvedValue({
      value: [
        {
          account: {
            data: {
              parsed: {
                info: {
                  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                  tokenAmount: { uiAmount: 100, amount: "100000000", decimals: 6, uiAmountString: "100.000000" },
                },
              },
            },
          },
        },
      ],
    });

    const { createSolanaAdapter } = await import("../solana-adapter.js");
    const adapter = createSolanaAdapter();
    const tokens = await adapter.getTokenBalances("SolanaAddress123");
    expect(tokens.length).toBe(1);
    expect(tokens[0].formatted).toBe("100.000000");
  });

  it("getTokenBalances returns empty on error", async () => {
    mockGetParsedTokenAccountsByOwner.mockRejectedValue(new Error("RPC error"));
    const { createSolanaAdapter } = await import("../solana-adapter.js");
    const adapter = createSolanaAdapter();
    const tokens = await adapter.getTokenBalances("SolanaAddress123");
    expect(tokens).toEqual([]);
  });

  it("getGasPrice falls back to 5000n when no fees", async () => {
    mockGetRecentPrioritizationFees.mockResolvedValue([]);
    const { createSolanaAdapter } = await import("../solana-adapter.js");
    const adapter = createSolanaAdapter();
    const gas = await adapter.getGasPrice();
    expect(gas).toBe(BigInt(5000));
  });

  it("getBlockNumber returns slot as BigInt", async () => {
    mockGetSlot.mockResolvedValue(250000000);
    const { createSolanaAdapter } = await import("../solana-adapter.js");
    const adapter = createSolanaAdapter();
    const block = await adapter.getBlockNumber();
    expect(block).toBe(BigInt(250000000));
  });
});
