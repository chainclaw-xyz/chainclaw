import { statSync } from "node:fs";
import { getLogger } from "./logger.js";
import { triggerHook, createHookEvent } from "./hooks.js";

const logger = getLogger("db-monitor");

const BYTES_PER_MB = 1024 * 1024;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const WARN_THRESHOLD = 0.8; // 80%

export interface DbMonitorOptions {
  maxSizeMb: number;
  pruneEnabled: boolean;
}

export interface SizeCheck {
  sizeMb: number;
  percentUsed: number;
  overThreshold: boolean;
}

export interface PruneResult {
  pruned: boolean;
  tablesAffected: string[];
  rowsDeleted: number;
  sizeBefore: number;
  sizeAfter: number;
}

/** Retention rules: table name → max age in days */
const RETENTION_RULES: Array<{ table: string; column: string; days: number; where?: string }> = [
  { table: "conversations", column: "created_at", days: 30 },
  { table: "tx_log", column: "created_at", days: 90 },
  { table: "risk_cache", column: "cached_at", days: 7 },
  { table: "reasoning_traces", column: "timestamp", days: 30 },
  { table: "historical_prices", column: "timestamp", days: 180 },
  { table: "delivery_queue", column: "created_at", days: 7, where: "status = 'dead'" },
];

/**
 * Monitors SQLite database size and prunes old data when thresholds are exceeded.
 * Designed for self-hosted deployments where users won't manually monitor disk.
 */
export class DbMonitor {
  private dbPath: string;
  private maxSizeMb: number;
  private pruneEnabled: boolean;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(dbPath: string, opts: DbMonitorOptions) {
    this.dbPath = dbPath;
    this.maxSizeMb = opts.maxSizeMb;
    this.pruneEnabled = opts.pruneEnabled;
  }

  checkSize(): SizeCheck {
    try {
      const bytes = statSync(this.dbPath).size;
      const sizeMb = bytes / BYTES_PER_MB;
      const percentUsed = (sizeMb / this.maxSizeMb) * 100;
      const overThreshold = sizeMb > this.maxSizeMb * WARN_THRESHOLD;

      if (overThreshold && sizeMb <= this.maxSizeMb) {
        logger.warn({ sizeMb: Math.round(sizeMb), maxSizeMb: this.maxSizeMb, percentUsed: Math.round(percentUsed) },
          "Database approaching size limit");
      } else if (sizeMb > this.maxSizeMb) {
        logger.warn({ sizeMb: Math.round(sizeMb), maxSizeMb: this.maxSizeMb },
          "Database exceeds size limit");
      }

      return { sizeMb, percentUsed, overThreshold };
    } catch {
      return { sizeMb: 0, percentUsed: 0, overThreshold: false };
    }
  }

  /**
   * Run pruning if the DB exceeds maxSizeMb and pruning is enabled.
   * Accepts any object with `exec` and `prepare` methods (better-sqlite3 Database interface).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pruneIfNeeded(db: { exec: (sql: string) => void; prepare: (sql: string) => { run: (...args: any[]) => { changes: number } } }): PruneResult {
    const sizeBefore = this.checkSize().sizeMb;

    if (!this.pruneEnabled || sizeBefore <= this.maxSizeMb) {
      return { pruned: false, tablesAffected: [], rowsDeleted: 0, sizeBefore, sizeAfter: sizeBefore };
    }

    logger.info({ sizeMb: Math.round(sizeBefore), maxSizeMb: this.maxSizeMb }, "Starting database pruning");

    let totalDeleted = 0;
    const affected: string[] = [];

    for (const rule of RETENTION_RULES) {
      try {
        const cutoff = new Date(Date.now() - rule.days * 24 * 60 * 60 * 1000).toISOString();
        const whereClause = rule.where
          ? `${rule.column} < ? AND ${rule.where}`
          : `${rule.column} < ?`;

        const stmt = db.prepare(`DELETE FROM ${rule.table} WHERE ${whereClause}`);
        const result = stmt.run(cutoff);
        if (result.changes > 0) {
          affected.push(rule.table);
          totalDeleted += result.changes;
          logger.info({ table: rule.table, deleted: result.changes, retentionDays: rule.days }, "Pruned table");
        }
      } catch {
        // Table may not exist yet — skip silently
      }
    }

    if (totalDeleted > 0) {
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        db.exec("VACUUM");
      } catch (err) {
        logger.warn({ err }, "Post-prune VACUUM failed");
      }
    }

    const sizeAfter = this.checkSize().sizeMb;

    const reclaimed = sizeBefore - sizeAfter;
    logger.info({ rowsDeleted: totalDeleted, reclaimedMb: Math.round(reclaimed), sizeAfterMb: Math.round(sizeAfter) },
      "Database pruning complete");

    void triggerHook(createHookEvent("diag", "db_pruned", {
      rowsDeleted: totalDeleted,
      tablesAffected: affected,
      reclaimedMb: reclaimed,
    }));

    return { pruned: true, tablesAffected: affected, rowsDeleted: totalDeleted, sizeBefore, sizeAfter };
  }

  /**
   * Start periodic size checks and auto-pruning.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  start(db: { exec: (sql: string) => void; prepare: (sql: string) => { run: (...args: any[]) => { changes: number } } }): void {
    this.interval = setInterval(() => {
      this.pruneIfNeeded(db);
    }, CHECK_INTERVAL_MS);
    logger.info({ maxSizeMb: this.maxSizeMb, pruneEnabled: this.pruneEnabled, intervalMs: CHECK_INTERVAL_MS }, "DB monitor started");
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
