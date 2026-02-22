/**
 * CronService — manages scheduled job execution.
 * Uses clamped setTimeout (max 60s) to prevent drift.
 * Emits lifecycle hooks, supports error backoff.
 */
import { getLogger, triggerHook, createHookEvent } from "@chainclaw/core";
import type { CronJob, CronJobCreate, JobExecutor } from "./types.js";
import { CronStore } from "./store.js";
import { computeNextRunAtMs } from "./schedule.js";
import type Database from "better-sqlite3";

const logger = getLogger("cron");

const MAX_TIMER_DELAY_MS = 60_000;

const ERROR_BACKOFF_MS = [
  30_000,       // 1st error → 30s
  60_000,       // 2nd error → 1m
  5 * 60_000,   // 3rd error → 5m
  15 * 60_000,  // 4th error → 15m
  60 * 60_000,  // 5th+ error → 60m
];

function errorBackoffMs(consecutiveErrors: number): number {
  const idx = Math.min(consecutiveErrors - 1, ERROR_BACKOFF_MS.length - 1);
  return ERROR_BACKOFF_MS[Math.max(0, idx)];
}

export class CronService {
  private store: CronStore;
  private executor: JobExecutor;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = true;

  constructor(db: Database.Database, executor: JobExecutor) {
    this.store = new CronStore(db);
    this.executor = executor;
  }

  /** Start the cron service. Computes next runs and arms the timer. */
  start(): void {
    this.stopped = false;
    logger.info("Cron service starting");

    // Compute next runs for all enabled jobs that don't have one
    const jobs = this.store.listEnabled();
    const now = Date.now();
    for (const job of jobs) {
      if (job.state.nextRunAtMs === undefined) {
        const next = computeNextRunAtMs(job.schedule, now);
        if (next !== undefined) {
          job.state.nextRunAtMs = next;
          this.store.updateState(job.id, job.state);
        }
      }
    }

    this.armTimer();
    logger.info({ jobCount: jobs.length }, "Cron service started");
  }

  /** Stop the cron service. */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info("Cron service stopped");
  }

  /** Add a new job. */
  add(input: CronJobCreate): CronJob {
    const job = this.store.create(input);
    const now = Date.now();
    const next = computeNextRunAtMs(job.schedule, now);
    if (next !== undefined) {
      job.state.nextRunAtMs = next;
      this.store.updateState(job.id, job.state);
    }
    logger.info({ jobId: job.id, name: job.name, nextRunAtMs: next }, "Job added");
    this.armTimer();
    return job;
  }

  /** Remove a job by ID. */
  remove(id: string): boolean {
    const result = this.store.remove(id);
    if (result) {
      logger.info({ jobId: id }, "Job removed");
    }
    return result;
  }

  /** Enable or disable a job. */
  setEnabled(id: string, enabled: boolean): void {
    this.store.setEnabled(id, enabled);
    if (enabled) {
      const job = this.store.get(id);
      if (job && job.state.nextRunAtMs === undefined) {
        const next = computeNextRunAtMs(job.schedule, Date.now());
        if (next !== undefined) {
          job.state.nextRunAtMs = next;
          this.store.updateState(job.id, job.state);
        }
      }
      this.armTimer();
    }
  }

  /** List all jobs. */
  list(): CronJob[] {
    return this.store.listAll();
  }

  /** List jobs for a specific user. */
  listByUser(userId: string): CronJob[] {
    return this.store.listByUser(userId);
  }

  /** Get a single job by ID. */
  get(id: string): CronJob | undefined {
    return this.store.get(id);
  }

  /** Get the underlying store (for advanced operations). */
  getStore(): CronStore {
    return this.store;
  }

  // ─── Timer management ──────────────────────────────────────

  private armTimer(): void {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const nextAt = this.findNextWakeMs();
    if (nextAt === undefined) return;

    const now = Date.now();
    const delay = Math.max(nextAt - now, 0);
    const clampedDelay = Math.min(delay, MAX_TIMER_DELAY_MS);

    this.timer = setTimeout(() => {
      void this.onTimer();
    }, clampedDelay);
  }

  private findNextWakeMs(): number | undefined {
    const jobs = this.store.listEnabled();
    let earliest: number | undefined;
    for (const job of jobs) {
      if (job.state.nextRunAtMs !== undefined) {
        if (earliest === undefined || job.state.nextRunAtMs < earliest) {
          earliest = job.state.nextRunAtMs;
        }
      }
    }
    return earliest;
  }

  private async onTimer(): Promise<void> {
    if (this.stopped) return;

    // Guard against concurrent execution
    if (this.running) {
      this.timer = setTimeout(() => {
        void this.onTimer();
      }, MAX_TIMER_DELAY_MS);
      return;
    }

    this.running = true;
    try {
      const now = Date.now();
      const jobs = this.store.listEnabled();
      const dueJobs = jobs.filter(
        (j) => j.state.nextRunAtMs !== undefined && j.state.nextRunAtMs <= now,
      );

      for (const job of dueJobs) {
        await this.executeJob(job);
      }
    } catch (err) {
      logger.error({ err }, "Cron timer error");
    } finally {
      this.running = false;
      this.armTimer();
    }
  }

  private async executeJob(job: CronJob): Promise<void> {
    const startMs = Date.now();
    logger.info({ jobId: job.id, name: job.name }, "Executing cron job");

    void triggerHook(createHookEvent("cron", "job_started", {
      jobId: job.id,
      name: job.name,
      userId: job.userId,
    }));

    try {
      const result = await this.executor(job);
      const durationMs = Date.now() - startMs;

      if (result.ok) {
        job.state.lastStatus = "ok";
        job.state.lastError = undefined;
        job.state.consecutiveErrors = 0;
        logger.info({ jobId: job.id, durationMs }, "Job completed successfully");
      } else {
        job.state.lastStatus = "error";
        job.state.lastError = result.error;
        job.state.consecutiveErrors++;
        logger.warn({ jobId: job.id, error: result.error, durationMs }, "Job failed");
      }

      job.state.lastRunAtMs = startMs;
      job.state.lastDurationMs = durationMs;

      // Compute next run
      const normalNext = computeNextRunAtMs(job.schedule, startMs);

      if (normalNext === undefined) {
        // One-shot job (schedule exhausted) — disable it
        job.state.nextRunAtMs = undefined;
        this.store.updateState(job.id, job.state);
        this.store.setEnabled(job.id, false);
        logger.info({ jobId: job.id }, "One-shot job completed, disabled");
      } else if (!result.ok) {
        // Apply error backoff
        const backoff = errorBackoffMs(job.state.consecutiveErrors);
        job.state.nextRunAtMs = Math.max(normalNext, Date.now() + backoff);
        this.store.updateState(job.id, job.state);
      } else {
        job.state.nextRunAtMs = normalNext;
        this.store.updateState(job.id, job.state);
      }

      void triggerHook(createHookEvent("cron", "job_finished", {
        jobId: job.id,
        name: job.name,
        userId: job.userId,
        status: job.state.lastStatus,
        durationMs,
      }));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      job.state.lastStatus = "error";
      job.state.lastError = errorMsg;
      job.state.consecutiveErrors++;
      job.state.lastRunAtMs = startMs;
      job.state.lastDurationMs = Date.now() - startMs;

      // Apply backoff
      const normalNext = computeNextRunAtMs(job.schedule, startMs);
      const backoff = errorBackoffMs(job.state.consecutiveErrors);
      job.state.nextRunAtMs = normalNext !== undefined
        ? Math.max(normalNext, Date.now() + backoff)
        : Date.now() + backoff;

      this.store.updateState(job.id, job.state);
      logger.error({ jobId: job.id, err }, "Job execution threw");

      void triggerHook(createHookEvent("cron", "job_finished", {
        jobId: job.id,
        name: job.name,
        userId: job.userId,
        status: "error",
        error: errorMsg,
      }));
    }
  }
}
