import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { TokenLaunchEngine, createTokenLaunchSkill } from "../token-launch.js";
import type { TokenLaunchProvider, LaunchParams, LaunchResult } from "../token-launch-types.js";
import type { SkillExecutionContext } from "../types.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  fetchWithRetry: vi.fn(),
}));

// ─── Mock Providers ──────────────────────────────────────────

function createMockEVMProvider(overrides?: Partial<TokenLaunchProvider>): TokenLaunchProvider {
  return {
    name: "mock-evm",
    supportedChains: [8453],
    launch: vi.fn().mockResolvedValue({
      tokenAddress: "0xDeAdBeEf00000000000000000000000000000001",
      message: "Token deployment queued. Expected address: `0xDeAdBeEf00000000000000000000000000000001`",
    } satisfies LaunchResult),
    ...overrides,
  };
}

function createMockSolanaProvider(overrides?: Partial<TokenLaunchProvider>): TokenLaunchProvider {
  // Simulate PumpFunProvider returning a signedTx in the result
  const mockTx = { sign: vi.fn(), serialize: vi.fn().mockReturnValue(new Uint8Array(64)) };
  return {
    name: "mock-pump-fun",
    supportedChains: [900],
    launch: vi.fn().mockResolvedValue({
      tokenAddress: "SoLanaMint1111111111111111111111111111111111",
      message: "Token mint address: `SoLanaMint1111111111111111111111111111111111`",
      signedTx: mockTx,
    }),
    ...overrides,
  };
}

// ─── Mock helpers ─────────────────────────────────────────────

function mockContext(overrides?: Partial<SkillExecutionContext>): SkillExecutionContext {
  return {
    userId: "user-1",
    walletAddress: "0xABCdef1234567890abcdef1234567890ABCDEF12",
    chainIds: [8453, 900],
    sendReply: vi.fn().mockResolvedValue(undefined),
    requestConfirmation: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function createMockWalletManager() {
  return {
    getPrivateKey: vi.fn().mockReturnValue("0x" + "dd".repeat(32)),
    getSolanaSigner: vi.fn().mockReturnValue({ publicKey: "SolWallet111" }),
  };
}

function createMockSolanaExecutor(success = true) {
  return {
    executePrebuilt: vi.fn().mockResolvedValue({
      success,
      txId: "solana-tx-sig-1",
      signature: "solana-sig-1",
      message: success ? "OK" : "Simulation failed",
    }),
  };
}

// ─── TokenLaunchEngine Tests ──────────────────────────────────

describe("TokenLaunchEngine", () => {
  let db: Database.Database;
  let evmProvider: TokenLaunchProvider;
  let engine: TokenLaunchEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    evmProvider = createMockEVMProvider();
    engine = new TokenLaunchEngine(db, [evmProvider]);
  });

  afterEach(() => {
    db.close();
  });

  it("creates the token_launches table on init", () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='token_launches'").get();
    expect(row).toBeTruthy();
  });

  it("maps providers to their supported chains", () => {
    expect(engine.getProvider(8453)).toBe(evmProvider);
    expect(engine.getProvider(1)).toBeUndefined();
  });

  it("records, confirms, and retrieves a launch", () => {
    const id = engine.recordLaunch("user-1", 8453, "MyToken", "MYT", "mock-evm");
    expect(id).toBeGreaterThan(0);

    engine.confirmLaunch(id, "0xToken1", "0xtxhash1");

    const rows = engine.getUserLaunches("user-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("MyToken");
    expect(rows[0].symbol).toBe("MYT");
    expect(rows[0].status).toBe("confirmed");
    expect(rows[0].token_address).toBe("0xToken1");
    expect(rows[0].tx_hash).toBe("0xtxhash1");
  });

  it("marks a launch as failed", () => {
    const id = engine.recordLaunch("user-1", 8453, "FailToken", "FAIL", "mock-evm");
    engine.failLaunch(id);

    const rows = engine.getUserLaunches("user-1");
    expect(rows[0].status).toBe("failed");
  });

  it("returns empty list for user with no launches", () => {
    const rows = engine.getUserLaunches("no-such-user");
    expect(rows).toHaveLength(0);
  });

  it("isolates launches by user", () => {
    engine.recordLaunch("user-1", 8453, "Token A", "TA", "mock-evm");
    engine.recordLaunch("user-2", 8453, "Token B", "TB", "mock-evm");

    expect(engine.getUserLaunches("user-1")).toHaveLength(1);
    expect(engine.getUserLaunches("user-2")).toHaveLength(1);
  });

  it("supports multiple providers across chains", () => {
    const solanaProvider = createMockSolanaProvider();
    const multiEngine = new TokenLaunchEngine(db, [evmProvider, solanaProvider]);

    expect(multiEngine.getProvider(8453)?.name).toBe("mock-evm");
    expect(multiEngine.getProvider(900)?.name).toBe("mock-pump-fun");
    expect(multiEngine.getSupportedChains()).toContain(8453);
    expect(multiEngine.getSupportedChains()).toContain(900);
  });
});

// ─── Skill Tests ──────────────────────────────────────────────

describe("createTokenLaunchSkill — EVM (Clanker)", () => {
  let db: Database.Database;
  let engine: TokenLaunchEngine;
  let walletManager: ReturnType<typeof createMockWalletManager>;
  let skill: ReturnType<typeof createTokenLaunchSkill>;

  beforeEach(() => {
    db = new Database(":memory:");
    const evmProvider = createMockEVMProvider();
    engine = new TokenLaunchEngine(db, [evmProvider]);
    walletManager = createMockWalletManager();
    skill = createTokenLaunchSkill(engine, walletManager as never);
  });

  afterEach(() => {
    db.close();
  });

  it("returns error when name is missing", async () => {
    const ctx = mockContext();
    const result = await skill.execute({ action: "launch", symbol: "MYT", chainId: 8453 }, ctx);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/name.*symbol|name and symbol/i);
  });

  it("returns error when symbol is missing", async () => {
    const ctx = mockContext();
    const result = await skill.execute({ action: "launch", name: "MyToken", chainId: 8453 }, ctx);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/name.*symbol|name and symbol/i);
  });

  it("returns error for unsupported chain", async () => {
    const ctx = mockContext();
    const result = await skill.execute({ action: "launch", name: "T", symbol: "T", chainId: 1 }, ctx);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/No launch provider/i);
  });

  it("returns error when no wallet configured", async () => {
    const ctx = mockContext({ walletAddress: null });
    const result = await skill.execute({ action: "launch", name: "T", symbol: "T", chainId: 8453 }, ctx);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/No wallet/i);
  });

  it("launches a token via Clanker (EVM)", async () => {
    const ctx = mockContext();
    const result = await skill.execute(
      { action: "launch", name: "MyToken", symbol: "MYT", chainId: 8453 },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/MyToken/);
    expect(result.message).toMatch(/MYT/);
    expect(result.message).toMatch(/0xDeAdBeEf/i);

    // Confirmed in DB
    const rows = engine.getUserLaunches("user-1");
    expect(rows[0].status).toBe("confirmed");
    expect(rows[0].provider).toBe("mock-evm");
  });

  it("marks launch as failed when provider throws", async () => {
    const failProvider = createMockEVMProvider({
      launch: vi.fn().mockRejectedValue(new Error("API error 503")),
    });
    const failEngine = new TokenLaunchEngine(db, [failProvider]);
    const failSkill = createTokenLaunchSkill(failEngine, walletManager as never);

    const ctx = mockContext();
    const result = await failSkill.execute(
      { action: "launch", name: "Bad", symbol: "BAD", chainId: 8453 },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/API error 503/);

    const rows = failEngine.getUserLaunches("user-1");
    expect(rows[0].status).toBe("failed");
  });

  it("lists launches", async () => {
    engine.recordLaunch("user-1", 8453, "Token A", "TA", "mock-evm");
    engine.confirmLaunch(1, "0xAddr1");

    const ctx = mockContext();
    const result = await skill.execute({ action: "list" }, ctx);
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Token A/);
    expect(result.message).toMatch(/TA/);
  });

  it("returns empty list message when no launches", async () => {
    const ctx = mockContext();
    const result = await skill.execute({ action: "list" }, ctx);
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/No token launches/i);
  });
});

// Solana wallet address — base58, does NOT start with 0x
const SOLANA_WALLET = "8YNMVRpGpg4AKsjWoiPe3S9HVxZ8j5aFmPVhRLVGUxK";

describe("createTokenLaunchSkill — Solana (pump.fun)", () => {
  let db: Database.Database;
  let engine: TokenLaunchEngine;
  let walletManager: ReturnType<typeof createMockWalletManager>;

  beforeEach(() => {
    db = new Database(":memory:");
    const solanaProvider = createMockSolanaProvider();
    engine = new TokenLaunchEngine(db, [solanaProvider]);
    walletManager = createMockWalletManager();
  });

  afterEach(() => {
    db.close();
  });

  it("returns error when walletAddress is an EVM address (not Solana)", async () => {
    const skill = createTokenLaunchSkill(engine, walletManager as never, undefined);
    // default mockContext uses 0xABCdef... — an EVM address
    const ctx = mockContext({ chainIds: [900] });
    const result = await skill.execute(
      { action: "launch", name: "PumpToken", symbol: "PUMP", chainId: 900 },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Solana wallet/i);
    // No DB record should be created at this point
    expect(engine.getUserLaunches("user-1")).toHaveLength(0);
  });

  it("returns error when solana executor not available", async () => {
    const skill = createTokenLaunchSkill(engine, walletManager as never, undefined);
    const ctx = mockContext({ walletAddress: SOLANA_WALLET, chainIds: [900] });
    const result = await skill.execute(
      { action: "launch", name: "PumpToken", symbol: "PUMP", chainId: 900 },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Solana executor not available/i);

    const rows = engine.getUserLaunches("user-1");
    expect(rows[0].status).toBe("failed");
  });

  it("broadcasts via solana executor and confirms launch", async () => {
    const solanaExecutor = createMockSolanaExecutor(true);
    const skill = createTokenLaunchSkill(engine, walletManager as never, solanaExecutor as never);

    const ctx = mockContext({ walletAddress: SOLANA_WALLET, chainIds: [900] });
    const result = await skill.execute(
      { action: "launch", name: "PumpToken", symbol: "PUMP", chainId: 900, initialBuySol: "0.05" },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/pump\.fun/i);
    expect(result.message).toMatch(/PumpToken/);
    expect(solanaExecutor.executePrebuilt).toHaveBeenCalledOnce();

    const rows = engine.getUserLaunches("user-1");
    expect(rows[0].status).toBe("confirmed");
    expect(rows[0].provider).toBe("mock-pump-fun");
  });

  it("marks launch failed when executor returns failure", async () => {
    const solanaExecutor = createMockSolanaExecutor(false);
    const skill = createTokenLaunchSkill(engine, walletManager as never, solanaExecutor as never);

    const ctx = mockContext({ walletAddress: SOLANA_WALLET, chainIds: [900] });
    const result = await skill.execute(
      { action: "launch", name: "PumpToken", symbol: "PUMP", chainId: 900 },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/failed/i);

    const rows = engine.getUserLaunches("user-1");
    expect(rows[0].status).toBe("failed");
  });
});

// ─── ClankerProvider API key guard ────────────────────────────

describe("ClankerProvider", () => {
  it("returns setup message when API key not configured", async () => {
    const { ClankerProvider } = await import("../providers/clanker.js");
    const provider = new ClankerProvider(undefined);

    const params: LaunchParams = { name: "Test", symbol: "TST", chainId: 8453 };
    const result = await provider.launch(params, "0xWallet", "0xKey");

    expect(result.tokenAddress).toBe("");
    expect(result.message).toMatch(/CLANKER_API_KEY/);
  });
});

// ─── Regression: Clanker no-key → DB record must be 'failed' ──

describe("createTokenLaunchSkill — Clanker no-key regression", () => {
  it("marks launch failed and returns false when Clanker has no API key", async () => {
    const db = new Database(":memory:");
    const noKeyProvider: TokenLaunchProvider = {
      name: "clanker",
      supportedChains: [8453],
      launch: vi.fn().mockResolvedValue({ tokenAddress: "", message: "Set CLANKER_API_KEY in your .env." }),
    };
    const engine = new TokenLaunchEngine(db, [noKeyProvider]);
    const walletManager = createMockWalletManager();
    const skill = createTokenLaunchSkill(engine, walletManager as never);

    const ctx = mockContext();
    const result = await skill.execute({ action: "launch", name: "X", symbol: "X", chainId: 8453 }, ctx);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/CLANKER_API_KEY/);

    const rows = engine.getUserLaunches("user-1");
    expect(rows[0].status).toBe("failed");
    db.close();
  });
});

// ─── handleList respects limit / offset ───────────────────────

describe("createTokenLaunchSkill — list pagination", () => {
  it("forwards limit and offset to getUserLaunches", async () => {
    const db = new Database(":memory:");
    const evmProvider = createMockEVMProvider();
    const engine = new TokenLaunchEngine(db, [evmProvider]);
    const walletManager = createMockWalletManager();
    const skill = createTokenLaunchSkill(engine, walletManager as never);

    // Insert 5 launches
    for (let i = 0; i < 5; i++) {
      engine.recordLaunch("user-1", 8453, `Token${i}`, `TK${i}`, "mock-evm");
    }

    const ctx = mockContext();
    // limit=2, offset=0 → first 2 (newest first)
    const result = await skill.execute({ action: "list", limit: 2, offset: 0 }, ctx);
    expect(result.success).toBe(true);
    const lines = result.message.split("\n").filter((l) => l.startsWith("•"));
    expect(lines).toHaveLength(2);

    db.close();
  });
});
