import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { createMockAdapterControls } from "../mocks/mock-chain-adapter.js";
import { ETH_BALANCE_1ETH, STANDARD_PRICES } from "../mocks/canned-responses.js";

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

describe("Natural language to skill execution", () => {
  let harness: TestHarness;

  beforeAll(() => {
    adapterControls.setBalance(1, ETH_BALANCE_1ETH);

    harness = createTestHarness({ adapterControls, withAgentRuntime: true });

    harness.fetchRouter.onCoinGecko(STANDARD_PRICES);
    harness.fetchRouter.onGoPlus();
    vi.stubGlobal("fetch", harness.fetchRouter.handler);

    // Create a wallet
    harness.walletManager.generateWalletFromMnemonic("nl-test-wallet");
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", harness.fetchRouter.handler);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    harness.cleanup();
  });

  it("routes 'show my balance' to balance skill via intent parsing", async () => {
    harness.mockLLM.enqueueIntent("balance", {});

    const ctx = createTestCtx({ userId: "nl-user-1" });
    await harness.router.handleMessage(ctx, "show my balance");

    const allReplies = ctx.replies.join("\n");
    expect(allReplies).toContain("ETH");
  });

  it("handles clarification from LLM", async () => {
    harness.mockLLM.enqueueClarification("Which token would you like to swap?");

    const ctx = createTestCtx({ userId: "nl-user-2" });
    await harness.router.handleMessage(ctx, "do a swap");

    const allReplies = ctx.replies.join("\n");
    expect(allReplies).toContain("Which token");
  });

  it("handles conversational reply without skill execution", async () => {
    harness.mockLLM.enqueueConversational("Hello! I'm ChainClaw, your DeFi assistant.");

    const ctx = createTestCtx({ userId: "nl-user-3" });
    await harness.router.handleMessage(ctx, "hello!");

    const allReplies = ctx.replies.join("\n");
    expect(allReplies).toContain("ChainClaw");
  });

  it("returns error when no agentRuntime", async () => {
    const noLlmHarness = createTestHarness({ adapterControls, withAgentRuntime: false });
    const ctx = createTestCtx({ userId: "nl-user-4" });

    await noLlmHarness.router.handleMessage(ctx, "show my balance");

    expect(ctx.replies[0]).toContain("Natural language processing is not configured");
    noLlmHarness.cleanup();
  });

  it("saves conversation to memory for follow-up context", async () => {
    // First message
    harness.mockLLM.enqueueIntent("balance", {});
    const ctx1 = createTestCtx({ userId: "nl-user-5" });
    await harness.router.handleMessage(ctx1, "show my balance");

    // Second message — LLM should receive conversation history
    harness.mockLLM.enqueueConversational("Your balance is unchanged from last check.");
    const ctx2 = createTestCtx({ userId: "nl-user-5" });
    await harness.router.handleMessage(ctx2, "has it changed?");

    const allReplies = ctx2.replies.join("\n");
    expect(allReplies).toContain("unchanged");
  });
});
