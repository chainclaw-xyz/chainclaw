import { getLogger, triggerHook, createHookEvent } from "@chainclaw/core";

const logger = getLogger("position-lock");

// ─── Types ──────────────────────────────────────────────────

export type LockMode = "exclusive" | "shared";

export interface LockHandle {
  key: string;
  mode: LockMode;
  acquiredAt: number;
  id: number;
}

interface LockEntry {
  handle: LockHandle;
  resolve?: () => void;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

// ─── Position Lock ──────────────────────────────────────────

/**
 * Prevents concurrent skill executions on the same token/chain/user.
 *
 * Lock key format: `{userId}:{chainId}:{tokenAddress}`
 *
 * Exclusive locks (swap, trailing-stop, rebalance) block all other locks.
 * Shared locks (balance, yield-finder) allow other shared locks but block exclusive.
 */
export class PositionLock {
  private locks = new Map<string, LockEntry[]>();
  private waitQueues = new Map<string, Array<{ mode: LockMode; resolve: () => void; id: number }>>();
  private nextId = 1;
  private ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    this.startCleanup();
  }

  /**
   * Build a standard lock key from user, chain, and token.
   */
  static key(userId: string, chainId: number, tokenAddress: string): string {
    return `${userId}:${chainId}:${tokenAddress.toLowerCase()}`;
  }

  /**
   * Acquire a lock on a position.
   *
   * - `exclusive`: blocks until no other locks (shared or exclusive) are held
   * - `shared`: blocks until no exclusive lock is held; multiple shared locks coexist
   *
   * Resolves with a LockHandle when the lock is acquired.
   * Rejects if `timeoutMs` elapses before acquisition.
   */
  async acquire(key: string, mode: LockMode, timeoutMs?: number): Promise<LockHandle> {
    const timeout = timeoutMs ?? this.ttlMs;

    if (this.canAcquire(key, mode)) {
      return this.grant(key, mode);
    }

    // Emit contention hook
    void triggerHook(createHookEvent("tx", "lock_contention", { key, mode }));

    // Wait in queue
    return new Promise<LockHandle>((resolve, reject) => {
      const id = this.nextId++;
      let queue = this.waitQueues.get(key);
      if (!queue) {
        queue = [];
        this.waitQueues.set(key, queue);
      }

      const timer = setTimeout(() => {
        // Remove from queue on timeout
        const q = this.waitQueues.get(key);
        if (q) {
          const idx = q.findIndex((w) => w.id === id);
          if (idx !== -1) q.splice(idx, 1);
          if (q.length === 0) this.waitQueues.delete(key);
        }
        reject(new Error(`PositionLock timeout: could not acquire ${mode} lock on "${key}" within ${timeout}ms`));
      }, timeout);

      queue.push({
        mode,
        id,
        resolve: () => {
          clearTimeout(timer);
          resolve(this.grant(key, mode));
        },
      });
    });
  }

  /**
   * Release a previously acquired lock.
   */
  release(handle: LockHandle): void {
    const entries = this.locks.get(handle.key);
    if (!entries) return;

    const idx = entries.findIndex((e) => e.handle.id === handle.id);
    if (idx === -1) return;

    entries.splice(idx, 1);
    if (entries.length === 0) {
      this.locks.delete(handle.key);
    }

    logger.debug({ key: handle.key, mode: handle.mode }, "Lock released");
    void triggerHook(createHookEvent("tx", "lock_released", { key: handle.key, mode: handle.mode }));

    // Process waiting queue
    this.processQueue(handle.key);
  }

  /**
   * Check if a key currently has any active lock.
   */
  isLocked(key: string): boolean {
    const entries = this.locks.get(key);
    return !!entries && entries.length > 0;
  }

  /**
   * Check if a specific lock mode can be acquired right now (non-blocking).
   */
  canAcquireNow(key: string, mode: LockMode): boolean {
    return this.canAcquire(key, mode);
  }

  /**
   * Get debug info about current locks.
   */
  getActiveLocks(): Array<{ key: string; mode: LockMode; acquiredAt: number; ageMs: number }> {
    const now = Date.now();
    const result: Array<{ key: string; mode: LockMode; acquiredAt: number; ageMs: number }> = [];
    for (const [, entries] of this.locks) {
      for (const entry of entries) {
        result.push({
          key: entry.handle.key,
          mode: entry.handle.mode,
          acquiredAt: entry.handle.acquiredAt,
          ageMs: now - entry.handle.acquiredAt,
        });
      }
    }
    return result;
  }

  /**
   * Stop the background cleanup timer. Call on shutdown.
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ─── Internal ─────────────────────────────────────────────

  private canAcquire(key: string, mode: LockMode): boolean {
    const entries = this.locks.get(key);
    if (!entries || entries.length === 0) return true;

    if (mode === "exclusive") {
      // Exclusive needs zero existing locks
      return false;
    }

    // Shared can coexist with other shared locks...
    if (!entries.every((e) => e.handle.mode === "shared")) return false;

    // ...but not if there's an exclusive waiter queued (prevents starvation)
    const queue = this.waitQueues.get(key);
    if (queue && queue.some((w) => w.mode === "exclusive")) return false;

    return true;
  }

  private grant(key: string, mode: LockMode): LockHandle {
    const handle: LockHandle = {
      key,
      mode,
      acquiredAt: Date.now(),
      id: this.nextId++,
    };

    let entries = this.locks.get(key);
    if (!entries) {
      entries = [];
      this.locks.set(key, entries);
    }
    entries.push({ handle });

    logger.debug({ key, mode, id: handle.id }, "Lock acquired");
    void triggerHook(createHookEvent("tx", "lock_acquired", { key, mode }));

    return handle;
  }

  private processQueue(key: string): void {
    const queue = this.waitQueues.get(key);
    if (!queue || queue.length === 0) return;

    // Try to grant locks to waiters in FIFO order
    while (queue.length > 0) {
      const next = queue[0];
      if (this.canAcquire(key, next.mode)) {
        queue.shift();
        next.resolve();
        // If we granted an exclusive lock, stop processing
        if (next.mode === "exclusive") break;
        // If shared, keep trying to batch more shared locks
      } else {
        break;
      }
    }

    if (queue.length === 0) {
      this.waitQueues.delete(key);
    }
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleLocks();
    }, CLEANUP_INTERVAL_MS);

    // Don't keep the process alive just for cleanup
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private cleanupStaleLocks(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entries] of this.locks) {
      const stale = entries.filter((e) => now - e.handle.acquiredAt > this.ttlMs);
      for (const entry of stale) {
        logger.warn({ key, mode: entry.handle.mode, ageMs: now - entry.handle.acquiredAt }, "Releasing stale lock");
        this.release(entry.handle);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned }, "Stale locks cleaned up");
    }
  }
}
