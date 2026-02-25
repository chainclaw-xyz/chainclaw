import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PositionLock, type LockHandle } from "../position-lock.js";

describe("PositionLock", () => {
  let lock: PositionLock;

  beforeEach(() => {
    lock = new PositionLock(5000); // 5s TTL for tests
  });

  afterEach(() => {
    lock.dispose();
  });

  it("builds correct lock keys", () => {
    expect(PositionLock.key("user1", 1, "0xABCD")).toBe("user1:1:0xabcd");
    expect(PositionLock.key("user2", 137, "0xDEAD")).toBe("user2:137:0xdead");
  });

  it("acquires and releases exclusive lock", async () => {
    const key = "user1:1:0xtoken";
    const handle = await lock.acquire(key, "exclusive");

    expect(handle.key).toBe(key);
    expect(handle.mode).toBe("exclusive");
    expect(lock.isLocked(key)).toBe(true);

    lock.release(handle);
    expect(lock.isLocked(key)).toBe(false);
  });

  it("acquires and releases shared lock", async () => {
    const key = "user1:1:0xtoken";
    const handle = await lock.acquire(key, "shared");

    expect(handle.mode).toBe("shared");
    expect(lock.isLocked(key)).toBe(true);

    lock.release(handle);
    expect(lock.isLocked(key)).toBe(false);
  });

  it("allows multiple shared locks on same key", async () => {
    const key = "user1:1:0xtoken";
    const h1 = await lock.acquire(key, "shared");
    const h2 = await lock.acquire(key, "shared");

    expect(lock.isLocked(key)).toBe(true);
    expect(lock.getActiveLocks()).toHaveLength(2);

    lock.release(h1);
    expect(lock.isLocked(key)).toBe(true);

    lock.release(h2);
    expect(lock.isLocked(key)).toBe(false);
  });

  it("blocks exclusive lock when shared lock is held", async () => {
    const key = "user1:1:0xtoken";
    const shared = await lock.acquire(key, "shared");

    expect(lock.canAcquireNow(key, "exclusive")).toBe(false);

    // Release shared → exclusive should become available
    lock.release(shared);
    expect(lock.canAcquireNow(key, "exclusive")).toBe(true);
  });

  it("blocks shared lock when exclusive lock is held", async () => {
    const key = "user1:1:0xtoken";
    const exclusive = await lock.acquire(key, "exclusive");

    expect(lock.canAcquireNow(key, "shared")).toBe(false);

    lock.release(exclusive);
    expect(lock.canAcquireNow(key, "shared")).toBe(true);
  });

  it("blocks exclusive lock when another exclusive lock is held", async () => {
    const key = "user1:1:0xtoken";
    const first = await lock.acquire(key, "exclusive");

    expect(lock.canAcquireNow(key, "exclusive")).toBe(false);

    lock.release(first);
    expect(lock.canAcquireNow(key, "exclusive")).toBe(true);
  });

  it("queues exclusive lock and grants after shared release", async () => {
    const key = "user1:1:0xtoken";
    const shared = await lock.acquire(key, "shared");

    let exclusiveGranted = false;
    const exclusivePromise = lock.acquire(key, "exclusive", 2000).then((h) => {
      exclusiveGranted = true;
      return h;
    });

    // Exclusive should be waiting
    await new Promise((r) => setTimeout(r, 50));
    expect(exclusiveGranted).toBe(false);

    // Release shared → exclusive should be granted
    lock.release(shared);
    const exclusiveHandle = await exclusivePromise;
    expect(exclusiveGranted).toBe(true);
    expect(exclusiveHandle.mode).toBe("exclusive");

    lock.release(exclusiveHandle);
  });

  it("queues shared lock and grants after exclusive release", async () => {
    const key = "user1:1:0xtoken";
    const exclusive = await lock.acquire(key, "exclusive");

    let sharedGranted = false;
    const sharedPromise = lock.acquire(key, "shared", 2000).then((h) => {
      sharedGranted = true;
      return h;
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(sharedGranted).toBe(false);

    lock.release(exclusive);
    const sharedHandle = await sharedPromise;
    expect(sharedGranted).toBe(true);

    lock.release(sharedHandle);
  });

  it("times out when lock cannot be acquired", async () => {
    const key = "user1:1:0xtoken";
    const exclusive = await lock.acquire(key, "exclusive");

    await expect(lock.acquire(key, "shared", 100)).rejects.toThrow("PositionLock timeout");

    lock.release(exclusive);
  });

  it("handles different keys independently", async () => {
    const key1 = "user1:1:0xtoken1";
    const key2 = "user1:1:0xtoken2";

    const h1 = await lock.acquire(key1, "exclusive");
    const h2 = await lock.acquire(key2, "exclusive");

    expect(lock.isLocked(key1)).toBe(true);
    expect(lock.isLocked(key2)).toBe(true);

    lock.release(h1);
    expect(lock.isLocked(key1)).toBe(false);
    expect(lock.isLocked(key2)).toBe(true);

    lock.release(h2);
  });

  it("FIFO ordering: exclusive waiter blocks subsequent shared waiters", async () => {
    const key = "user1:1:0xtoken";
    const shared1 = await lock.acquire(key, "shared");

    const order: string[] = [];

    const exclusivePromise = lock.acquire(key, "exclusive", 3000).then((h) => {
      order.push("exclusive");
      return h;
    });

    // Give exclusive time to queue
    await new Promise((r) => setTimeout(r, 10));

    const shared2Promise = lock.acquire(key, "shared", 3000).then((h) => {
      order.push("shared2");
      return h;
    });

    // Release first shared → exclusive should go first (FIFO)
    lock.release(shared1);
    const exclusiveHandle = await exclusivePromise;
    expect(order).toEqual(["exclusive"]);

    // Release exclusive → shared2 should go
    lock.release(exclusiveHandle);
    const shared2Handle = await shared2Promise;
    expect(order).toEqual(["exclusive", "shared2"]);

    lock.release(shared2Handle);
  });

  it("cleans up stale locks via TTL", async () => {
    const shortLock = new PositionLock(100); // 100ms TTL
    const key = "user1:1:0xtoken";

    await shortLock.acquire(key, "exclusive");
    expect(shortLock.isLocked(key)).toBe(true);

    // Wait for cleanup cycle (cleanup runs every 60s by default, so trigger manually)
    await new Promise((r) => setTimeout(r, 150));
    // Access internal cleanup
    (shortLock as unknown as { cleanupStaleLocks: () => void }).cleanupStaleLocks();

    expect(shortLock.isLocked(key)).toBe(false);
    shortLock.dispose();
  });

  it("getActiveLocks returns all held locks", async () => {
    const h1 = await lock.acquire("a:1:0x1", "exclusive");
    const h2 = await lock.acquire("b:2:0x2", "shared");
    const h3 = await lock.acquire("b:2:0x2", "shared");

    const active = lock.getActiveLocks();
    expect(active).toHaveLength(3);
    expect(active[0].key).toBe("a:1:0x1");
    expect(active[0].mode).toBe("exclusive");

    lock.release(h1);
    lock.release(h2);
    lock.release(h3);
  });

  it("release is idempotent", async () => {
    const key = "user1:1:0xtoken";
    const handle = await lock.acquire(key, "exclusive");

    lock.release(handle);
    lock.release(handle); // should not throw
    expect(lock.isLocked(key)).toBe(false);
  });

  it("concurrent exclusive acquires are serialized", async () => {
    const key = "user1:1:0xtoken";
    const handles: LockHandle[] = [];

    // Acquire 3 exclusive locks — they must serialize
    const p1 = lock.acquire(key, "exclusive", 5000).then((h) => { handles.push(h); return h; });
    const p2 = lock.acquire(key, "exclusive", 5000).then((h) => { handles.push(h); return h; });
    const p3 = lock.acquire(key, "exclusive", 5000).then((h) => { handles.push(h); return h; });

    // First should resolve immediately
    const h1 = await p1;
    expect(handles).toHaveLength(1);

    // Release first → second should resolve
    lock.release(h1);
    const h2 = await p2;
    expect(handles).toHaveLength(2);

    // Release second → third should resolve
    lock.release(h2);
    const h3 = await p3;
    expect(handles).toHaveLength(3);

    lock.release(h3);
  });
});
