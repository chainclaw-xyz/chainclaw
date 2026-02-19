import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { DcaScheduler } from "../dca.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../prices.js", () => ({
  getEthPriceUsd: vi.fn(async () => 3000),
}));

describe("DcaScheduler", () => {
  let db: Database.Database;
  let mockExecutor: any;
  let mockWalletManager: any;
  let scheduler: DcaScheduler;

  beforeEach(() => {
    db = new Database(":memory:");
    mockExecutor = {
      execute: vi.fn(async () => ({ success: true, message: "ok" })),
    };
    mockWalletManager = {
      getSigner: vi.fn(() => ({ address: "0xABC" })),
    };
    scheduler = new DcaScheduler(db, mockExecutor, mockWalletManager, "test-api-key");
  });

  afterEach(() => {
    scheduler.stop();
    db.close();
  });

  it("creates dca_jobs table on construction", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dca_jobs'").all();
    expect(tables).toHaveLength(1);
  });

  it("createJob inserts a job and returns ID", () => {
    const id = scheduler.createJob("user-1", "USDC", "ETH", "100", 1, "weekly", null, "0xABC");
    expect(id).toBeGreaterThan(0);
    const job = scheduler.getJob(id, "user-1");
    expect(job).not.toBeNull();
    expect(job!.from_token).toBe("USDC");
    expect(job!.to_token).toBe("ETH");
    expect(job!.amount).toBe("100");
    expect(job!.status).toBe("active");
  });

  it("getUserJobs returns jobs for a user", () => {
    scheduler.createJob("user-1", "USDC", "ETH", "100", 1, "weekly", null, "0xABC");
    scheduler.createJob("user-1", "USDC", "BTC", "50", 1, "daily", null, "0xABC");
    scheduler.createJob("user-2", "USDC", "ETH", "200", 1, "weekly", null, "0xDEF");
    const jobs = scheduler.getUserJobs("user-1");
    expect(jobs).toHaveLength(2);
  });

  it("updateStatus changes job status", () => {
    const id = scheduler.createJob("user-1", "USDC", "ETH", "100", 1, "weekly", null, "0xABC");
    const updated = scheduler.updateStatus(id, "user-1", "paused");
    expect(updated).toBe(true);
    const job = scheduler.getJob(id, "user-1");
    expect(job!.status).toBe("paused");
  });

  it("getJob returns null for wrong user", () => {
    const id = scheduler.createJob("user-1", "USDC", "ETH", "100", 1, "weekly", null, "0xABC");
    const job = scheduler.getJob(id, "user-2");
    expect(job).toBeFalsy();
  });

  it("updateStatus returns false for non-existent job", () => {
    const updated = scheduler.updateStatus(999, "user-1", "paused");
    expect(updated).toBe(false);
  });

  it("throws for invalid frequency", () => {
    expect(() => {
      scheduler.createJob("user-1", "USDC", "ETH", "100", 1, "biweekly" as any, null, "0xABC");
    }).toThrow("Invalid frequency");
  });

  it("getUserJobs excludes cancelled jobs", () => {
    const id = scheduler.createJob("user-1", "USDC", "ETH", "100", 1, "weekly", null, "0xABC");
    scheduler.updateStatus(id, "user-1", "cancelled");
    const jobs = scheduler.getUserJobs("user-1");
    expect(jobs).toHaveLength(0);
  });
});
