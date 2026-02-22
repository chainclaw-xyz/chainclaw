/**
 * Cron schedule types.
 * Ported from OpenClaw's schedule model with DeFi-relevant defaults.
 */

/** One-shot at a fixed time */
export interface AtSchedule {
  kind: "at";
  /** ISO 8601 datetime or epoch ms */
  at: string | number;
}

/** Recurring interval with optional anchor alignment */
export interface EverySchedule {
  kind: "every";
  /** Interval in milliseconds */
  everyMs: number;
  /** Anchor timestamp (ms) to align intervals to. Defaults to job creation time. */
  anchorMs?: number;
}

/** Cron expression with optional timezone */
export interface CronExprSchedule {
  kind: "cron";
  /** Standard cron expression (5 or 6 fields) */
  expr: string;
  /** IANA timezone, defaults to UTC */
  tz?: string;
}

export type CronSchedule = AtSchedule | EverySchedule | CronExprSchedule;

export interface CronJob {
  id: string;
  /** Name for logging/display */
  name: string;
  /** The skill to invoke when this job fires */
  skillName: string;
  /** Parameters to pass to the skill */
  skillParams: Record<string, unknown>;
  /** User who owns this job */
  userId: string;
  /** Chain ID (for DeFi context) */
  chainId?: number;
  /** Schedule definition */
  schedule: CronSchedule;
  /** Whether the job is enabled */
  enabled: boolean;
  /** Runtime state */
  state: CronJobState;
  /** Timestamp when the job was created (epoch ms) */
  createdAt: number;
}

export interface CronJobState {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  lastDurationMs?: number;
  consecutiveErrors: number;
}

export interface CronJobCreate {
  name: string;
  skillName: string;
  skillParams?: Record<string, unknown>;
  userId: string;
  chainId?: number;
  schedule: CronSchedule;
}

export type JobExecutor = (job: CronJob) => Promise<{ ok: boolean; error?: string }>;
