/**
 * SQLite-backed job storage for the cron system.
 * Follows ChainClaw's better-sqlite3 pattern.
 */
import type Database from "better-sqlite3";
import type { CronJob, CronJobCreate, CronJobState, CronSchedule } from "./types.js";
import { randomUUID } from "node:crypto";

const MIGRATION = `
  CREATE TABLE IF NOT EXISTS cron_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    skill_params TEXT NOT NULL DEFAULT '{}',
    user_id TEXT NOT NULL,
    chain_id INTEGER,
    schedule TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_user ON cron_jobs(user_id);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);
`;

export class CronStore {
  constructor(private db: Database.Database) {
    this.db.exec(MIGRATION);
  }

  create(input: CronJobCreate): CronJob {
    const id = randomUUID();
    const now = Date.now();
    const state: CronJobState = { consecutiveErrors: 0 };

    this.db.prepare(`
      INSERT INTO cron_jobs (id, name, skill_name, skill_params, user_id, chain_id, schedule, enabled, state, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      input.name,
      input.skillName,
      JSON.stringify(input.skillParams ?? {}),
      input.userId,
      input.chainId ?? null,
      JSON.stringify(input.schedule),
      JSON.stringify(state),
      now,
    );

    return {
      id,
      name: input.name,
      skillName: input.skillName,
      skillParams: input.skillParams ?? {},
      userId: input.userId,
      chainId: input.chainId,
      schedule: input.schedule,
      enabled: true,
      state,
      createdAt: now,
    };
  }

  get(id: string): CronJob | undefined {
    const row = this.db.prepare("SELECT * FROM cron_jobs WHERE id = ?").get(id) as CronJobRow | undefined;
    return row ? this.rowToJob(row) : undefined;
  }

  listAll(): CronJob[] {
    const rows = this.db.prepare("SELECT * FROM cron_jobs ORDER BY created_at").all() as CronJobRow[];
    return rows.map((r) => this.rowToJob(r));
  }

  listEnabled(): CronJob[] {
    const rows = this.db.prepare("SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY created_at").all() as CronJobRow[];
    return rows.map((r) => this.rowToJob(r));
  }

  listByUser(userId: string): CronJob[] {
    const rows = this.db.prepare("SELECT * FROM cron_jobs WHERE user_id = ? ORDER BY created_at").all(userId) as CronJobRow[];
    return rows.map((r) => this.rowToJob(r));
  }

  updateState(id: string, state: CronJobState): void {
    this.db.prepare("UPDATE cron_jobs SET state = ? WHERE id = ?")
      .run(JSON.stringify(state), id);
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db.prepare("UPDATE cron_jobs SET enabled = ? WHERE id = ?")
      .run(enabled ? 1 : 0, id);
  }

  remove(id: string): boolean {
    const result = this.db.prepare("DELETE FROM cron_jobs WHERE id = ?").run(id);
    return result.changes > 0;
  }

  private rowToJob(row: CronJobRow): CronJob {
    return {
      id: row.id,
      name: row.name,
      skillName: row.skill_name,
      skillParams: JSON.parse(row.skill_params) as Record<string, unknown>,
      userId: row.user_id,
      chainId: row.chain_id ?? undefined,
      schedule: JSON.parse(row.schedule) as CronSchedule,
      enabled: row.enabled === 1,
      state: JSON.parse(row.state) as CronJobState,
      createdAt: row.created_at,
    };
  }
}

interface CronJobRow {
  id: string;
  name: string;
  skill_name: string;
  skill_params: string;
  user_id: string;
  chain_id: number | null;
  schedule: string;
  enabled: number;
  state: string;
  created_at: number;
}
