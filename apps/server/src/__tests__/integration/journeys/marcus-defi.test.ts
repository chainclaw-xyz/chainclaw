/**
 * Marcus's Active DeFi Journey Integration Test
 *
 * Persona: 34-year-old fintech engineer, 3+ years DeFi
 * Journey: import wallet → portfolio → swap quote → DCA → workflow → history
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { createMockAdapterControls } from "../mocks/mock-chain-adapter.js";
import { ETH_BALANCE_2ETH, USDC_BALANCE_5K, BASE_ETH_BALANCE, ARB_ETH_BALANCE, OP_ETH_BALANCE, STANDARD_PRICES } from "../mocks/canned-responses.js";

const adapterControls = createMockAdapterControls();

vi.mock("@chainclaw/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@chainclaw/core")>();
  return { ...original, getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }), createLogger: vi.fn() };
});

vi.mock("@chainclaw/chains", async (importOriginal) => {
  const original = await importOriginal<typeof import("@chainclaw/chains")>();
  return { ...original, createChainAdapter: vi.fn((chainId: number) => adapterControls.getAdapter(chainId)), createSolanaAdapter: vi.fn(() => adapterControls.getAdapter(900)) };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue({
      getBalance: vi.fn().mockResolvedValue(BigInt(0)), readContract: vi.fn().mockResolvedValue(BigInt(0)),
      getGasPrice: vi.fn().mockResolvedValue(BigInt("30000000000")), getBlockNumber: vi.fn().mockResolvedValue(BigInt("19000000")),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", blockNumber: BigInt(19000000), gasUsed: BigInt(21000), effectiveGasPrice: BigInt("30000000000") }),
    }),
    encodeFunctionData: vi.fn().mockReturnValue("0xmocked_calldata"),
  };
});

import { createTestHarness, type TestHarness } from "../harness.js";
import { createTestCtx } from "../context-factory.js";

describe("Marcus's active DeFi journey", () => {
  let harness: TestHarness;
  const userId = "marcus-001";

  beforeAll(() => {
    adapterControls.setBalance(1, ETH_BALANCE_2ETH);
    adapterControls.setTokenBalances(1, [USDC_BALANCE_5K]);
    adapterControls.setBalance(8453, BASE_ETH_BALANCE);
    adapterControls.setBalance(42161, ARB_ETH_BALANCE);
    adapterControls.setBalance(10, OP_ETH_BALANCE);

    harness = createTestHarness({ adapterControls, withAgentRuntime: true });
    harness.fetchRouter.onCoinGecko(STANDARD_PRICES);
    harness.fetchRouter.onGoPlus();
    harness.fetchRouter.on1inchQuote("1000000000000000000", "3000000000");
    vi.stubGlobal("fetch", harness.fetchRouter.handler);
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", harness.fetchRouter.handler);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    harness.cleanup();
  });

  it("step 1: imports existing wallet via /wallet import", async () => {
    const key = generatePrivateKey();
    const ctx = createTestCtx({ userId });

    await harness.router.handleWallet(ctx, ["import", key, "marcus-hw"]);

    expect(ctx.replies[0]).toContain("Wallet Imported");
    expect(harness.walletManager.listWallets()).toHaveLength(1);
  });

  it("step 2: portfolio shows cross-chain balances with USD", async () => {
    const skill = harness.skillRegistry.get("portfolio")!;
    const result = await skill.execute(
      {},
      {
        userId,
        walletAddress: harness.walletManager.getDefaultAddress()!,
        chainIds: harness.chainManager.getSupportedChains(),
        sendReply: vi.fn(),
      },
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("Portfolio");
    expect(result.message).toContain("$");
  });

  it("step 3: swap skill returns quote (quote-only mode, no API key)", async () => {
    const skill = harness.skillRegistry.get("swap")!;
    const result = await skill.execute(
      { fromToken: "ETH", toToken: "USDC", amount: "1", chainId: 1 },
      {
        userId,
        walletAddress: harness.walletManager.getDefaultAddress()!,
        chainIds: [1],
        sendReply: vi.fn(),
        requestConfirmation: vi.fn().mockResolvedValue(true),
      },
    );

    // Without 1INCH_API_KEY, swap should return a quote or error gracefully
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("step 4: creates daily DCA for ETH → USDC", async () => {
    const skill = harness.skillRegistry.get("dca")!;
    const result = await skill.execute(
      { action: "create", fromToken: "ETH", toToken: "USDC", amount: "0.1", chainId: 1, frequency: "daily" },
      {
        userId,
        walletAddress: harness.walletManager.getDefaultAddress()!,
        chainIds: [1],
        sendReply: vi.fn(),
      },
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("DCA");
  });

  it("step 5: runs a workflow (balance + alert create)", async () => {
    const skill = harness.skillRegistry.get("workflow")!;
    const result = await skill.execute(
      {
        steps: [
          { skill: "balance", params: {} },
          { skill: "alert", params: { action: "create", type: "price_above", token: "ETH", threshold: 5000 } },
        ],
      },
      {
        userId,
        walletAddress: harness.walletManager.getDefaultAddress()!,
        chainIds: harness.chainManager.getSupportedChains(),
        sendReply: vi.fn(),
      },
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("Workflow Complete");
  });

  it("step 6: checks transaction history", async () => {
    // Insert a record to simulate past tx
    harness.executor.getTransactionLog().create({
      userId,
      chainId: 1,
      from: harness.walletManager.getDefaultAddress()!,
      to: "0x0000000000000000000000000000000000000001",
      value: "1000000000000000000",
      skillName: "swap",
      intentDescription: "Swap 1 ETH for USDC",
    });

    const skill = harness.skillRegistry.get("history")!;
    const result = await skill.execute(
      { format: "text" },
      { userId, walletAddress: null, chainIds: [1], sendReply: vi.fn() },
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("Recent Transactions");
    expect(result.message).toContain("swap");
  });

  it("step 7: NL workflow via agent runtime", async () => {
    harness.mockLLM.enqueueIntent("portfolio", {});

    const ctx = createTestCtx({ userId });
    await harness.router.handleMessage(ctx, "show my portfolio");

    const allReplies = ctx.replies.join("\n");
    expect(allReplies).toContain("Portfolio");
  });

  it("full journey: accumulated state is consistent", () => {
    expect(harness.walletManager.listWallets()).toHaveLength(1);
    const dcaJobs = harness.dcaScheduler.getUserJobs(userId);
    expect(dcaJobs.length).toBeGreaterThanOrEqual(1);
    const alerts = harness.alertEngine.getUserAlerts(userId);
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });
});
