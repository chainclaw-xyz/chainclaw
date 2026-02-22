import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { CronService } from "../service.js";
import type { CronJob, JobExecutor } from "../types.js";

// Mock @chainclaw/core logger and hooks
vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  triggerHook: vi.fn(),
  createHookEvent: vi.fn(() => ({})),
}));

describe("CronService", () => {
  let db: Database.Database;
  let executedJobs: CronJob[];
  let executor: JobExecutor;
  let service: CronService;

  beforeEach(() => {
    db = new Database(":memory:");
    executedJobs = [];
    executor = vi.fn(async (job: CronJob) => {
      executedJobs.push(job);
      return { ok: true };
    }) as unknown as JobExecutor;
    service = new CronService(db, executor);
  });

  afterEach(() => {
    service.stop();
    db.close();
  });

  it("starts and stops without errors", () => {
    service.start();
    service.stop();
  });

  it("adds a job and persists it", () => {
    const job = service.add({
      name: "test-job",
      skillName: "balance",
      skillParams: { chain: "eth" },
      userId: "user1",
      schedule: { kind: "every", everyMs: 60_000 },
    });

    expect(job.id).toBeDefined();
    expect(job.name).toBe("test-job");
    expect(job.skillName).toBe("balance");
    expect(job.enabled).toBe(true);

    const retrieved = service.get(job.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe("test-job");
  });

  it("lists jobs", () => {
    service.add({
      name: "job-1",
      skillName: "balance",
      userId: "user1",
      schedule: { kind: "every", everyMs: 60_000 },
    });
    service.add({
      name: "job-2",
      skillName: "portfolio",
      userId: "user2",
      schedule: { kind: "every", everyMs: 120_000 },
    });

    expect(service.list()).toHaveLength(2);
    expect(service.listByUser("user1")).toHaveLength(1);
    expect(service.listByUser("user2")).toHaveLength(1);
    expect(service.listByUser("user3")).toHaveLength(0);
  });

  it("removes a job", () => {
    const job = service.add({
      name: "to-remove",
      skillName: "balance",
      userId: "user1",
      schedule: { kind: "every", everyMs: 60_000 },
    });

    expect(service.remove(job.id)).toBe(true);
    expect(service.get(job.id)).toBeUndefined();
    expect(service.remove("nonexistent")).toBe(false);
  });

  it("enables and disables a job", () => {
    const job = service.add({
      name: "toggle-job",
      skillName: "balance",
      userId: "user1",
      schedule: { kind: "every", everyMs: 60_000 },
    });

    service.setEnabled(job.id, false);
    expect(service.get(job.id)!.enabled).toBe(false);

    service.setEnabled(job.id, true);
    expect(service.get(job.id)!.enabled).toBe(true);
  });

  it("computes next run on add", () => {
    const job = service.add({
      name: "scheduled-job",
      skillName: "balance",
      userId: "user1",
      schedule: { kind: "every", everyMs: 60_000 },
    });

    const retrieved = service.get(job.id)!;
    expect(retrieved.state.nextRunAtMs).toBeDefined();
    expect(retrieved.state.nextRunAtMs!).toBeGreaterThan(Date.now() - 1000);
  });

  it("executes due jobs on timer tick", async () => {
    vi.useFakeTimers();
    try {
      const job = service.add({
        name: "due-job",
        skillName: "balance",
        userId: "user1",
        schedule: { kind: "every", everyMs: 5_000 },
      });

      // Set the job as due right now
      const retrieved = service.get(job.id)!;
      retrieved.state.nextRunAtMs = Date.now();
      service.getStore().updateState(job.id, retrieved.state);

      service.start();

      // Timer should fire quickly (it's clamped at max 60s)
      await vi.advanceTimersByTimeAsync(100);

      expect(executedJobs).toHaveLength(1);
      expect(executedJobs[0].name).toBe("due-job");

      // Check state was updated
      const after = service.get(job.id)!;
      expect(after.state.lastStatus).toBe("ok");
      expect(after.state.consecutiveErrors).toBe(0);
      expect(after.state.nextRunAtMs).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies error backoff on failure", async () => {
    vi.useFakeTimers();
    try {
      const failExecutor: JobExecutor = vi.fn(async () => ({
        ok: false,
        error: "simulated failure",
      })) as unknown as JobExecutor;

      const failService = new CronService(db, failExecutor);

      const job = failService.add({
        name: "failing-job",
        skillName: "balance",
        userId: "user1",
        schedule: { kind: "every", everyMs: 5_000 },
      });

      const retrieved = failService.get(job.id)!;
      retrieved.state.nextRunAtMs = Date.now();
      failService.getStore().updateState(job.id, retrieved.state);

      failService.start();
      await vi.advanceTimersByTimeAsync(100);

      const after = failService.get(job.id)!;
      expect(after.state.lastStatus).toBe("error");
      expect(after.state.consecutiveErrors).toBe(1);
      // Next run should be pushed back by at least 30s (first backoff)
      expect(after.state.nextRunAtMs!).toBeGreaterThan(Date.now() + 29_000);

      failService.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables one-shot jobs after completion", async () => {
    vi.useFakeTimers();
    try {
      const futureMs = Date.now() + 1000;
      const job = service.add({
        name: "one-shot",
        skillName: "balance",
        userId: "user1",
        schedule: { kind: "at", at: futureMs },
      });

      // Make it due now
      const retrieved = service.get(job.id)!;
      retrieved.state.nextRunAtMs = Date.now();
      service.getStore().updateState(job.id, retrieved.state);

      // Also hack the schedule to be in the past so it looks exhausted
      db.prepare("UPDATE cron_jobs SET schedule = ? WHERE id = ?")
        .run(JSON.stringify({ kind: "at", at: Date.now() - 10_000 }), job.id);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      const after = service.get(job.id)!;
      expect(after.enabled).toBe(false);
      expect(after.state.lastStatus).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
});
