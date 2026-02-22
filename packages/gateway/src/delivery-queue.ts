import type Database from "better-sqlite3";
import { getLogger } from "@chainclaw/core";
import { randomUUID } from "node:crypto";

const logger = getLogger("delivery-queue");

// ─── Types ──────────────────────────────────────────────────

export interface DeliveryPayload {
  channel: string;
  recipientId: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export type DeliveryStatus = "pending" | "dead";

interface DeliveryRow {
  id: string;
  channel: string;
  recipient_id: string;
  payload: string;
  retry_count: number;
  max_retries: number;
  last_error: string | null;
  next_retry_at: number;
  status: string;
  created_at: number;
}

export type DeliverFn = (payload: DeliveryPayload) => Promise<void>;

// ─── Backoff ────────────────────────────────────────────────

const BACKOFF_MS = [5_000, 25_000, 120_000, 600_000, 600_000];

function computeDeliveryBackoff(retryCount: number): number {
  return BACKOFF_MS[Math.min(retryCount, BACKOFF_MS.length - 1)] ?? 600_000;
}

// ─── Delivery Queue ─────────────────────────────────────────

export class DeliveryQueue {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS delivery_queue (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 5,
        last_error TEXT,
        next_retry_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_delivery_queue_status_next
      ON delivery_queue (status, next_retry_at)
    `);
  }

  /**
   * Enqueue a delivery for durable retry.
   */
  enqueue(payload: DeliveryPayload, maxRetries = 5): string {
    const id = randomUUID();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO delivery_queue (id, channel, recipient_id, payload, max_retries, next_retry_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, payload.channel, payload.recipientId, JSON.stringify(payload), maxRetries, now, now);

    logger.debug({ id, channel: payload.channel, recipientId: payload.recipientId }, "Delivery enqueued");
    return id;
  }

  /**
   * Acknowledge successful delivery — removes from queue.
   */
  ack(id: string): void {
    this.db.prepare("DELETE FROM delivery_queue WHERE id = ?").run(id);
    logger.debug({ id }, "Delivery acknowledged");
  }

  /**
   * Record a delivery failure. Increments retry count and computes next backoff.
   * If max retries exceeded, moves to "dead" status.
   */
  fail(id: string, error: string): void {
    const row = this.db.prepare("SELECT * FROM delivery_queue WHERE id = ?").get(id) as DeliveryRow | undefined;
    if (!row) return;

    const newRetryCount = row.retry_count + 1;

    if (newRetryCount >= row.max_retries) {
      this.db.prepare(
        "UPDATE delivery_queue SET status = 'dead', retry_count = ?, last_error = ? WHERE id = ?",
      ).run(newRetryCount, error, id);
      logger.warn({ id, retryCount: newRetryCount }, "Delivery moved to dead letter queue");
      return;
    }

    const backoff = computeDeliveryBackoff(newRetryCount);
    const nextRetryAt = Date.now() + backoff;

    this.db.prepare(
      "UPDATE delivery_queue SET retry_count = ?, last_error = ?, next_retry_at = ? WHERE id = ?",
    ).run(newRetryCount, error, nextRetryAt, id);

    logger.debug({ id, retryCount: newRetryCount, backoffMs: backoff }, "Delivery retry scheduled");
  }

  /**
   * Get count of pending deliveries.
   */
  pendingCount(): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM delivery_queue WHERE status = 'pending'",
    ).get() as { count: number };
    return row.count;
  }

  /**
   * Get count of dead deliveries.
   */
  deadCount(): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM delivery_queue WHERE status = 'dead'",
    ).get() as { count: number };
    return row.count;
  }

  /**
   * Recover all pending deliveries that are due for retry.
   * Called on startup to retry anything left from a previous session.
   *
   * @param deliverFn - Function to attempt delivery
   * @param opts - Recovery options
   * @returns Stats on recovery
   */
  async recoverPending(
    deliverFn: DeliverFn,
    opts?: { maxRecoveryMs?: number },
  ): Promise<{ recovered: number; failed: number; skipped: number }> {
    const maxRecoveryMs = opts?.maxRecoveryMs ?? 60_000;
    const deadline = Date.now() + maxRecoveryMs;
    let recovered = 0;
    let failed = 0;
    let skipped = 0;

    const rows = this.db.prepare(
      "SELECT * FROM delivery_queue WHERE status = 'pending' ORDER BY created_at ASC",
    ).all() as DeliveryRow[];

    for (const row of rows) {
      if (Date.now() >= deadline) {
        skipped += rows.length - recovered - failed - skipped;
        break;
      }

      // Wait for backoff if not yet due
      if (row.next_retry_at > Date.now()) {
        const waitMs = row.next_retry_at - Date.now();
        if (Date.now() + waitMs >= deadline) {
          skipped++;
          continue;
        }
        await new Promise((r) => setTimeout(r, waitMs));
      }

      try {
        const payload = JSON.parse(row.payload) as DeliveryPayload;
        await deliverFn(payload);
        this.ack(row.id);
        recovered++;
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        this.fail(row.id, error);
        failed++;
      }
    }

    if (recovered > 0 || failed > 0) {
      logger.info({ recovered, failed, skipped }, "Delivery queue recovery complete");
    }

    return { recovered, failed, skipped };
  }

  /**
   * Purge dead deliveries older than maxAgeMs.
   */
  purgeDead(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db.prepare(
      "DELETE FROM delivery_queue WHERE status = 'dead' AND created_at < ?",
    ).run(cutoff);
    return result.changes;
  }
}
