import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { TradingSignalsEngine, createTradingSignalsSkill } from "../trading-signals.js";
import type { SkillExecutionContext } from "../types.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  fetchWithRetry: vi.fn(),
}));

const { fetchWithRetry } = await import("@chainclaw/core");
const mockFetchWithRetry = fetchWithRetry as unknown as ReturnType<typeof vi.fn>;

function mockContext(overrides?: Partial<SkillExecutionContext>): SkillExecutionContext {
  return {
    userId: "user-1",
    walletAddress: "0xABCdef1234567890abcdef1234567890ABCDEF12",
    chainIds: [1, 8453],
    sendReply: vi.fn().mockResolvedValue(undefined),
    requestConfirmation: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const RPC_OVERRIDES: Record<number, string> = {
  1: "https://eth-rpc.example.com",
  8453: "https://base-rpc.example.com",
};

describe("TradingSignalsEngine", () => {
  let db: Database.Database;
  let engine: TradingSignalsEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    engine = new TradingSignalsEngine(db, RPC_OVERRIDES);
    mockFetchWithRetry.mockReset();
  });

  afterEach(() => {
    engine.stop();
    db.close();
  });

  // ─── Table Initialization ────────────────────────────────────

  it("creates all 3 tables on construction", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("signal_providers");
    expect(names).toContain("signals");
    expect(names).toContain("signal_subscriptions");
  });

  // ─── Provider Management ─────────────────────────────────────

  it("upsertProvider creates a provider", () => {
    engine.upsertProvider("user-1", "Alice");
    const provider = engine.getProvider("user-1");
    expect(provider).not.toBeNull();
    expect(provider!.display_name).toBe("Alice");
    expect(provider!.total_signals).toBe(0);
  });

  it("upsertProvider updates display name on conflict", () => {
    engine.upsertProvider("user-1", "Alice");
    engine.upsertProvider("user-1", "Alice V2");
    const provider = engine.getProvider("user-1");
    expect(provider!.display_name).toBe("Alice V2");
  });

  it("searchProviders returns matching results", () => {
    engine.upsertProvider("user-1", "AlphaTrader");
    engine.upsertProvider("user-2", "BetaBot");
    engine.upsertProvider("user-3", "AlphaHunter");

    const results = engine.searchProviders("Alpha");
    expect(results).toHaveLength(2);
  });

  // ─── Signal Publishing ───────────────────────────────────────

  it("publishSignal inserts signal and returns ID", () => {
    engine.upsertProvider("user-1", "Alice");
    const signalId = engine.publishSignal(
      "user-1", "buy", "ETH", 1, 3000, "0x" + "a".repeat(64), 1000, 1, 0.8, "Bullish", true,
    );
    expect(signalId).toBeGreaterThan(0);

    const signal = engine.getSignal(signalId);
    expect(signal).not.toBeNull();
    expect(signal!.token).toBe("ETH");
    expect(signal!.entry_price).toBe(3000);
    expect(signal!.verified_onchain).toBe(1);
    expect(signal!.status).toBe("open");
  });

  it("publishSignal normalizes token to uppercase", () => {
    engine.upsertProvider("user-1", "Alice");
    const signalId = engine.publishSignal(
      "user-1", "buy", "eth", 1, 3000, "0x" + "a".repeat(64), 1000, 1, null, null, false,
    );
    const signal = engine.getSignal(signalId);
    expect(signal!.token).toBe("ETH");
  });

  // ─── Signal Closing ──────────────────────────────────────────

  it("closeSignal calculates positive PnL for buy", () => {
    engine.upsertProvider("user-1", "Alice");
    const signalId = engine.publishSignal(
      "user-1", "buy", "ETH", 1, 3000, "0x" + "a".repeat(64), 1000, 2, null, null, true,
    );

    const { success, pnlPct } = engine.closeSignal(signalId, "user-1", 3300, null);
    expect(success).toBe(true);
    // (3300-3000)/3000 * 100 * 2 = 20%
    expect(pnlPct).toBeCloseTo(20, 1);

    const signal = engine.getSignal(signalId);
    expect(signal!.status).toBe("closed");
    expect(signal!.exit_price).toBe(3300);
  });

  it("closeSignal calculates negative PnL for buy", () => {
    engine.upsertProvider("user-1", "Alice");
    const signalId = engine.publishSignal(
      "user-1", "buy", "ETH", 1, 3000, "0x" + "a".repeat(64), 1000, 1, null, null, true,
    );

    const { success, pnlPct } = engine.closeSignal(signalId, "user-1", 2700, null);
    expect(success).toBe(true);
    // (2700-3000)/3000 * 100 = -10%
    expect(pnlPct).toBeCloseTo(-10, 1);
  });

  it("closeSignal calculates PnL for sell (short)", () => {
    engine.upsertProvider("user-1", "Alice");
    const signalId = engine.publishSignal(
      "user-1", "sell", "ETH", 1, 3000, "0x" + "a".repeat(64), 1000, 1, null, null, true,
    );

    const { success, pnlPct } = engine.closeSignal(signalId, "user-1", 2700, null);
    expect(success).toBe(true);
    // (3000-2700)/3000 * 100 = 10% (sell profits from price drop)
    expect(pnlPct).toBeCloseTo(10, 1);
  });

  it("closeSignal returns false for wrong provider", () => {
    engine.upsertProvider("user-1", "Alice");
    const signalId = engine.publishSignal(
      "user-1", "buy", "ETH", 1, 3000, "0x" + "a".repeat(64), 1000, 1, null, null, true,
    );

    const { success } = engine.closeSignal(signalId, "user-2", 3300, null);
    expect(success).toBe(false);
  });

  it("closeSignal updates provider stats", () => {
    engine.upsertProvider("user-1", "Alice");

    // Publish and close 3 signals: 2 wins, 1 loss
    const s1 = engine.publishSignal("user-1", "buy", "ETH", 1, 3000, "0x" + "a".repeat(64), 1000, 1, null, null, true);
    engine.closeSignal(s1, "user-1", 3300, null); // +10%

    const s2 = engine.publishSignal("user-1", "buy", "BTC", 1, 60000, "0x" + "b".repeat(64), 1000, 1, null, null, true);
    engine.closeSignal(s2, "user-1", 66000, null); // +10%

    const s3 = engine.publishSignal("user-1", "buy", "SOL", 1, 100, "0x" + "c".repeat(64), 1000, 1, null, null, true);
    engine.closeSignal(s3, "user-1", 80, null); // -20%

    const provider = engine.getProvider("user-1");
    expect(provider!.total_signals).toBe(3);
    expect(provider!.wins).toBe(2);
    expect(provider!.losses).toBe(1);
  });

  // ─── Signal Feed ─────────────────────────────────────────────

  it("getSignalFeed returns recent signals", () => {
    engine.upsertProvider("user-1", "Alice");
    engine.publishSignal("user-1", "buy", "ETH", 1, 3000, "0x" + "a".repeat(64), 1000, 1, null, null, true);
    engine.publishSignal("user-1", "sell", "BTC", 1, 60000, "0x" + "b".repeat(64), 2000, 1, null, null, true);

    const feed = engine.getSignalFeed(20, 0);
    expect(feed).toHaveLength(2);
  });

  it("getSignalFeed filters by token", () => {
    engine.upsertProvider("user-1", "Alice");
    engine.publishSignal("user-1", "buy", "ETH", 1, 3000, "0x" + "a".repeat(64), 1000, 1, null, null, true);
    engine.publishSignal("user-1", "sell", "BTC", 1, 60000, "0x" + "b".repeat(64), 2000, 1, null, null, true);

    const feed = engine.getSignalFeed(20, 0, "ETH");
    expect(feed).toHaveLength(1);
    expect(feed[0].token).toBe("ETH");
  });

  it("getSignalFeed filters by provider", () => {
    engine.upsertProvider("user-1", "Alice");
    engine.upsertProvider("user-2", "Bob");
    engine.publishSignal("user-1", "buy", "ETH", 1, 3000, "0x" + "a".repeat(64), 1000, 1, null, null, true);
    engine.publishSignal("user-2", "buy", "ETH", 1, 3100, "0x" + "b".repeat(64), 500, 1, null, null, true);

    const feed = engine.getSignalFeed(20, 0, undefined, "user-1");
    expect(feed).toHaveLength(1);
    expect(feed[0].provider_id).toBe("user-1");
  });

  // ─── Subscriptions ──────────────────────────────────────────

  it("subscribe creates subscription", () => {
    engine.upsertProvider("user-2", "Bob");
    engine.subscribe("user-1", "user-2", false, null, 5);
    const subs = engine.getUserSubscriptions("user-1");
    expect(subs).toHaveLength(1);
    expect(subs[0].provider_id).toBe("user-2");
  });

  it("subscribe throws for non-existent provider", () => {
    expect(() => engine.subscribe("user-1", "nobody", false, null, 5)).toThrow("Provider not found");
  });

  it("subscribe throws for self-subscription", () => {
    engine.upsertProvider("user-1", "Alice");
    expect(() => engine.subscribe("user-1", "user-1", false, null, 5)).toThrow("Cannot subscribe to yourself");
  });

  it("unsubscribe cancels subscription", () => {
    engine.upsertProvider("user-2", "Bob");
    engine.subscribe("user-1", "user-2", false, null, 5);
    const ok = engine.unsubscribe("user-1", "user-2");
    expect(ok).toBe(true);
    const subs = engine.getUserSubscriptions("user-1");
    expect(subs).toHaveLength(0);
  });

  it("unsubscribe returns false for non-existent subscription", () => {
    const ok = engine.unsubscribe("user-1", "user-2");
    expect(ok).toBe(false);
  });

  it("re-subscribe reactivates cancelled subscription", () => {
    engine.upsertProvider("user-2", "Bob");
    engine.subscribe("user-1", "user-2", false, null, 5);
    engine.unsubscribe("user-1", "user-2");
    engine.subscribe("user-1", "user-2", true, 100, 10);
    const subs = engine.getUserSubscriptions("user-1");
    expect(subs).toHaveLength(1);
    expect(subs[0].auto_copy).toBe(1);
  });

  // ─── Leaderboard ─────────────────────────────────────────────

  it("leaderboard requires minimum 5 signals", () => {
    engine.upsertProvider("user-1", "Alice");
    // Only 3 closed signals — not enough
    for (let i = 0; i < 3; i++) {
      const s = engine.publishSignal("user-1", "buy", "ETH", 1, 3000, `0x${String(i).padStart(64, "0")}`, 1000, 1, null, null, true);
      engine.closeSignal(s, "user-1", 3300, null);
    }

    const leaderboard = engine.getLeaderboard();
    expect(leaderboard).toHaveLength(0);
  });

  it("leaderboard includes providers with 5+ signals", () => {
    engine.upsertProvider("user-1", "Alice");
    for (let i = 0; i < 5; i++) {
      const s = engine.publishSignal("user-1", "buy", "ETH", 1, 3000, `0x${String(i).padStart(64, "0")}`, 1000, 1, null, null, true);
      engine.closeSignal(s, "user-1", 3300, null);
    }

    const leaderboard = engine.getLeaderboard();
    expect(leaderboard).toHaveLength(1);
    expect(leaderboard[0].display_name).toBe("Alice");
  });

  // ─── TX Verification ────────────────────────────────────────

  it("verifyTxOnChain returns verified when wallet matches tx from", async () => {
    const walletAddress = "0xABCdef1234567890abcdef1234567890ABCDEF12";
    const txHash = "0x" + "a".repeat(64);

    // Mock RPC response
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          status: "0x1",
          from: walletAddress,
          to: "0x0000000000000000000000000000000000000001",
          logs: [],
        },
      }),
    });

    // Mock Blockscout (no token transfers)
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [] }),
    });

    const result = await engine.verifyTxOnChain(txHash, 1, walletAddress);
    expect(result.verified).toBe(true);
  });

  it("verifyTxOnChain returns false for failed tx", async () => {
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          status: "0x0",
          from: "0xABCdef1234567890abcdef1234567890ABCDEF12",
          to: "0x0000000000000000000000000000000000000001",
          logs: [],
        },
      }),
    });

    const result = await engine.verifyTxOnChain("0x" + "a".repeat(64), 1, "0xABCdef1234567890abcdef1234567890ABCDEF12");
    expect(result.verified).toBe(false);
  });

  it("verifyTxOnChain returns false for unrelated wallet", async () => {
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          status: "0x1",
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          logs: [],
        },
      }),
    });

    const result = await engine.verifyTxOnChain(
      "0x" + "a".repeat(64),
      1,
      "0xABCdef1234567890abcdef1234567890ABCDEF12",
    );
    expect(result.verified).toBe(false);
  });

  it("verifyTxOnChain returns false for unknown chain", async () => {
    const result = await engine.verifyTxOnChain("0x" + "a".repeat(64), 99999, "0xABC");
    expect(result.verified).toBe(false);
  });

  it("verifyTxOnChain extracts price from blockscout token transfers", async () => {
    const walletAddress = "0xABCdef1234567890abcdef1234567890ABCDEF12";

    // Mock RPC
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          status: "0x1",
          from: walletAddress,
          to: "0x1111111111111111111111111111111111111111",
          logs: [],
        },
      }),
    });

    // Mock Blockscout token transfers
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            from: { hash: walletAddress },
            to: { hash: "0x1111111111111111111111111111111111111111" },
            token: { address: "0xUSDC", symbol: "USDC", decimals: "6", type: "ERC-20" },
            total: { value: "1000000000", decimals: "6" }, // 1000 USDC
          },
          {
            from: { hash: "0x1111111111111111111111111111111111111111" },
            to: { hash: walletAddress },
            token: { address: "0xTOKEN", symbol: "PEPE", decimals: "18", type: "ERC-20" },
            total: { value: "500000000000000000000", decimals: "18" }, // 500 tokens
          },
        ],
      }),
    });

    const result = await engine.verifyTxOnChain("0x" + "a".repeat(64), 1, walletAddress);
    expect(result.verified).toBe(true);
    // 1000 USDC / 500 tokens = $2/token
    expect(result.extractedPrice).toBeCloseTo(2, 1);
  });

  // ─── Background Polling ──────────────────────────────────────

  it("pollNewSignals notifies subscribers of new signals", async () => {
    const notifier = vi.fn(async () => {});
    engine.setNotifier(notifier);

    engine.upsertProvider("user-1", "Alice");
    engine.upsertProvider("user-2", "Bob");
    engine.subscribe("user-2", "user-1", false, null, 5);

    // Publish after engine is constructed (lastNotifiedSignalId was set at construction)
    engine.publishSignal("user-1", "buy", "ETH", 1, 3000, "0x" + "a".repeat(64), 1000, 1, 0.8, "Bullish", true);

    await (engine as any).pollNewSignals();

    expect(notifier).toHaveBeenCalledWith("user-2", expect.stringContaining("New Signal"));
    expect(notifier).toHaveBeenCalledWith("user-2", expect.stringContaining("BUY ETH"));
  });

  it("publishSignal rejects duplicate txHash from same provider", () => {
    engine.upsertProvider("user-1", "Alice");
    const txHash = "0x" + "a".repeat(64);
    engine.publishSignal("user-1", "buy", "ETH", 1, 3000, txHash, 1000, 1, null, null, true);
    expect(() =>
      engine.publishSignal("user-1", "buy", "ETH", 1, 3100, txHash, 1000, 1, null, null, true),
    ).toThrow(); // UNIQUE constraint violation
  });

  it("publishSignal allows same txHash from different providers", () => {
    engine.upsertProvider("user-1", "Alice");
    engine.upsertProvider("user-2", "Bob");
    const txHash = "0x" + "a".repeat(64);
    const s1 = engine.publishSignal("user-1", "buy", "ETH", 1, 3000, txHash, 1000, 1, null, null, true);
    const s2 = engine.publishSignal("user-2", "buy", "ETH", 1, 3000, txHash, 1000, 1, null, null, true);
    expect(s1).toBeGreaterThan(0);
    expect(s2).toBeGreaterThan(s1);
  });

  it("pollClosedSignals notifies subscribers when signal is closed", async () => {
    const notifier = vi.fn(async () => {});
    engine.setNotifier(notifier);

    engine.upsertProvider("user-1", "Alice");
    engine.upsertProvider("user-2", "Bob");
    engine.subscribe("user-2", "user-1", false, null, 5);

    const signalId = engine.publishSignal("user-1", "buy", "ETH", 1, 3000, "0x" + "a".repeat(64), 1000, 1, null, null, true);

    // Drain new signal notifications first
    await (engine as any).pollNewSignals();
    notifier.mockClear();

    // Close the signal
    engine.closeSignal(signalId, "user-1", 3300, null);

    // Poll for close notifications
    await (engine as any).pollClosedSignals();

    expect(notifier).toHaveBeenCalledWith("user-2", expect.stringContaining("Signal Closed"));
    expect(notifier).toHaveBeenCalledWith("user-2", expect.stringContaining("PnL:"));
  });

  it("expireOldSignals marks old open signals as expired", () => {
    engine.upsertProvider("user-1", "Alice");
    engine.publishSignal("user-1", "buy", "ETH", 1, 3000, "0x" + "a".repeat(64), 1000, 1, null, null, true);

    // Manually age the signal
    db.prepare("UPDATE signals SET created_at = datetime('now', '-8 days')").run();

    (engine as any).expireOldSignals();

    const signal = engine.getSignal(1);
    expect(signal!.status).toBe("expired");
  });
});

// ─── Skill Factory Tests ──────────────────────────────────────

describe("createTradingSignalsSkill", () => {
  let db: Database.Database;
  let engine: TradingSignalsEngine;
  let skill: ReturnType<typeof createTradingSignalsSkill>;

  beforeEach(() => {
    db = new Database(":memory:");
    engine = new TradingSignalsEngine(db, RPC_OVERRIDES);
    skill = createTradingSignalsSkill(engine);
    mockFetchWithRetry.mockReset();
  });

  afterEach(() => {
    engine.stop();
    db.close();
  });

  it("has correct name and description", () => {
    expect(skill.name).toBe("trading-signals");
    expect(skill.description).toContain("trading signals");
  });

  it("publish requires wallet address", async () => {
    const ctx = mockContext({ walletAddress: null });
    const result = await skill.execute(
      { action: "publish", token: "ETH", txHash: "0x" + "a".repeat(64), signalAction: "buy", collateralUsd: 1000, entryPrice: 3000, chainId: 1 },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("wallet");
  });

  it("publish requires mandatory fields", async () => {
    const ctx = mockContext();
    const result = await skill.execute({ action: "publish", chainId: 1 }, ctx);
    expect(result.success).toBe(false);
  });

  it("publish succeeds with valid params and verified TX", async () => {
    const ctx = mockContext();

    // Mock successful TX verification
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          status: "0x1",
          from: ctx.walletAddress,
          to: "0x0000000000000000000000000000000000000001",
          logs: [],
        },
      }),
    });
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [] }),
    });

    const result = await skill.execute(
      {
        action: "publish",
        token: "ETH",
        txHash: "0x" + "a".repeat(64),
        signalAction: "buy",
        collateralUsd: 1000,
        entryPrice: 3000,
        chainId: 1,
      },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain("Signal Published");
    expect(result.data).toHaveProperty("signalId");
    expect((result.data as any).verified).toBe(true);
  });

  it("feed returns signals", async () => {
    engine.upsertProvider("user-1", "Alice");
    engine.publishSignal("user-1", "buy", "ETH", 1, 3000, "0x" + "a".repeat(64), 1000, 1, null, null, true);

    const ctx = mockContext();
    const result = await skill.execute({ action: "feed", chainId: 1 }, ctx);
    expect(result.success).toBe(true);
    expect(result.message).toContain("Signal Feed");
  });

  it("leaderboard returns empty when insufficient signals", async () => {
    const ctx = mockContext();
    const result = await skill.execute({ action: "leaderboard", chainId: 1 }, ctx);
    expect(result.success).toBe(true);
    expect(result.message).toContain("No providers");
  });

  it("subscribe and unsubscribe flow", async () => {
    engine.upsertProvider("user-2", "Bob");
    const ctx = mockContext();

    const subResult = await skill.execute(
      { action: "subscribe", providerId: "user-2", chainId: 1 },
      ctx,
    );
    expect(subResult.success).toBe(true);
    expect(subResult.message).toContain("Subscribed");

    const unsubResult = await skill.execute(
      { action: "unsubscribe", providerId: "user-2", chainId: 1 },
      ctx,
    );
    expect(unsubResult.success).toBe(true);
    expect(unsubResult.message).toContain("Unsubscribed");
  });

  it("my-signals returns user signals", async () => {
    engine.upsertProvider("user-1", "Alice");
    engine.publishSignal("user-1", "buy", "ETH", 1, 3000, "0x" + "a".repeat(64), 1000, 1, null, null, true);

    const ctx = mockContext();
    const result = await skill.execute({ action: "my-signals", chainId: 1 }, ctx);
    expect(result.success).toBe(true);
    expect(result.message).toContain("Your Signals");
  });

  it("my-subscriptions returns empty initially", async () => {
    const ctx = mockContext();
    const result = await skill.execute({ action: "my-subscriptions", chainId: 1 }, ctx);
    expect(result.success).toBe(true);
    expect(result.message).toContain("No active subscriptions");
  });

  it("publish rejects zero entryPrice via Zod", async () => {
    const ctx = mockContext();

    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          status: "0x1",
          from: ctx.walletAddress,
          to: "0x0000000000000000000000000000000000000001",
          logs: [],
        },
      }),
    });
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [] }),
    });

    await expect(
      skill.execute(
        {
          action: "publish",
          token: "ETH",
          txHash: "0x" + "a".repeat(64),
          signalAction: "buy",
          collateralUsd: 1000,
          entryPrice: 0,
          chainId: 1,
        },
        ctx,
      ),
    ).rejects.toThrow();
  });

  it("providers lists available providers", async () => {
    engine.upsertProvider("user-2", "BetaTrader");
    const ctx = mockContext();
    const result = await skill.execute({ action: "providers", chainId: 1 }, ctx);
    expect(result.success).toBe(true);
    expect(result.message).toContain("BetaTrader");
  });
});
