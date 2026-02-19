/**
 * Dev's Agent Creator Journey Integration Test
 *
 * Persona: 27-year-old full-stack developer, DeFi enthusiast
 * Journey: backtest → agent start → agent status → stop agent
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createMockAdapterControls } from "../mocks/mock-chain-adapter.js";
import { STANDARD_PRICES } from "../mocks/canned-responses.js";

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

describe("Dev's agent creator journey", () => {
  let harness: TestHarness;
  const userId = "dev-001";
  let agentId: string;

  beforeAll(() => {
    harness = createTestHarness({ adapterControls });
    harness.fetchRouter.onCoinGecko(STANDARD_PRICES);
    vi.stubGlobal("fetch", harness.fetchRouter.handler);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    harness.cleanup();
  });

  it("step 1: runs a DCA backtest", async () => {
    const skill = harness.skillRegistry.get("backtest")!;
    const ctx = { userId, walletAddress: null, chainIds: [1], sendReply: vi.fn() };

    const result = await skill.execute(
      { action: "run", strategy: "dca", token: "ETH", months: 3 },
      ctx,
    );

    // Backtest may succeed or fail based on data availability — should not throw
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("step 2: starts a DCA agent", async () => {
    const skill = harness.skillRegistry.get("agent")!;
    const result = await skill.execute(
      { action: "start", strategy: "dca", token: "ETH" },
      { userId, walletAddress: null, chainIds: [1], sendReply: vi.fn() },
    );

    expect(result.success).toBe(true);
    const match = result.message.match(/agent-[a-z0-9-]+/);
    expect(match).toBeTruthy();
    agentId = match![0];
  });

  it("step 3: checks agent status", async () => {
    const skill = harness.skillRegistry.get("agent")!;
    const result = await skill.execute(
      { action: "status", agentId },
      { userId, walletAddress: null, chainIds: [1], sendReply: vi.fn() },
    );

    expect(result.success).toBe(true);
  });

  it("step 4: stops agent", async () => {
    const skill = harness.skillRegistry.get("agent")!;
    const result = await skill.execute(
      { action: "stop", agentId },
      { userId, walletAddress: null, chainIds: [1], sendReply: vi.fn() },
    );

    expect(result.success).toBe(true);
  });
});
