import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { DeliveryQueue, type DeliveryPayload } from "../delivery-queue.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe("DeliveryQueue", () => {
  let db: Database.Database;
  let queue: DeliveryQueue;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    queue = new DeliveryQueue(db);
  });

  afterEach(() => {
    db.close();
  });

  const payload: DeliveryPayload = {
    channel: "telegram",
    recipientId: "user-123",
    message: "Your swap was confirmed!",
  };

  it("enqueues and acknowledges a delivery", () => {
    const id = queue.enqueue(payload);
    expect(queue.pendingCount()).toBe(1);

    queue.ack(id);
    expect(queue.pendingCount()).toBe(0);
  });

  it("increments retry count on failure", () => {
    const id = queue.enqueue(payload);
    queue.fail(id, "Connection refused");

    const row = db.prepare("SELECT * FROM delivery_queue WHERE id = ?").get(id) as {
      retry_count: number; last_error: string; status: string;
    };
    expect(row.retry_count).toBe(1);
    expect(row.last_error).toBe("Connection refused");
    expect(row.status).toBe("pending");
  });

  it("moves to dead after max retries", () => {
    const id = queue.enqueue(payload, 2); // max 2 retries
    queue.fail(id, "fail 1");
    queue.fail(id, "fail 2");

    expect(queue.pendingCount()).toBe(0);
    expect(queue.deadCount()).toBe(1);
  });

  it("recovers pending deliveries on startup", async () => {
    const deliverFn = vi.fn().mockResolvedValue(undefined);
    queue.enqueue(payload);
    queue.enqueue({ ...payload, message: "second" });

    const stats = await queue.recoverPending(deliverFn);
    expect(stats.recovered).toBe(2);
    expect(stats.failed).toBe(0);
    expect(deliverFn).toHaveBeenCalledTimes(2);
    expect(queue.pendingCount()).toBe(0);
  });

  it("handles delivery failure during recovery", async () => {
    const deliverFn = vi.fn().mockRejectedValue(new Error("network down"));
    queue.enqueue(payload);

    const stats = await queue.recoverPending(deliverFn);
    expect(stats.recovered).toBe(0);
    expect(stats.failed).toBe(1);
    // Still in queue with incremented retry
    expect(queue.pendingCount()).toBe(1);
  });

  it("respects recovery time budget", async () => {
    // Enqueue with far-future retry time
    const id = queue.enqueue(payload);
    db.prepare("UPDATE delivery_queue SET next_retry_at = ? WHERE id = ?")
      .run(Date.now() + 999_999, id);

    const deliverFn = vi.fn();
    const stats = await queue.recoverPending(deliverFn, { maxRecoveryMs: 100 });
    expect(stats.skipped).toBe(1);
    expect(deliverFn).not.toHaveBeenCalled();
  });

  it("purges old dead deliveries", () => {
    const id = queue.enqueue(payload, 1);
    queue.fail(id, "permanent failure");
    expect(queue.deadCount()).toBe(1);

    // Backdate the created_at
    db.prepare("UPDATE delivery_queue SET created_at = ? WHERE id = ?")
      .run(Date.now() - 100_000, id);

    const purged = queue.purgeDead(50_000);
    expect(purged).toBe(1);
    expect(queue.deadCount()).toBe(0);
  });

  it("handles multiple channels", () => {
    queue.enqueue({ channel: "telegram", recipientId: "u1", message: "a" });
    queue.enqueue({ channel: "discord", recipientId: "u2", message: "b" });
    queue.enqueue({ channel: "slack", recipientId: "u3", message: "c" });

    expect(queue.pendingCount()).toBe(3);
  });
});
