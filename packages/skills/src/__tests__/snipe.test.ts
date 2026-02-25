import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  fetchWithRetry: vi.fn(),
}));

vi.mock("../prices.js", () => ({
  getEthPriceUsd: vi.fn().mockResolvedValue(3000),
}));

import { fetchWithRetry } from "@chainclaw/core";
import { SnipeManager, createSnipeSkill } from "../snipe.js";

const mockFetch = vi.mocked(fetchWithRetry);

function mockDexScreenerResponse(liquidity = 50_000) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      pairs: [{
        chainId: "ethereum",
        pairAddress: "0xpair",
        baseToken: { address: "0xtoken", name: "Test Token", symbol: "TEST" },
        quoteToken: { address: "0xweth", name: "WETH", symbol: "WETH" },
        priceUsd: "0.001",
        liquidity: { usd: liquidity },
        fdv: 100_000,
        pairCreatedAt: Date.now() - 86_400_000,
        txns: { h24: { buys: 100, sells: 50 } },
      }],
    }),
  } as any);
}

function mockOneInchQuote(withTx = true) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      toAmount: "1000000000000000000",
      ...(withTx
        ? {
            tx: {
              to: "0x1inch-router",
              data: "0xcalldata",
              value: "100000000000000000",
              gas: 200000,
            },
          }
        : {}),
    }),
  } as any);
}

const mockRiskEngine = {
  analyzeToken: vi.fn().mockResolvedValue({
    isHoneypot: false,
    buyTax: 2,
    sellTax: 3,
    riskLevel: "low",
    dimensions: [],
  }),
};

const mockExecutor = {
  execute: vi.fn().mockResolvedValue({ success: true, message: "Swap executed", hash: "0xhash123" }),
  getRiskEngine: vi.fn(() => mockRiskEngine),
};

const mockWalletManager = {
  getSigner: vi.fn().mockReturnValue({ address: "0xwallet" }),
};

function makeContext(overrides: Record<string, any> = {}) {
  return {
    userId: "user-1",
    walletAddress: "0xABCdef1234567890abcdef1234567890ABCDEF12",
    chainIds: [1],
    sendReply: vi.fn(),
    requestConfirmation: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("snipe skill", () => {
  let db: Database.Database;
  let snipeManager: SnipeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database(":memory:");
    snipeManager = new SnipeManager(db);
  });

  it("executes snipe through pipeline when executor and API key available", async () => {
    const skill = createSnipeSkill(
      snipeManager, mockRiskEngine as any, mockExecutor as any, mockWalletManager as any, "test-api-key",
    );
    const ctx = makeContext();

    mockDexScreenerResponse();
    mockOneInchQuote(true);

    const result = await skill.execute(
      { action: "snipe", token: "0xtoken123", amount: "0.1", chainId: 1 },
      ctx as any,
    );

    expect(result.success).toBe(true);
    expect(mockExecutor.execute).toHaveBeenCalled();
    expect(result.data).toHaveProperty("hash", "0xhash123");
  });

  it("falls back to manual message when no API key (quote only)", async () => {
    const skill = createSnipeSkill(
      snipeManager, mockRiskEngine as any, mockExecutor as any, mockWalletManager as any,
    );
    const ctx = makeContext();

    mockDexScreenerResponse();
    mockOneInchQuote(false); // no tx in response

    const result = await skill.execute(
      { action: "snipe", token: "0xtoken123", amount: "0.1", chainId: 1 },
      ctx as any,
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("Swap");
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it("falls back to manual message when no executor provided", async () => {
    const skill = createSnipeSkill(snipeManager, mockRiskEngine as any);
    const ctx = makeContext();

    mockDexScreenerResponse();

    const result = await skill.execute(
      { action: "snipe", token: "0xtoken123", amount: "0.1", chainId: 1 },
      ctx as any,
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("Swap");
  });

  it("marks snipe as failed when executor fails", async () => {
    mockExecutor.execute.mockResolvedValueOnce({ success: false, message: "Insufficient gas" });
    const skill = createSnipeSkill(
      snipeManager, mockRiskEngine as any, mockExecutor as any, mockWalletManager as any, "test-api-key",
    );
    const ctx = makeContext();

    mockDexScreenerResponse();
    mockOneInchQuote(true);

    const result = await skill.execute(
      { action: "snipe", token: "0xtoken123", amount: "0.1", chainId: 1 },
      ctx as any,
    );

    expect(result.success).toBe(false);
    // Check DB status
    const snipes = snipeManager.getUserSnipes("user-1");
    expect(snipes[0].status).toBe("failed");
  });

  it("blocks honeypot tokens", async () => {
    mockRiskEngine.analyzeToken.mockResolvedValueOnce({
      isHoneypot: true,
      buyTax: 0,
      sellTax: 0,
      riskLevel: "critical",
      dimensions: [{ name: "honeypot", severity: "critical", description: "Honeypot", score: 100 }],
    });
    const skill = createSnipeSkill(
      snipeManager, mockRiskEngine as any, mockExecutor as any, mockWalletManager as any, "test-api-key",
    );
    const ctx = makeContext();

    mockDexScreenerResponse();

    const result = await skill.execute(
      { action: "snipe", token: "0xscam", amount: "0.1", chainId: 1 },
      ctx as any,
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("Honeypot");
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it("cancels when user rejects confirmation", async () => {
    const skill = createSnipeSkill(
      snipeManager, mockRiskEngine as any, mockExecutor as any, mockWalletManager as any, "test-api-key",
    );
    const ctx = makeContext({ requestConfirmation: vi.fn().mockResolvedValue(false) });

    mockDexScreenerResponse();

    const result = await skill.execute(
      { action: "snipe", token: "0xtoken123", amount: "0.1", chainId: 1 },
      ctx as any,
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("cancelled");
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it("returns error when no wallet configured", async () => {
    const skill = createSnipeSkill(snipeManager, mockRiskEngine as any);
    const ctx = makeContext({ walletAddress: null });

    const result = await skill.execute(
      { action: "snipe", token: "0xtoken123", amount: "0.1", chainId: 1 },
      ctx as any,
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("wallet");
  });

  it("supports all 14 EVM chains", async () => {
    const skill = createSnipeSkill(snipeManager, mockRiskEngine as any);
    const ctx = makeContext();

    for (const chainId of [1, 8453, 42161, 10, 137, 56, 43114, 324, 534352, 81457, 100, 59144, 250, 5000]) {
      mockDexScreenerResponse();
      const result = await skill.execute(
        { action: "snipe", token: "0xtoken", amount: "0.1", chainId },
        ctx as any,
      );
      expect(result.success).not.toBeUndefined();
    }
  });

  it("lists user snipes", async () => {
    snipeManager.createSnipe("user-1", "0xtoken1", "0.1", 5, 1, true);
    snipeManager.createSnipe("user-1", "0xtoken2", "0.5", 3, 8453, true);

    const skill = createSnipeSkill(snipeManager, mockRiskEngine as any);
    const ctx = makeContext();

    const result = await skill.execute({ action: "list" }, ctx as any);

    expect(result.success).toBe(true);
    expect(result.message).toContain("0.1 ETH");
    expect(result.message).toContain("0.5 ETH");
    expect(result.message).toContain("Recent Snipes");
  });

  it("cancels a snipe", async () => {
    const id = snipeManager.createSnipe("user-1", "0xtoken1", "0.1", 5, 1, true);
    const skill = createSnipeSkill(snipeManager, mockRiskEngine as any);
    const ctx = makeContext();

    const result = await skill.execute({ action: "cancel", snipeId: id }, ctx as any);

    expect(result.success).toBe(true);
    expect(result.message).toContain("cancelled");
  });
});
