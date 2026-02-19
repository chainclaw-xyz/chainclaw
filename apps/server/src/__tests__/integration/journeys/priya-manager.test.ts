/**
 * Priya's Portfolio Manager Journey Integration Test
 *
 * Persona: 31-year-old quant at a crypto fund, professional DeFi experience
 * Journey: portfolio → agent start+status → marketplace → history JSON → reasoning
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createMockAdapterControls } from "../mocks/mock-chain-adapter.js";
import { ETH_BALANCE_2ETH, USDC_BALANCE_5K, STANDARD_PRICES } from "../mocks/canned-responses.js";

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

describe("Priya's portfolio management journey", () => {
  let harness: TestHarness;
  const userId = "priya-001";
  let agentId: string;

  beforeAll(() => {
    adapterControls.setBalance(1, ETH_BALANCE_2ETH);
    adapterControls.setTokenBalances(1, [USDC_BALANCE_5K]);

    harness = createTestHarness({ adapterControls });
    harness.fetchRouter.onCoinGecko(STANDARD_PRICES);
    vi.stubGlobal("fetch", harness.fetchRouter.handler);

    harness.walletManager.generateWalletFromMnemonic("priya-fund");
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    harness.cleanup();
  });

  it("step 1: views portfolio with USD values", async () => {
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

  it("step 2: starts a DCA agent and checks status", async () => {
    const agentSkill = harness.skillRegistry.get("agent")!;

    // Start
    const started = await agentSkill.execute(
      { action: "start", strategy: "dca", token: "ETH" },
      { userId, walletAddress: null, chainIds: [1], sendReply: vi.fn() },
    );
    expect(started.success).toBe(true);
    expect(started.message).toContain("agent-");

    // Capture agent ID for later steps
    const idMatch = started.message.match(/agent-[a-z0-9-]+/);
    agentId = idMatch![0];

    // Status
    const status = await agentSkill.execute(
      { action: "status", agentId },
      { userId, walletAddress: null, chainIds: [1], sendReply: vi.fn() },
    );
    expect(status.success).toBe(true);
  });

  it("step 3: browses marketplace agents", async () => {
    const skill = harness.skillRegistry.get("marketplace")!;
    const result = await skill.execute(
      { action: "browse" },
      { userId, walletAddress: null, chainIds: [1], sendReply: vi.fn() },
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("dca");
  });

  it("step 4: exports transaction history as JSON", async () => {
    // Insert a record
    harness.executor.getTransactionLog().create({
      userId,
      chainId: 1,
      from: harness.walletManager.getDefaultAddress()!,
      to: "0x0000000000000000000000000000000000000001",
      value: "1000000000000000000",
      skillName: "swap",
      intentDescription: "Portfolio rebalance",
    });

    const skill = harness.skillRegistry.get("history")!;
    const result = await skill.execute(
      { format: "json" },
      { userId, walletAddress: null, chainIds: [1], sendReply: vi.fn() },
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("```json");
    expect(result.message).toContain("swap");
  });

  it("step 5: views agent reasoning traces", async () => {
    const agentSkill = harness.skillRegistry.get("agent")!;
    const result = await agentSkill.execute(
      { action: "reasoning", agentId },
      { userId, walletAddress: null, chainIds: [1], sendReply: vi.fn() },
    );

    // May be empty or have traces — either way should succeed
    expect(result.success).toBe(true);
  });
});
