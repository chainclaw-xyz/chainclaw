import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { PrivacyEngine, createPrivacySkill } from "../privacy.js";
import type { PrivacyProvider } from "../privacy-types.js";
import type { SkillExecutionContext } from "../types.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  fetchWithRetry: vi.fn(),
}));

// ─── Mock Privacy Provider ──────────────────────────────────

function createMockProvider(overrides?: Partial<PrivacyProvider>): PrivacyProvider {
  return {
    name: "mock-privacy",
    supportedChains: [1, 42161],
    init: vi.fn().mockResolvedValue(undefined),
    isInitialized: vi.fn().mockReturnValue(true),
    deposit: vi.fn().mockResolvedValue({
      transactions: [
        {
          to: "0x1111111111111111111111111111111111111111",
          data: "0xabcdef",
          value: "0",
          gasEstimate: 200000,
          description: "Shield 100 USDC via mock-privacy",
        },
      ],
      noteCommitment: "0x" + "aa".repeat(32),
    }),
    withdraw: vi.fn().mockResolvedValue({
      transaction: {
        to: "0x2222222222222222222222222222222222222222",
        data: "0xfedcba",
        value: "0",
        gasEstimate: 400000,
        description: "Unshield 100 USDC via mock-privacy",
      },
      nullifierHash: "0x" + "bb".repeat(32),
    }),
    getShieldedBalance: vi.fn().mockResolvedValue([
      { token: "USDC", tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", amount: "100.00", chainId: 1 },
    ]),
    ...overrides,
  };
}

// ─── Mock Context & Executor ────────────────────────────────

function mockContext(overrides?: Partial<SkillExecutionContext>): SkillExecutionContext {
  return {
    userId: "user-1",
    walletAddress: "0xABCdef1234567890abcdef1234567890ABCDEF12",
    chainIds: [1, 42161],
    sendReply: vi.fn().mockResolvedValue(undefined),
    requestConfirmation: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function createMockExecutor() {
  return {
    execute: vi.fn().mockResolvedValue({ success: true, message: "OK", txId: "tx-1", hash: "0x" + "cc".repeat(32) }),
  };
}

function createMockWalletManager() {
  return {
    getPrivateKey: vi.fn().mockReturnValue("0x" + "dd".repeat(32)),
    getSigner: vi.fn().mockReturnValue({ address: "0xABCdef1234567890abcdef1234567890ABCDEF12" }),
    getAccount: vi.fn(),
  };
}

// ─── Mock getEthPriceUsd ────────────────────────────────────

vi.mock("../prices.js", () => ({
  getEthPriceUsd: vi.fn().mockResolvedValue(3000),
}));

// ─── Engine Tests ──────────────────────────────────────────

describe("PrivacyEngine", () => {
  let db: Database.Database;
  let provider: PrivacyProvider;
  let engine: PrivacyEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    provider = createMockProvider();
    engine = new PrivacyEngine(db, provider);
  });

  afterEach(() => {
    db.close();
  });

  // ─── Table Initialization ──────────────────────────────────

  it("creates both tables on construction", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("privacy_deposits");
    expect(names).toContain("privacy_withdrawals");
  });

  // ─── Deposit Tracking ─────────────────────────────────────

  it("recordDeposit creates a deposit record", () => {
    const id = engine.recordDeposit("user-1", 1, "USDC", "100", "0xcommitment");
    expect(id).toBeGreaterThan(0);

    const deposits = engine.getUserDeposits("user-1");
    expect(deposits).toHaveLength(1);
    expect(deposits[0].token).toBe("USDC");
    expect(deposits[0].amount).toBe("100");
    expect(deposits[0].status).toBe("pending");
    expect(deposits[0].note_commitment).toBe("0xcommitment");
  });

  it("recordDeposit normalizes token to uppercase", () => {
    engine.recordDeposit("user-1", 1, "usdc", "100", "0xcommitment");
    const deposits = engine.getUserDeposits("user-1");
    expect(deposits[0].token).toBe("USDC");
  });

  it("confirmDeposit updates status and tx_hash", () => {
    const id = engine.recordDeposit("user-1", 1, "USDC", "100", "0xcommitment");
    engine.confirmDeposit(id, "0xtxhash");

    const deposits = engine.getUserDeposits("user-1");
    expect(deposits[0].status).toBe("confirmed");
    expect(deposits[0].tx_hash).toBe("0xtxhash");
  });

  it("failDeposit deletes pending deposit", () => {
    const id = engine.recordDeposit("user-1", 1, "USDC", "100", "0xcommitment");
    engine.failDeposit(id);

    const deposits = engine.getUserDeposits("user-1");
    expect(deposits).toHaveLength(0);
  });

  it("failDeposit does not delete confirmed deposit", () => {
    const id = engine.recordDeposit("user-1", 1, "USDC", "100", "0xcommitment");
    engine.confirmDeposit(id, "0xtxhash");
    engine.failDeposit(id);

    const deposits = engine.getUserDeposits("user-1");
    expect(deposits).toHaveLength(1); // still exists
  });

  // ─── Withdrawal Tracking ───────────────────────────────────

  it("recordWithdrawal creates a withdrawal record", () => {
    const id = engine.recordWithdrawal("user-1", 1, "USDC", "50", "0xrecipient", "0xnullifier");
    expect(id).toBeGreaterThan(0);

    const withdrawals = engine.getUserWithdrawals("user-1");
    expect(withdrawals).toHaveLength(1);
    expect(withdrawals[0].amount).toBe("50");
    expect(withdrawals[0].status).toBe("pending");
    expect(withdrawals[0].nullifier_hash).toBe("0xnullifier");
  });

  it("confirmWithdrawal updates status and tx_hash", () => {
    const id = engine.recordWithdrawal("user-1", 1, "USDC", "50", "0xrecipient", "0xnullifier");
    engine.confirmWithdrawal(id, "0xtxhash");

    const withdrawals = engine.getUserWithdrawals("user-1");
    expect(withdrawals[0].status).toBe("confirmed");
    expect(withdrawals[0].tx_hash).toBe("0xtxhash");
  });

  it("failWithdrawal updates status to failed", () => {
    const id = engine.recordWithdrawal("user-1", 1, "USDC", "50", "0xrecipient", "0xnullifier");
    engine.failWithdrawal(id);

    const withdrawals = engine.getUserWithdrawals("user-1");
    expect(withdrawals[0].status).toBe("failed");
  });

  // ─── History Queries ───────────────────────────────────────

  it("getUserDeposits respects limit and offset", () => {
    for (let i = 0; i < 5; i++) {
      engine.recordDeposit("user-1", 1, "USDC", String(i * 100), `0xcommit${i}`);
    }

    const page1 = engine.getUserDeposits("user-1", 2, 0);
    expect(page1).toHaveLength(2);

    const page2 = engine.getUserDeposits("user-1", 2, 2);
    expect(page2).toHaveLength(2);

    const page3 = engine.getUserDeposits("user-1", 2, 4);
    expect(page3).toHaveLength(1);
  });

  it("getUserDeposits only returns deposits for the given user", () => {
    engine.recordDeposit("user-1", 1, "USDC", "100", "0xa");
    engine.recordDeposit("user-2", 1, "USDC", "200", "0xb");

    expect(engine.getUserDeposits("user-1")).toHaveLength(1);
    expect(engine.getUserDeposits("user-2")).toHaveLength(1);
  });

  // ─── Provider Access ──────────────────────────────────────

  it("getProvider returns the injected provider", () => {
    expect(engine.getProvider().name).toBe("mock-privacy");
  });

  it("ensureInitialized calls provider init when not initialized", async () => {
    const uninitProvider = createMockProvider({
      isInitialized: vi.fn().mockReturnValue(false),
    });
    const eng = new PrivacyEngine(db, uninitProvider);
    await eng.ensureInitialized();
    expect(uninitProvider.init).toHaveBeenCalled();
  });

  it("ensureInitialized skips init when already initialized", async () => {
    await engine.ensureInitialized();
    expect(provider.init).not.toHaveBeenCalled();
  });
});

// ─── Skill Factory Tests ────────────────────────────────────

describe("createPrivacySkill", () => {
  let db: Database.Database;
  let provider: PrivacyProvider;
  let engine: PrivacyEngine;
  let executor: ReturnType<typeof createMockExecutor>;
  let walletManager: ReturnType<typeof createMockWalletManager>;
  let skill: ReturnType<typeof createPrivacySkill>;

  beforeEach(() => {
    db = new Database(":memory:");
    provider = createMockProvider();
    engine = new PrivacyEngine(db, provider);
    executor = createMockExecutor();
    walletManager = createMockWalletManager();
    skill = createPrivacySkill(engine, executor as any, walletManager as any);
  });

  afterEach(() => {
    db.close();
  });

  it("has correct name and description", () => {
    expect(skill.name).toBe("privacy");
    expect(skill.description).toContain("privacy");
  });

  it("requires wallet address", async () => {
    const ctx = mockContext({ walletAddress: null });
    const result = await skill.execute({ action: "deposit", token: "USDC", amount: "100", chainId: 1 }, ctx);
    expect(result.success).toBe(false);
    expect(result.message).toContain("wallet");
  });

  // ─── Deposit ──────────────────────────────────────────────

  it("deposit requires token and amount", async () => {
    const ctx = mockContext();
    const result = await skill.execute({ action: "deposit", chainId: 1 }, ctx);
    expect(result.success).toBe(false);
    expect(result.message).toContain("token");
  });

  it("deposit rejects unsupported chain", async () => {
    const ctx = mockContext();
    const result = await skill.execute(
      { action: "deposit", token: "USDC", amount: "100", chainId: 999 },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("does not support");
  });

  it("deposit succeeds with valid params", async () => {
    const ctx = mockContext();
    const result = await skill.execute(
      { action: "deposit", token: "USDC", amount: "100", chainId: 1 },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain("Privacy Deposit Complete");
    expect(result.message).toContain("USDC");
    expect(result.data).toHaveProperty("depositId");
    expect(result.data).toHaveProperty("noteCommitment");

    // Verify executor was called
    expect(executor.execute).toHaveBeenCalled();

    // Verify deposit recorded in DB
    const deposits = engine.getUserDeposits("user-1");
    expect(deposits).toHaveLength(1);
    expect(deposits[0].status).toBe("confirmed");
  });

  it("deposit handles multi-step transactions (approve + shield)", async () => {
    const multiStepProvider = createMockProvider({
      deposit: vi.fn().mockResolvedValue({
        transactions: [
          { to: "0x1111", data: "0xapprove", value: "0", gasEstimate: 60000, description: "Approve USDC" },
          { to: "0x2222", data: "0xshield", value: "0", gasEstimate: 300000, description: "Shield 100 USDC" },
        ],
        noteCommitment: "0x" + "aa".repeat(32),
      }),
    });

    const eng = new PrivacyEngine(db, multiStepProvider);
    const sk = createPrivacySkill(eng, executor as any, walletManager as any);
    const ctx = mockContext();

    const result = await sk.execute(
      { action: "deposit", token: "USDC", amount: "100", chainId: 1 },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(executor.execute).toHaveBeenCalledTimes(2);
  });

  it("deposit cleans up on executor failure", async () => {
    executor.execute.mockResolvedValueOnce({ success: false, message: "TX reverted" });

    const ctx = mockContext();
    const result = await skill.execute(
      { action: "deposit", token: "USDC", amount: "100", chainId: 1 },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("failed");

    // Pending deposit should be cleaned up
    const deposits = engine.getUserDeposits("user-1");
    expect(deposits).toHaveLength(0);
  });

  it("deposit handles provider error", async () => {
    const failProvider = createMockProvider({
      deposit: vi.fn().mockRejectedValue(new Error("Provider down")),
    });

    const eng = new PrivacyEngine(db, failProvider);
    const sk = createPrivacySkill(eng, executor as any, walletManager as any);
    const ctx = mockContext();

    const result = await sk.execute(
      { action: "deposit", token: "USDC", amount: "100", chainId: 1 },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("Provider down");
  });

  // ─── Withdraw ─────────────────────────────────────────────

  it("withdraw requires token and amount", async () => {
    const ctx = mockContext();
    const result = await skill.execute({ action: "withdraw", chainId: 1 }, ctx);
    expect(result.success).toBe(false);
    expect(result.message).toContain("token");
  });

  it("withdraw succeeds with valid params", async () => {
    const ctx = mockContext();
    const result = await skill.execute(
      { action: "withdraw", token: "USDC", amount: "50", chainId: 1 },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("Privacy Withdrawal Complete");
    expect(result.data).toHaveProperty("withdrawalId");
    expect(result.data).toHaveProperty("nullifierHash");

    expect(executor.execute).toHaveBeenCalled();
  });

  it("withdraw uses custom recipient address when provided", async () => {
    const ctx = mockContext();
    const recipient = "0x9999999999999999999999999999999999999999";

    await skill.execute(
      { action: "withdraw", token: "USDC", amount: "50", chainId: 1, recipientAddress: recipient },
      ctx,
    );

    // Check the provider was called with the custom recipient
    expect(provider.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({ recipientAddress: recipient }),
    );

    // Check DB recorded the custom recipient
    const withdrawals = engine.getUserWithdrawals("user-1");
    expect(withdrawals[0].recipient_address).toBe(recipient);
  });

  it("withdraw defaults recipient to own wallet", async () => {
    const ctx = mockContext();
    await skill.execute(
      { action: "withdraw", token: "USDC", amount: "50", chainId: 1 },
      ctx,
    );

    expect(provider.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({ recipientAddress: ctx.walletAddress }),
    );
  });

  it("withdraw marks failure on executor error", async () => {
    executor.execute.mockResolvedValueOnce({ success: false, message: "Proof invalid" });

    const ctx = mockContext();
    const result = await skill.execute(
      { action: "withdraw", token: "USDC", amount: "50", chainId: 1 },
      ctx,
    );

    expect(result.success).toBe(false);
    const withdrawals = engine.getUserWithdrawals("user-1");
    expect(withdrawals[0].status).toBe("failed");
  });

  // ─── Balance ──────────────────────────────────────────────

  it("balance returns shielded balances", async () => {
    const ctx = mockContext();
    const result = await skill.execute({ action: "balance", chainId: 1 }, ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Shielded Balances");
    expect(result.message).toContain("100.00 USDC");
  });

  it("balance returns empty message when no balances", async () => {
    const emptyProvider = createMockProvider({
      getShieldedBalance: vi.fn().mockResolvedValue([]),
    });

    const eng = new PrivacyEngine(db, emptyProvider);
    const sk = createPrivacySkill(eng, executor as any, walletManager as any);
    const ctx = mockContext();

    const result = await sk.execute({ action: "balance", chainId: 1 }, ctx);
    expect(result.success).toBe(true);
    expect(result.message).toContain("No shielded balances");
  });

  it("balance rejects unsupported chain", async () => {
    const ctx = mockContext();
    const result = await skill.execute({ action: "balance", chainId: 999 }, ctx);
    expect(result.success).toBe(false);
    expect(result.message).toContain("does not support");
  });

  // ─── History ──────────────────────────────────────────────

  it("history returns empty when no transactions", async () => {
    const ctx = mockContext();
    const result = await skill.execute({ action: "history", chainId: 1 }, ctx);
    expect(result.success).toBe(true);
    expect(result.message).toContain("No privacy transaction history");
  });

  it("history returns deposits and withdrawals", async () => {
    engine.recordDeposit("user-1", 1, "USDC", "100", "0xcommit");
    engine.confirmDeposit(1, "0xtx1");
    engine.recordWithdrawal("user-1", 1, "USDC", "50", "0x9999999999999999999999999999999999999999", "0xnull");
    engine.confirmWithdrawal(1, "0xtx2");

    const ctx = mockContext();
    const result = await skill.execute({ action: "history", chainId: 1 }, ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Deposits:");
    expect(result.message).toContain("Shield 100 USDC");
    expect(result.message).toContain("Withdrawals:");
    expect(result.message).toContain("Unshield 50 USDC");
  });

  // ─── Provider Init ────────────────────────────────────────

  it("initializes provider lazily on first operation", async () => {
    const uninitProvider = createMockProvider({
      isInitialized: vi.fn()
        .mockReturnValueOnce(false) // first check
        .mockReturnValue(true),    // after init
    });

    const eng = new PrivacyEngine(db, uninitProvider);
    const sk = createPrivacySkill(eng, executor as any, walletManager as any);
    const ctx = mockContext();

    await sk.execute(
      { action: "deposit", token: "USDC", amount: "100", chainId: 1 },
      ctx,
    );

    expect(uninitProvider.init).toHaveBeenCalled();
  });

  it("handles provider init failure gracefully", async () => {
    const failInitProvider = createMockProvider({
      isInitialized: vi.fn().mockReturnValue(false),
      init: vi.fn().mockRejectedValue(new Error("SDK not installed")),
    });

    const eng = new PrivacyEngine(db, failInitProvider);
    const sk = createPrivacySkill(eng, executor as any, walletManager as any);
    const ctx = mockContext();

    const result = await sk.execute(
      { action: "deposit", token: "USDC", amount: "100", chainId: 1 },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("SDK not installed");
  });
});
