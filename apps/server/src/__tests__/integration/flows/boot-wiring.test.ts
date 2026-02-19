import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createMockAdapterControls } from "../mocks/mock-chain-adapter.js";

// ─── Module mocks (must be before imports) ─────────────────
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

describe("Boot and wiring", () => {
  let harness: TestHarness;

  beforeAll(() => {
    harness = createTestHarness({ adapterControls });
  });

  afterAll(() => {
    harness.cleanup();
  });

  it("registers all 13 skills in the registry", () => {
    const skills = harness.skillRegistry.list();
    expect(skills.length).toBe(13);

    const names = skills.map((s) => s.name);
    expect(names).toContain("balance");
    expect(names).toContain("swap");
    expect(names).toContain("bridge");
    expect(names).toContain("lend");
    expect(names).toContain("dca");
    expect(names).toContain("alert");
    expect(names).toContain("workflow");
    expect(names).toContain("portfolio");
    expect(names).toContain("risk_check");
    expect(names).toContain("history");
    expect(names).toContain("backtest");
    expect(names).toContain("agent");
    expect(names).toContain("marketplace");
  });

  it("creates database with required tables", () => {
    const tables = harness.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const names = tables.map((t) => t.name);
    expect(names).toContain("conversations");
    expect(names).toContain("user_preferences");
    expect(names).toContain("tx_log");
    expect(names).toContain("alerts");
    expect(names).toContain("dca_jobs");
  });

  it("wallet manager starts with no wallets", () => {
    expect(harness.walletManager.listWallets()).toHaveLength(0);
    expect(harness.walletManager.getDefaultAddress()).toBeNull();
  });

  it("chain manager reports 4 supported chains", () => {
    const chains = harness.chainManager.getSupportedChains();
    expect(chains).toContain(1);
    expect(chains).toContain(8453);
    expect(chains).toContain(42161);
    expect(chains).toContain(10);
    expect(chains.length).toBe(4);
  });
});
