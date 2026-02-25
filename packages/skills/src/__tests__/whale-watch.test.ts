import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  fetchWithRetry: vi.fn(),
}));

vi.mock("../prices.js", () => ({
  getEthPriceUsd: vi.fn().mockResolvedValue(3000),
}));

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getBlock: vi.fn(),
    })),
  };
});

vi.mock("viem/chains", () => ({
  mainnet: { id: 1 },
  base: { id: 8453 },
  arbitrum: { id: 42161 },
  optimism: { id: 10 },
  polygon: { id: 137 },
  bsc: { id: 56 },
  avalanche: { id: 43114 },
  zkSync: { id: 324 },
  scroll: { id: 534352 },
  blast: { id: 81457 },
  gnosis: { id: 100 },
  linea: { id: 59144 },
  fantom: { id: 250 },
  mantle: { id: 5000 },
}));

import { fetchWithRetry } from "@chainclaw/core";
import { WhaleWatchEngine, createWhaleWatchSkill, FlowTracker } from "../whale-watch.js";

const mockFetch = vi.mocked(fetchWithRetry);

function makeContext(userId = "user1") {
  return {
    userId,
    walletAddress: "0xmywallet1234567890abcdef1234567890abcdef",
    chainIds: [1],
    sendReply: vi.fn(),
    requestConfirmation: vi.fn(),
  };
}

const mockRiskEngine = {
  analyzeToken: vi.fn().mockResolvedValue({
    isHoneypot: false,
    riskLevel: "low",
    dimensions: [],
  }),
};

const mockExecutor = {
  execute: vi.fn().mockResolvedValue({ success: true, hash: "0xcopyhash" }),
};

const mockWalletManager = {
  getDefaultAddress: vi.fn().mockReturnValue("0xmywallet1234567890abcdef1234567890abcdef"),
  getSigner: vi.fn().mockReturnValue({ address: "0xmywallet" }),
};

describe("WhaleWatchEngine", () => {
  let db: Database.Database;
  let engine: WhaleWatchEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database(":memory:");
    engine = new WhaleWatchEngine(db, undefined, {
      executor: mockExecutor as any,
      walletManager: mockWalletManager as any,
      riskEngine: mockRiskEngine as any,
      oneInchApiKey: "test-key",
    });
  });

  describe("backward compatibility", () => {
    it("works without deps argument", () => {
      const eng = new WhaleWatchEngine(db);
      expect(eng).toBeDefined();
    });

    it("works with rpcOverrides only", () => {
      const eng = new WhaleWatchEngine(db, { 1: "https://rpc.example.com" });
      expect(eng).toBeDefined();
    });
  });

  describe("createWatch / getUserWatches / deleteWatch", () => {
    it("creates and lists watches", () => {
      const id = engine.createWatch("user1", "0xAbC1234567890abcdef1234567890abcdef12345678", "vitalik", 50000, 1);
      expect(id).toBeGreaterThan(0);

      const watches = engine.getUserWatches("user1");
      expect(watches).toHaveLength(1);
      expect(watches[0].label).toBe("vitalik");
      expect(watches[0].auto_copy).toBe(0);
    });

    it("deletes a watch", () => {
      const id = engine.createWatch("user1", "0xAbC1234567890abcdef1234567890abcdef12345678", null, 10000, 1);
      expect(engine.deleteWatch(id, "user1")).toBe(true);
      expect(engine.getUserWatches("user1")).toHaveLength(0);
    });

    it("won't delete another user's watch", () => {
      const id = engine.createWatch("user1", "0xAbC1234567890abcdef1234567890abcdef12345678", null, 10000, 1);
      expect(engine.deleteWatch(id, "user2")).toBe(false);
    });
  });

  describe("enableCopy / disableCopy", () => {
    it("enableCopy stores params correctly", () => {
      const id = engine.createWatch("user1", "0xAbC1234567890abcdef1234567890abcdef12345678", "whale1", 10000, 1);
      const ok = engine.enableCopy(id, "user1", "0.1", 3);
      expect(ok).toBe(true);

      const watches = engine.getUserWatches("user1");
      expect(watches[0].auto_copy).toBe(1);
      expect(watches[0].copy_amount).toBe("0.1");
      expect(watches[0].copy_max_daily).toBe(3);
    });

    it("disableCopy clears auto_copy flag and resets count", () => {
      const id = engine.createWatch("user1", "0xAbC1234567890abcdef1234567890abcdef12345678", null, 10000, 1);
      engine.enableCopy(id, "user1", "0.5", 5);

      const ok = engine.disableCopy(id, "user1");
      expect(ok).toBe(true);

      const watches = engine.getUserWatches("user1");
      expect(watches[0].auto_copy).toBe(0);
      expect(watches[0].copy_amount).toBeNull();
      expect(watches[0].copy_today_count).toBe(0);
    });

    it("enableCopy returns false for non-existent watch", () => {
      expect(engine.enableCopy(999, "user1", "0.1", 5)).toBe(false);
    });

    it("enableCopy returns false for wrong user", () => {
      const id = engine.createWatch("user1", "0xAbC1234567890abcdef1234567890abcdef12345678", null, 10000, 1);
      expect(engine.enableCopy(id, "user2", "0.1", 5)).toBe(false);
    });
  });

  describe("daily copy limit", () => {
    it("daily count resets at new UTC day", () => {
      const id = engine.createWatch("user1", "0xAbC1234567890abcdef1234567890abcdef12345678", null, 10000, 1);
      engine.enableCopy(id, "user1", "0.1", 5);

      // Simulate yesterday's date in copy_today_reset
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      db.prepare("UPDATE whale_watches SET copy_today_count = 3, copy_today_reset = ? WHERE id = ?")
        .run(yesterday, id);

      // Access private method via prototype — call resetDailyCountIfNeeded
      (engine as any).resetDailyCountIfNeeded(id);

      const row = db.prepare("SELECT copy_today_count, copy_today_reset FROM whale_watches WHERE id = ?").get(id) as any;
      expect(row.copy_today_count).toBe(0);
      const today = new Date().toISOString().slice(0, 10);
      expect(row.copy_today_reset).toBe(today);
    });

    it("daily count does NOT reset if same day", () => {
      const id = engine.createWatch("user1", "0xAbC1234567890abcdef1234567890abcdef12345678", null, 10000, 1);
      engine.enableCopy(id, "user1", "0.1", 5);

      const today = new Date().toISOString().slice(0, 10);
      db.prepare("UPDATE whale_watches SET copy_today_count = 3, copy_today_reset = ? WHERE id = ?")
        .run(today, id);

      (engine as any).resetDailyCountIfNeeded(id);

      const row = db.prepare("SELECT copy_today_count FROM whale_watches WHERE id = ?").get(id) as any;
      expect(row.copy_today_count).toBe(3);
    });
  });

  describe("claimCopySlot", () => {
    it("atomically claims a slot and returns true", () => {
      const id = engine.createWatch("user1", "0xAbC1234567890abcdef1234567890abcdef12345678", null, 10000, 1);
      engine.enableCopy(id, "user1", "0.1", 3);

      expect((engine as any).claimCopySlot(id)).toBe(true);

      const row = db.prepare("SELECT copy_today_count FROM whale_watches WHERE id = ?").get(id) as any;
      expect(row.copy_today_count).toBe(1);
    });

    it("returns false when daily limit reached", () => {
      const id = engine.createWatch("user1", "0xAbC1234567890abcdef1234567890abcdef12345678", null, 10000, 1);
      engine.enableCopy(id, "user1", "0.1", 2);

      expect((engine as any).claimCopySlot(id)).toBe(true); // 0 → 1
      expect((engine as any).claimCopySlot(id)).toBe(true); // 1 → 2
      expect((engine as any).claimCopySlot(id)).toBe(false); // 2 >= 2, blocked
    });
  });

  describe("executeCopyTrade", () => {
    it("blocks honeypot tokens", async () => {
      const id = engine.createWatch("user1", "0xAbC1234567890abcdef1234567890abcdef12345678", null, 10000, 1);
      engine.enableCopy(id, "user1", "0.1", 5);
      const watch = engine.getUserWatches("user1")[0];

      const notifier = vi.fn();
      engine.setNotifier(notifier);

      mockRiskEngine.analyzeToken.mockResolvedValueOnce({
        isHoneypot: true,
        riskLevel: "critical",
        dimensions: [],
      });

      await (engine as any).executeCopyTrade(watch, "0xbadtoken1234567890abcdef1234567890abcdef" as any, 1);

      expect(mockExecutor.execute).not.toHaveBeenCalled();
      expect(notifier).toHaveBeenCalledWith("user1", expect.stringContaining("Copy-Trade Blocked"));
    });

    it("executes swap when risk check passes", async () => {
      const id = engine.createWatch("user1", "0xAbC1234567890abcdef1234567890abcdef12345678", null, 10000, 1);
      engine.enableCopy(id, "user1", "0.1", 5);
      const watch = engine.getUserWatches("user1")[0];

      const notifier = vi.fn();
      engine.setNotifier(notifier);

      mockRiskEngine.analyzeToken.mockResolvedValueOnce({
        isHoneypot: false,
        riskLevel: "low",
        dimensions: [],
      });

      // Mock 1inch API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tx: {
            to: "0x1inch-router",
            data: "0xcalldata",
            value: "100000000000000000",
            gas: 200000,
          },
        }),
      } as any);

      await (engine as any).executeCopyTrade(watch, "0xgoodtoken234567890abcdef1234567890abcdef" as any, 1);

      expect(mockExecutor.execute).toHaveBeenCalledOnce();
      expect(notifier).toHaveBeenCalledWith("user1", expect.stringContaining("Copy-Trade Executed"));
    });

    it("skips execution when no deps", async () => {
      const noDepsEngine = new WhaleWatchEngine(db);
      const id = noDepsEngine.createWatch("user1", "0xAbC1234567890abcdef1234567890abcdef12345678", null, 10000, 1);
      noDepsEngine.enableCopy(id, "user1", "0.1", 5);
      const watch = noDepsEngine.getUserWatches("user1")[0];

      await (noDepsEngine as any).executeCopyTrade(watch, "0xtoken1234567890abcdef1234567890abcdef12" as any, 1);

      expect(mockExecutor.execute).not.toHaveBeenCalled();
    });

    it("skips when no 1inch API key", async () => {
      const noKeyEngine = new WhaleWatchEngine(db, undefined, {
        executor: mockExecutor as any,
        walletManager: mockWalletManager as any,
        riskEngine: mockRiskEngine as any,
      });
      const id = noKeyEngine.createWatch("user1", "0xAbC1234567890abcdef1234567890abcdef12345678", null, 10000, 1);
      noKeyEngine.enableCopy(id, "user1", "0.1", 5);
      const watch = noKeyEngine.getUserWatches("user1")[0];

      const notifier = vi.fn();
      noKeyEngine.setNotifier(notifier);

      await (noKeyEngine as any).executeCopyTrade(watch, "0xgoodtoken234567890abcdef1234567890abcdef" as any, 1);

      expect(mockExecutor.execute).not.toHaveBeenCalled();
      expect(notifier).toHaveBeenCalledWith("user1", expect.stringContaining("Copy-Trade Skipped"));
    });

    it("blocks critical risk tokens", async () => {
      const id = engine.createWatch("user1", "0xAbC1234567890abcdef1234567890abcdef12345678", null, 10000, 1);
      engine.enableCopy(id, "user1", "0.1", 5);
      const watch = engine.getUserWatches("user1")[0];

      const notifier = vi.fn();
      engine.setNotifier(notifier);

      mockRiskEngine.analyzeToken.mockResolvedValueOnce({
        isHoneypot: false,
        riskLevel: "critical",
        dimensions: [],
      });

      await (engine as any).executeCopyTrade(watch, "0xriskytoken34567890abcdef1234567890abcdef" as any, 1);

      expect(mockExecutor.execute).not.toHaveBeenCalled();
      expect(notifier).toHaveBeenCalledWith("user1", expect.stringContaining("Copy-Trade Blocked"));
    });
  });
});

describe("createWhaleWatchSkill", () => {
  let db: Database.Database;
  let engine: WhaleWatchEngine;
  let skill: ReturnType<typeof createWhaleWatchSkill>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database(":memory:");
    engine = new WhaleWatchEngine(db);
    skill = createWhaleWatchSkill(engine);
  });

  it("watch creates an alert", async () => {
    const result = await skill.execute(
      { action: "watch", address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", label: "vitalik", minValueUsd: 50000, chainId: 1 },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain("Whale Watch #");
    expect(result.message).toContain("vitalik");
  });

  it("watch rejects invalid address", async () => {
    const result = await skill.execute(
      { action: "watch", address: "not-an-address" },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid wallet address");
  });

  it("list returns empty message when no watches", async () => {
    const result = await skill.execute({ action: "list" }, makeContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("No active whale watches");
  });

  it("list shows watches with copy status", async () => {
    engine.createWatch("user1", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "whale", 10000, 1);
    const watches = engine.getUserWatches("user1");
    engine.enableCopy(watches[0].id, "user1", "0.1", 3);

    const result = await skill.execute({ action: "list" }, makeContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("Copy: ON 0.1 ETH");
    expect(result.message).toContain("0/3 daily");
  });

  it("remove deletes a watch", async () => {
    engine.createWatch("user1", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", null, 10000, 1);
    const watches = engine.getUserWatches("user1");

    const result = await skill.execute({ action: "remove", watchId: watches[0].id }, makeContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain("removed");
    expect(engine.getUserWatches("user1")).toHaveLength(0);
  });

  describe("copy action", () => {
    it("enables copy-trading on a watch", async () => {
      engine.createWatch("user1", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "whale", 10000, 1);
      const watches = engine.getUserWatches("user1");

      const result = await skill.execute(
        { action: "copy", watchId: watches[0].id, copyAmount: "0.1", copyMaxDaily: 3 },
        makeContext(),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain("Copy-Trading Enabled");
      expect(result.message).toContain("0.1 ETH");
      expect(result.message).toContain("3 trades");
    });

    it("requires watchId", async () => {
      const result = await skill.execute(
        { action: "copy", copyAmount: "0.1" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain("watch ID");
    });

    it("requires copyAmount", async () => {
      engine.createWatch("user1", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", null, 10000, 1);
      const watches = engine.getUserWatches("user1");

      const result = await skill.execute(
        { action: "copy", watchId: watches[0].id },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain("copy amount");
    });
  });

  describe("uncopy action", () => {
    it("disables copy-trading on a watch", async () => {
      engine.createWatch("user1", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", null, 10000, 1);
      const watches = engine.getUserWatches("user1");
      engine.enableCopy(watches[0].id, "user1", "0.1", 5);

      const result = await skill.execute(
        { action: "uncopy", watchId: watches[0].id },
        makeContext(),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain("disabled");

      const updated = engine.getUserWatches("user1");
      expect(updated[0].auto_copy).toBe(0);
    });

    it("requires watchId", async () => {
      const result = await skill.execute(
        { action: "uncopy" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain("watch ID");
    });
  });
});

describe("FlowTracker", () => {
  it("records and summarizes flows", () => {
    const tracker = new FlowTracker();
    tracker.record("0xABC", 10, "in");
    tracker.record("0xABC", 5, "out");

    const summary = tracker.getSummary("0xABC");
    expect(summary).toContain("accumulating");
  });

  it("returns null summary for unknown address", () => {
    const tracker = new FlowTracker();
    expect(tracker.getSummary("0xunknown")).toBeNull();
  });
});
