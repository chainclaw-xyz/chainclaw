import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { createMockAdapterControls } from "../mocks/mock-chain-adapter.js";
import { STANDARD_PRICES } from "../mocks/canned-responses.js";

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

describe("Agent lifecycle integration", () => {
  let harness: TestHarness;

  beforeAll(() => {
    harness = createTestHarness({ adapterControls });

    harness.fetchRouter.onCoinGecko(STANDARD_PRICES);
    vi.stubGlobal("fetch", harness.fetchRouter.handler);
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", harness.fetchRouter.handler);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    harness.cleanup();
  });

  it("agent skill starts an agent and returns an ID", async () => {
    const skill = harness.skillRegistry.get("agent")!;
    const result = await skill.execute(
      { action: "start", strategy: "dca", token: "ETH" },
      { userId: "agent-user", walletAddress: null, chainIds: [1], sendReply: vi.fn() },
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("agent-");
  });

  it("agent skill lists running agents", async () => {
    const skill = harness.skillRegistry.get("agent")!;
    const result = await skill.execute(
      { action: "list" },
      { userId: "agent-user", walletAddress: null, chainIds: [1], sendReply: vi.fn() },
    );

    expect(result.success).toBe(true);
    // Should list at least the agent we just started
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("agent skill stops a running agent", async () => {
    // Start a new agent and stop it
    const skill = harness.skillRegistry.get("agent")!;
    const started = await skill.execute(
      { action: "start", strategy: "dca", token: "BTC" },
      { userId: "agent-user-2", walletAddress: null, chainIds: [1], sendReply: vi.fn() },
    );

    // Extract agent ID from message
    const idMatch = started.message.match(/agent-[a-z0-9-]+/);
    expect(idMatch).toBeTruthy();

    const stopped = await skill.execute(
      { action: "stop", agentId: idMatch![0] },
      { userId: "agent-user-2", walletAddress: null, chainIds: [1], sendReply: vi.fn() },
    );

    expect(stopped.success).toBe(true);
  });

});
