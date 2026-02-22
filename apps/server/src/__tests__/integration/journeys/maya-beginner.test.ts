/**
 * Maya's Beginner Journey Integration Test
 *
 * Persona: 28-year-old marketing professional, crypto-curious, DeFi newcomer
 * Journey: /start → wallet create → /balance → risk_check → alert → portfolio
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { createMockAdapterControls } from "../mocks/mock-chain-adapter.js";
import { ETH_BALANCE_1ETH, USDC_BALANCE_5K, BASE_ETH_BALANCE, ARB_ETH_BALANCE, OP_ETH_BALANCE, STANDARD_PRICES } from "../mocks/canned-responses.js";

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

describe("Maya's beginner journey", () => {
  let harness: TestHarness;
  const userId = "maya-001";

  beforeAll(() => {
    adapterControls.setBalance(1, ETH_BALANCE_1ETH);
    adapterControls.setTokenBalances(1, [USDC_BALANCE_5K]);
    adapterControls.setBalance(8453, BASE_ETH_BALANCE);
    adapterControls.setBalance(42161, ARB_ETH_BALANCE);
    adapterControls.setBalance(10, OP_ETH_BALANCE);

    harness = createTestHarness({ adapterControls, withAgentRuntime: true });
    harness.fetchRouter.onCoinGecko(STANDARD_PRICES);
    harness.fetchRouter.onGoPlus();
    vi.stubGlobal("fetch", harness.fetchRouter.handler);
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", harness.fetchRouter.handler);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    harness.cleanup();
  });

  it("step 1: /start shows onboarding wizard", async () => {
    const ctx = createTestCtx({ userId });
    await harness.router.handleStart(ctx);

    expect(ctx.replies[0]).toContain("Setup Guide");
    expect(ctx.replies[0]).toContain("Create a wallet");
  });

  it("step 2: /wallet create generates wallet with mnemonic", async () => {
    const ctx = createTestCtx({ userId });
    await harness.router.handleWallet(ctx, ["create", "maya-wallet"]);

    expect(ctx.replies[0]).toContain("Wallet Created");
    expect(ctx.replies[0]).toContain("maya-wallet");
    expect(ctx.replies[0]).toMatch(/0x[a-fA-F0-9]{40}/);
    // Verify wallet is now set as default
    expect(harness.walletManager.getDefaultAddress()).not.toBeNull();
  });

  it("step 3: /balance shows multi-chain balances", async () => {
    const ctx = createTestCtx({ userId });
    await harness.router.handleBalance(ctx);

    const allReplies = ctx.replies.join("\n");
    expect(allReplies).toContain("ETH");
    expect(allReplies).toContain("Ethereum");
  });

  it("step 4: risk_check on suspicious contract warns Maya", async () => {
    // Mock honeypot for this test
    harness.fetchRouter.onGoPlus({ isHoneypot: true });

    const skill = harness.skillRegistry.get("risk_check")!;
    const ctx = createTestCtx({ userId });
    const result = await skill.execute(
      { contractAddress: "0x0000000000000000000000000000000000000001", chainId: 1 },
      { userId, walletAddress: null, chainIds: [1], sendReply: ctx.sendReply },
    );

    expect(result.message).toContain("Recommendation");

    // Reset GoPlus mock to safe
    harness.fetchRouter.onGoPlus();
  });

  it("step 5: creates a price alert for ETH", async () => {
    const skill = harness.skillRegistry.get("alert")!;
    const result = await skill.execute(
      { action: "create", type: "price_below", token: "ETH", threshold: 2500 },
      { userId, walletAddress: null, chainIds: [1], sendReply: vi.fn() },
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("Alert");
    expect(result.message).toContain("Created");
    expect(result.message).toContain("ETH");
  });

  it("step 6: portfolio shows balances with USD values", async () => {
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

  it("step 7: NL balance check via agent runtime", async () => {
    harness.mockLLM.enqueueIntent("balance", {});

    const ctx = createTestCtx({ userId });
    await harness.router.handleMessage(ctx, "what's my ETH balance?");

    const allReplies = ctx.replies.join("\n");
    expect(allReplies).toContain("ETH");
  });

  it("full journey: state persists across all steps", () => {
    // Wallet was created in step 2 and persists
    expect(harness.walletManager.listWallets()).toHaveLength(1);
    // Alert was created in step 5 and persists in DB
    const alerts = harness.alertEngine.getUserAlerts(userId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].token).toBe("ETH");
  });
});
