import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createMockAdapterControls } from "../mocks/mock-chain-adapter.js";
import { ETH_BALANCE_1ETH, USDC_BALANCE_5K } from "../mocks/canned-responses.js";

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

describe("Command routing with real components", () => {
  let harness: TestHarness;

  beforeAll(() => {
    // Set up chain adapter balances
    adapterControls.setBalance(1, ETH_BALANCE_1ETH);
    adapterControls.setTokenBalances(1, [USDC_BALANCE_5K]);

    harness = createTestHarness({ adapterControls });
  });

  afterAll(() => {
    harness.cleanup();
  });

  it("/start shows setup guide when no wallet", async () => {
    const ctx = createTestCtx();
    await harness.router.handleStart(ctx);

    expect(ctx.replies).toHaveLength(1);
    expect(ctx.replies[0]).toContain("Setup Guide");
    expect(ctx.replies[0]).toContain("Create a wallet");
  });

  it("/start shows full welcome after wallet creation", async () => {
    // Create a wallet first
    harness.walletManager.generateWalletFromMnemonic("test-wallet");

    const ctx = createTestCtx();
    await harness.router.handleStart(ctx);

    expect(ctx.replies).toHaveLength(1);
    expect(ctx.replies[0]).toContain("Welcome to ChainClaw");
    expect(ctx.replies[0]).toContain("13 skills");
  });

  it("/help lists all skill descriptions", async () => {
    const ctx = createTestCtx();
    await harness.router.handleHelp(ctx);

    expect(ctx.replies).toHaveLength(1);
    expect(ctx.replies[0]).toContain("ChainClaw Help");
    // Check a few skill names
    expect(ctx.replies[0]).toContain("balance");
    expect(ctx.replies[0]).toContain("swap");
    expect(ctx.replies[0]).toContain("portfolio");
    expect(ctx.replies[0]).toContain("marketplace");
  });

  it("/balance with wallet calls real balance skill through registry", async () => {
    const ctx = createTestCtx();
    await harness.router.handleBalance(ctx);

    // Should get at least one reply with balance info
    expect(ctx.replies.length).toBeGreaterThanOrEqual(1);
    const allReplies = ctx.replies.join("\n");
    expect(allReplies).toContain("ETH");
  });

  it("/balance with no wallet shows error", async () => {
    // Create a separate harness with no wallet
    const freshHarness = createTestHarness({ adapterControls });
    const ctx = createTestCtx();
    await freshHarness.router.handleBalance(ctx);

    expect(ctx.replies[0]).toContain("No wallet configured");
    freshHarness.cleanup();
  });

  it("/clear clears conversation memory", async () => {
    const ctx = createTestCtx();
    await harness.router.handleClear(ctx);

    expect(ctx.replies[0]).toContain("Conversation history cleared");
  });
});
