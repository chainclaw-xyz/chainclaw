import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChainManager } from "../manager.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const mockAdapter = {
  chainId: 0,
  getBalance: vi.fn().mockResolvedValue({
    symbol: "ETH", name: "Ether", address: null, decimals: 18,
    balance: "1000000000000000000", formatted: "1.0", chainId: 1,
  }),
  getTokenBalances: vi.fn().mockResolvedValue([]),
  getGasPrice: vi.fn().mockResolvedValue(BigInt("30000000000")),
  getBlockNumber: vi.fn().mockResolvedValue(BigInt("19000000")),
};

vi.mock("../adapter.js", () => ({
  createChainAdapter: vi.fn((chainId: number) => ({ ...mockAdapter, chainId })),
}));

const mockSolanaAdapter = {
  chainId: 900,
  getBalance: vi.fn().mockResolvedValue({
    symbol: "SOL", name: "Solana", address: null, decimals: 9,
    balance: "5000000000", formatted: "5.0", chainId: 900,
  }),
  getTokenBalances: vi.fn().mockResolvedValue([]),
  getGasPrice: vi.fn().mockResolvedValue(BigInt("5000")),
  getBlockNumber: vi.fn().mockResolvedValue(BigInt("250000000")),
};

vi.mock("../solana-adapter.js", () => ({
  createSolanaAdapter: vi.fn(() => mockSolanaAdapter),
}));

function makeConfig(overrides: Record<string, any> = {}) {
  return {
    ethRpcUrl: "https://eth.example.com",
    baseRpcUrl: "https://base.example.com",
    arbitrumRpcUrl: "https://arb.example.com",
    optimismRpcUrl: "https://op.example.com",
    polygonRpcUrl: "https://polygon.example.com",
    bscRpcUrl: "https://bsc.example.com",
    avalancheRpcUrl: "https://avax.example.com",
    zkSyncRpcUrl: "https://zksync.example.com",
    scrollRpcUrl: "https://scroll.example.com",
    blastRpcUrl: "https://blast.example.com",
    gnosisRpcUrl: "https://gnosis.example.com",
    lineaRpcUrl: "https://linea.example.com",
    fantomRpcUrl: "https://fantom.example.com",
    mantleRpcUrl: "https://mantle.example.com",
    solanaRpcUrl: undefined as string | undefined,
    ...overrides,
  } as any;
}

describe("ChainManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes EVM adapters for 14 chains", () => {
    const manager = new ChainManager(makeConfig());
    const chains = manager.getSupportedChains();
    expect(chains).toContain(1);
    expect(chains).toContain(8453);
    expect(chains).toContain(42161);
    expect(chains).toContain(10);
    expect(chains).toContain(137);
    expect(chains).toContain(56);
    expect(chains).toContain(43114);
    expect(chains).toContain(324);
    expect(chains).toContain(534352);
    expect(chains).toContain(81457);
    expect(chains).toContain(100);
    expect(chains).toContain(59144);
    expect(chains).toContain(250);
    expect(chains).toContain(5000);
    expect(chains.length).toBe(14);
  });

  it("initializes Solana adapter when solanaRpcUrl is set", () => {
    const manager = new ChainManager(makeConfig({ solanaRpcUrl: "https://sol.example.com" }));
    const chains = manager.getSupportedChains();
    expect(chains).toContain(900);
    expect(chains.length).toBe(15);
  });

  it("skips Solana adapter when solanaRpcUrl is absent", () => {
    const manager = new ChainManager(makeConfig());
    const chains = manager.getSupportedChains();
    expect(chains).not.toContain(900);
  });

  it("getPortfolio queries only EVM chains for 0x address", async () => {
    const manager = new ChainManager(makeConfig({ solanaRpcUrl: "https://sol.example.com" }));
    const portfolio = await manager.getPortfolio("0xABCdef1234567890abcdef1234567890ABCDEF12");
    // Should query 14 EVM chains, not Solana
    expect(portfolio.chains.length).toBe(14);
    expect(portfolio.chains.every((c) => c.chainId !== 900)).toBe(true);
  });

  it("getPortfolio queries only Solana for non-0x address", async () => {
    const manager = new ChainManager(makeConfig({ solanaRpcUrl: "https://sol.example.com" }));
    const portfolio = await manager.getPortfolio("SolanaAddress123");
    // Should only query Solana
    expect(portfolio.chains.length).toBe(1);
    expect(portfolio.chains[0].chainId).toBe(900);
  });

  it("getPortfolio returns empty tokens on per-chain error", async () => {
    mockAdapter.getBalance.mockRejectedValue(new Error("RPC down"));
    const manager = new ChainManager(makeConfig());
    const portfolio = await manager.getPortfolio("0xABCdef1234567890abcdef1234567890ABCDEF12");
    // Should still return chains with empty tokens (not crash)
    expect(portfolio.chains.length).toBe(14);
    for (const chain of portfolio.chains) {
      expect(chain.tokens).toEqual([]);
    }
  });

  it("getSupportedChains returns all initialized chain IDs", () => {
    const manager = new ChainManager(makeConfig({ solanaRpcUrl: "https://sol.example.com" }));
    const chains = manager.getSupportedChains();
    expect(chains.sort((a: number, b: number) => a - b)).toEqual([1, 10, 56, 100, 137, 250, 324, 900, 5000, 8453, 42161, 43114, 59144, 81457, 534352].sort((a, b) => a - b));
  });
});
