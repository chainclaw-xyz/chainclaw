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

const mockSimulator = {
  simulateSellAfterBuy: vi.fn().mockResolvedValue({
    canSell: true, sellTax: 2, netLossPercent: 3, buyReceived: "1000", sellReceived: "0.097",
  }),
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

  // ─── Anti-rug integration tests ────────────────────────────

  it("blocks snipe when anti-rug reports canSell false", async () => {
    mockSimulator.simulateSellAfterBuy.mockResolvedValueOnce({
      canSell: false, sellTax: 100, netLossPercent: 100, buyReceived: "0", sellReceived: "0",
      warning: "Cannot sell token: execution reverted",
    });
    const skill = createSnipeSkill(
      snipeManager, mockRiskEngine as any, mockExecutor as any, mockWalletManager as any, "test-api-key", mockSimulator as any,
    );
    const ctx = makeContext();
    mockDexScreenerResponse();

    const result = await skill.execute(
      { action: "snipe", token: "0xscam", amount: "0.1", chainId: 1 },
      ctx as any,
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("Anti-Rug Check Failed");
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it("warns but allows snipe when netLossPercent > 20", async () => {
    mockSimulator.simulateSellAfterBuy.mockResolvedValueOnce({
      canSell: true, sellTax: 25, netLossPercent: 25, buyReceived: "1000", sellReceived: "0.075",
      warning: "High round-trip loss: 25.0%",
    });
    const skill = createSnipeSkill(
      snipeManager, mockRiskEngine as any, mockExecutor as any, mockWalletManager as any, "test-api-key", mockSimulator as any,
    );
    const ctx = makeContext();
    mockDexScreenerResponse();
    mockOneInchQuote(true);

    const result = await skill.execute(
      { action: "snipe", token: "0xtoken123", amount: "0.1", chainId: 1 },
      ctx as any,
    );

    expect(result.success).toBe(true);
    expect(ctx.requestConfirmation).toHaveBeenCalled();
    // Warning should be in the confirmation prompt
    const confirmText = ctx.requestConfirmation.mock.calls[0][0] as string;
    expect(confirmText).toContain("Anti-Rug Warning");
  });

  it("skips anti-rug check when simulateSell is false", async () => {
    const skill = createSnipeSkill(
      snipeManager, mockRiskEngine as any, mockExecutor as any, mockWalletManager as any, "test-api-key", mockSimulator as any,
    );
    const ctx = makeContext();
    mockDexScreenerResponse();
    mockOneInchQuote(true);

    await skill.execute(
      { action: "snipe", token: "0xtoken123", amount: "0.1", chainId: 1, simulateSell: false },
      ctx as any,
    );

    expect(mockSimulator.simulateSellAfterBuy).not.toHaveBeenCalled();
  });

  it("proceeds normally when anti-rug passes clean", async () => {
    const skill = createSnipeSkill(
      snipeManager, mockRiskEngine as any, mockExecutor as any, mockWalletManager as any, "test-api-key", mockSimulator as any,
    );
    const ctx = makeContext();
    mockDexScreenerResponse();
    mockOneInchQuote(true);

    const result = await skill.execute(
      { action: "snipe", token: "0xtoken123", amount: "0.1", chainId: 1 },
      ctx as any,
    );

    expect(result.success).toBe(true);
    expect(mockSimulator.simulateSellAfterBuy).toHaveBeenCalled();
    expect(mockExecutor.execute).toHaveBeenCalled();
  });

  // ─── Auto-snipe tests ──────────────────────────────────────

  it("auto action creates config in DB", async () => {
    const skill = createSnipeSkill(snipeManager, mockRiskEngine as any);
    const ctx = makeContext();

    const result = await skill.execute(
      { action: "auto", token: "0xtoken123", amount: "0.5", chainId: 1, maxExecutions: 3 },
      ctx as any,
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("Auto-Snipe");
    expect(result.message).toContain("0.5 ETH");
    expect(result.data).toHaveProperty("autoSnipeId");

    const configs = snipeManager.getUserAutoSnipes("user-1");
    expect(configs).toHaveLength(1);
    expect(configs[0].token_address).toBe("0xtoken123");
    expect(configs[0].max_executions).toBe(3);
  });

  it("auto-list returns active configs", async () => {
    snipeManager.createAutoSnipe("user-1", "0xtoken1", "0.1", 5, 1, 1);
    snipeManager.createAutoSnipe("user-1", "0xtoken2", "0.5", 3, 8453, 5);

    const skill = createSnipeSkill(snipeManager, mockRiskEngine as any);
    const ctx = makeContext();

    const result = await skill.execute({ action: "auto-list" }, ctx as any);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Auto-Snipes");
    expect(result.message).toContain("0.1 ETH");
    expect(result.message).toContain("0.5 ETH");
  });

  it("auto-remove deletes config", async () => {
    const id = snipeManager.createAutoSnipe("user-1", "0xtoken1", "0.1", 5, 1, 1);
    const skill = createSnipeSkill(snipeManager, mockRiskEngine as any);
    const ctx = makeContext();

    const result = await skill.execute({ action: "auto-remove", autoSnipeId: id }, ctx as any);

    expect(result.success).toBe(true);
    expect(result.message).toContain("removed");
    expect(snipeManager.getUserAutoSnipes("user-1")).toHaveLength(0);
  });

  it("matching auto-snipe config skips confirmation", async () => {
    snipeManager.createAutoSnipe("user-1", "0xtoken123", "0.1", 5, 1, 3);
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
    expect(ctx.requestConfirmation).not.toHaveBeenCalled();
    expect(mockExecutor.execute).toHaveBeenCalled();
  });

  it("autoExecute param also skips confirmation", async () => {
    const skill = createSnipeSkill(
      snipeManager, mockRiskEngine as any, mockExecutor as any, mockWalletManager as any, "test-api-key",
    );
    const ctx = makeContext();
    mockDexScreenerResponse();
    mockOneInchQuote(true);

    const result = await skill.execute(
      { action: "snipe", token: "0xtoken123", amount: "0.1", chainId: 1, autoExecute: true },
      ctx as any,
    );

    expect(result.success).toBe(true);
    expect(ctx.requestConfirmation).not.toHaveBeenCalled();
  });

  it("auto-snipe still blocks honeypots", async () => {
    snipeManager.createAutoSnipe("user-1", "0xscam", "0.1", 5, 1, 3);
    mockRiskEngine.analyzeToken.mockResolvedValueOnce({
      isHoneypot: true, buyTax: 0, sellTax: 0, riskLevel: "critical", dimensions: [],
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

  it("forces safety checks ON in auto mode even when safetyChecks=false", async () => {
    snipeManager.createAutoSnipe("user-1", "0xtoken123", "0.1", 5, 1, 3);
    const skill = createSnipeSkill(
      snipeManager, mockRiskEngine as any, mockExecutor as any, mockWalletManager as any, "test-api-key",
    );
    const ctx = makeContext();
    mockDexScreenerResponse();
    mockOneInchQuote(true);

    await skill.execute(
      { action: "snipe", token: "0xtoken123", amount: "0.1", chainId: 1, safetyChecks: false },
      ctx as any,
    );

    // Even though safetyChecks=false, auto mode forces them on
    expect(mockRiskEngine.analyzeToken).toHaveBeenCalled();
  });

  it("maxExecutions enforced — marks as exhausted", () => {
    const id = snipeManager.createAutoSnipe("user-1", "0xtoken1", "0.1", 5, 1, 2);
    snipeManager.incrementAutoSnipeCount(id);
    snipeManager.incrementAutoSnipeCount(id);

    const config = snipeManager.getAutoSnipeConfig("user-1", "0xtoken1", 1);
    // Should be null since status is now 'exhausted' (query filters for 'active')
    expect(config).toBeNull();

    // Verify via getUserAutoSnipes which includes paused but not exhausted
    const all = db.prepare("SELECT * FROM auto_snipes WHERE id = ?").get(id) as any;
    expect(all.status).toBe("exhausted");
    expect(all.executed_count).toBe(2);
  });
});
