import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createMockAdapterControls } from "../mocks/mock-chain-adapter.js";
import { ETH_BALANCE_1ETH, USDC_BALANCE_5K, BASE_ETH_BALANCE, STANDARD_PRICES } from "../mocks/canned-responses.js";
import { FetchRouter } from "../mocks/fetch-router.js";

const adapterControls = createMockAdapterControls();

vi.mock("@chainclaw/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@chainclaw/core")>();
  return {
    ...original,
    getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    createLogger: vi.fn(),
  };
});

vi.mock("@chainclaw/chains", async (importOriginal) => {
  const original = await importOriginal<typeof import("@chainclaw/chains")>();
  return {
    ...original,
    createChainAdapter: vi.fn((chainId: number) => adapterControls.getAdapter(chainId)),
    createSolanaAdapter: vi.fn(() => adapterControls.getAdapter(900)),
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue({
      getBalance: vi.fn().mockResolvedValue(BigInt(0)),
      readContract: vi.fn().mockResolvedValue(BigInt(0)),
      getGasPrice: vi.fn().mockResolvedValue(BigInt("30000000000")),
      getBlockNumber: vi.fn().mockResolvedValue(BigInt("19000000")),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", blockNumber: BigInt(19000000), gasUsed: BigInt(21000), effectiveGasPrice: BigInt("30000000000") }),
    }),
    encodeFunctionData: vi.fn().mockReturnValue("0xmocked_calldata"),
  };
});

import { createTestHarness, type TestHarness } from "../harness.js";
import { createTestCtx } from "../context-factory.js";

describe("Skill execution through real SkillRegistry", () => {
  let harness: TestHarness;

  beforeAll(() => {
    // Set up balances on multiple chains
    adapterControls.setBalance(1, ETH_BALANCE_1ETH);
    adapterControls.setTokenBalances(1, [USDC_BALANCE_5K]);
    adapterControls.setBalance(8453, BASE_ETH_BALANCE);

    harness = createTestHarness({ adapterControls });

    // Install global fetch mock
    harness.fetchRouter.onCoinGecko(STANDARD_PRICES);
    harness.fetchRouter.onGoPlus();
    vi.stubGlobal("fetch", harness.fetchRouter.handler);

    // Create a wallet so skills requiring one work
    harness.walletManager.generateWalletFromMnemonic("integration-wallet");
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    harness.cleanup();
  });

  // ─── Balance ────────────────────────────────────────────────

  it("balance skill returns multi-chain formatted output", async () => {
    const skill = harness.skillRegistry.get("balance")!;
    const result = await skill.execute(
      {},
      {
        userId: "u-1",
        walletAddress: harness.walletManager.getDefaultAddress()!,
        chainIds: harness.chainManager.getSupportedChains(),
        sendReply: vi.fn(),
      },
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("ETH");
    expect(result.message).toContain("Ethereum");
  });

  // ─── Portfolio ──────────────────────────────────────────────

  it("portfolio skill returns balances with USD values", async () => {
    const skill = harness.skillRegistry.get("portfolio")!;
    const result = await skill.execute(
      {},
      {
        userId: "u-1",
        walletAddress: harness.walletManager.getDefaultAddress()!,
        chainIds: harness.chainManager.getSupportedChains(),
        sendReply: vi.fn(),
      },
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("Portfolio");
    expect(result.message).toContain("$");
  });

  // ─── Alert lifecycle ───────────────────────────────────────

  it("alert: create → list → delete lifecycle", async () => {
    const skill = harness.skillRegistry.get("alert")!;
    const ctx = {
      userId: "u-alert",
      walletAddress: harness.walletManager.getDefaultAddress()!,
      chainIds: [1],
      sendReply: vi.fn(),
    };

    // Create
    const created = await skill.execute(
      { action: "create", type: "price_below", token: "ETH", threshold: 2000 },
      ctx,
    );
    expect(created.success).toBe(true);
    expect(created.message).toContain("Alert #");
    expect(created.message).toContain("Created");

    // List
    const listed = await skill.execute({ action: "list" }, ctx);
    expect(listed.success).toBe(true);
    expect(listed.message).toContain("ETH");
    expect(listed.message).toContain("2,000");

    // Delete
    const deleted = await skill.execute({ action: "delete", alertId: 1 }, ctx);
    expect(deleted.success).toBe(true);
    expect(deleted.message).toContain("deleted");

    // List again — empty
    const empty = await skill.execute({ action: "list" }, ctx);
    expect(empty.message).toContain("No active alerts");
  });

  // ─── DCA lifecycle ─────────────────────────────────────────

  it("dca: create → list lifecycle", async () => {
    const skill = harness.skillRegistry.get("dca")!;
    const ctx = {
      userId: "u-dca",
      walletAddress: harness.walletManager.getDefaultAddress()!,
      chainIds: [1],
      sendReply: vi.fn(),
    };

    const created = await skill.execute(
      { action: "create", fromToken: "ETH", toToken: "USDC", amount: "0.1", chainId: 1, frequency: "daily" },
      ctx,
    );
    expect(created.success).toBe(true);
    expect(created.message).toContain("DCA");

    const listed = await skill.execute({ action: "list" }, ctx);
    expect(listed.success).toBe(true);
    expect(listed.message).toContain("ETH");
  });

  // ─── History ───────────────────────────────────────────────

  it("history skill returns empty then shows records after tx log entry", async () => {
    const skill = harness.skillRegistry.get("history")!;
    const ctx = {
      userId: "u-history",
      walletAddress: harness.walletManager.getDefaultAddress()!,
      chainIds: [1],
      sendReply: vi.fn(),
    };

    // Empty initially
    const empty = await skill.execute({ format: "text" }, ctx);
    expect(empty.success).toBe(true);
    expect(empty.message).toContain("No transactions found");

    // Insert a record
    harness.executor.getTransactionLog().create({
      userId: "u-history",
      chainId: 1,
      from: "0xabc",
      to: "0xdef",
      value: "1000000000000000000",
      skillName: "swap",
      intentDescription: "Swap 1 ETH for USDC",
    });

    // Now should have records
    const withRecords = await skill.execute({ format: "text" }, ctx);
    expect(withRecords.success).toBe(true);
    expect(withRecords.message).toContain("Recent Transactions");
    expect(withRecords.message).toContain("swap");
  });

  it("history skill exports CSV", async () => {
    const skill = harness.skillRegistry.get("history")!;
    const result = await skill.execute(
      { format: "csv" },
      { userId: "u-history", walletAddress: null, chainIds: [1], sendReply: vi.fn() },
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("id,date,skill,status");
  });

  it("history skill exports JSON", async () => {
    const skill = harness.skillRegistry.get("history")!;
    const result = await skill.execute(
      { format: "json" },
      { userId: "u-history", walletAddress: null, chainIds: [1], sendReply: vi.fn() },
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("```json");
  });

  // ─── Workflow ──────────────────────────────────────────────

  it("workflow executes multi-step (balance + alert) through registry", async () => {
    const skill = harness.skillRegistry.get("workflow")!;
    const ctx = {
      userId: "u-wf",
      walletAddress: harness.walletManager.getDefaultAddress()!,
      chainIds: harness.chainManager.getSupportedChains(),
      sendReply: vi.fn(),
    };

    const result = await skill.execute(
      {
        steps: [
          { skill: "balance", params: {} },
          { skill: "alert", params: { action: "create", type: "price_above", token: "BTC", threshold: 100000 } },
        ],
      },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("Workflow Complete");
    expect(result.message).toContain("2/2");
  });

  // ─── Risk Check ────────────────────────────────────────────

  it("risk_check returns risk report for a contract", async () => {
    const skill = harness.skillRegistry.get("risk_check")!;
    const ctx = {
      userId: "u-risk",
      walletAddress: null,
      chainIds: [1],
      sendReply: vi.fn(),
    };

    const result = await skill.execute(
      { contractAddress: "0x0000000000000000000000000000000000000001", chainId: 1 },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("Recommendation");
  });

});
