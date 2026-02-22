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

describe("Background services integration", () => {
  let harness: TestHarness;

  beforeAll(() => {
    harness = createTestHarness({ adapterControls });

    harness.fetchRouter.onCoinGecko(STANDARD_PRICES);
    vi.stubGlobal("fetch", harness.fetchRouter.handler);

    // Create a wallet
    harness.walletManager.generateWalletFromMnemonic("bg-wallet");
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", harness.fetchRouter.handler);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    harness.cleanup();
  });

  // ─── DCA Scheduler ─────────────────────────────────────────

  it("creates a DCA job and verifies it in SQLite", () => {
    const jobId = harness.dcaScheduler.createJob(
      "bg-user",
      "ETH",
      "USDC",
      "0.1",
      1,
      "daily",
      null,
      harness.walletManager.getDefaultAddress()!,
    );

    expect(jobId).toBeGreaterThan(0);

    const jobs = harness.dcaScheduler.getUserJobs("bg-user");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].from_token).toBe("ETH");
    expect(jobs[0].to_token).toBe("USDC");
    expect(jobs[0].status).toBe("active");
  });

  it("pauses and resumes a DCA job", () => {
    const jobs = harness.dcaScheduler.getUserJobs("bg-user");
    const jobId = jobs[0].id;

    harness.dcaScheduler.updateStatus(jobId, "bg-user", "paused");
    const paused = harness.dcaScheduler.getJob(jobId, "bg-user");
    expect(paused?.status).toBe("paused");

    harness.dcaScheduler.updateStatus(jobId, "bg-user", "active");
    const resumed = harness.dcaScheduler.getJob(jobId, "bg-user");
    expect(resumed?.status).toBe("active");
  });

  // ─── Alert Engine ──────────────────────────────────────────

  it("creates an alert and verifies it in SQLite", () => {
    const alertId = harness.alertEngine.createAlert(
      "bg-user",
      "price_below",
      "ETH",
      2000,
    );

    expect(alertId).toBeGreaterThan(0);

    const alerts = harness.alertEngine.getUserAlerts("bg-user");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].token).toBe("ETH");
    expect(alerts[0].threshold).toBe(2000);
    expect(alerts[0].status).toBe("active");
  });

  it("triggers alert when price crosses threshold", async () => {
    const notifier = vi.fn();
    harness.alertEngine.setNotifier(notifier);

    // Mock CoinGecko to return ETH at $1900 (below $2000 threshold)
    harness.fetchRouter.onCoinGecko({ ethereum: 1900 });

    // Call checkAlerts directly (don't use start/stop timers)
    await (harness.alertEngine as any).checkAlerts();

    expect(notifier).toHaveBeenCalledOnce();
    expect(notifier).toHaveBeenCalledWith(
      "bg-user",
      expect.stringContaining("Alert Triggered"),
    );

    // Verify status changed to triggered in DB
    const alerts = harness.db
      .prepare("SELECT * FROM alerts WHERE user_id = ? AND status = 'triggered'")
      .all("bg-user") as any[];
    expect(alerts).toHaveLength(1);
  });

  it("does not re-trigger already triggered alerts", async () => {
    const notifier = vi.fn();
    harness.alertEngine.setNotifier(notifier);

    await (harness.alertEngine as any).checkAlerts();

    // Should not call notifier again for already triggered alerts
    expect(notifier).not.toHaveBeenCalled();
  });
});
