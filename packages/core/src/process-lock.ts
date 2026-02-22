import { writeFileSync, readFileSync, unlinkSync, mkdirSync, openSync, closeSync } from "node:fs";
import { join } from "node:path";
import { getLogger } from "./logger.js";

const logger = getLogger("process-lock");

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_MS = 100;

interface LockPayload {
  pid: number;
  createdAt: string;
  label?: string;
}

export interface ProcessLockOptions {
  /** How old a lock must be before it's considered stale. Default: 30s */
  staleMs?: number;
  /** How long to wait for lock acquisition. Default: 5s */
  timeoutMs?: number;
  /** Polling interval when waiting. Default: 100ms */
  pollMs?: number;
  /** Optional label stored in the lock file */
  label?: string;
}

export interface ProcessLockHandle {
  release(): void;
}

/**
 * Check if a PID is alive. Cross-platform (works on macOS/Linux/Docker).
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockPath(dir: string): string {
  return join(dir, "chainclaw.lock");
}

function readLock(path: string): LockPayload | null {
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as LockPayload;
  } catch {
    return null;
  }
}

function isLockStale(payload: LockPayload, staleMs: number): boolean {
  const age = Date.now() - Date.parse(payload.createdAt);
  return age > staleMs;
}

function removeStaleLock(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already gone — fine
  }
}

/**
 * Acquire an exclusive process lock.
 * Prevents multiple server instances from running against the same data dir.
 *
 * @param lockDir - Directory to place the lock file in
 * @param opts - Lock options
 * @returns A handle with release() to free the lock
 * @throws If lock cannot be acquired within timeout
 */
export function acquireProcessLock(
  lockDir: string,
  opts: ProcessLockOptions = {},
): ProcessLockHandle {
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const path = lockPath(lockDir);

  mkdirSync(lockDir, { recursive: true });

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Try to create exclusively
    let fd: number;
    try {
      fd = openSync(path, "wx");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

      // Lock file exists — check if it's stale or owner is dead
      const payload = readLock(path);
      if (!payload) {
        // Unreadable lock — remove and retry
        removeStaleLock(path);
        continue;
      }

      if (!isPidAlive(payload.pid) || isLockStale(payload, staleMs)) {
        logger.info(
          { pid: payload.pid, stale: isLockStale(payload, staleMs) },
          "Removing stale/orphaned lock",
        );
        removeStaleLock(path);
        continue;
      }

      // Lock is held by a live process — wait and retry
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(pollMs, remaining));
      continue;
    }

    // Write lock payload
    const payload: LockPayload = {
      pid: process.pid,
      createdAt: new Date().toISOString(),
      label: opts.label,
    };
    writeFileSync(fd, JSON.stringify(payload));
    closeSync(fd);

    logger.info({ pid: process.pid, path }, "Process lock acquired");

    return {
      release() {
        try {
          unlinkSync(path);
          logger.info({ pid: process.pid }, "Process lock released");
        } catch {
          // Already gone
        }
      },
    };
  }

  throw new Error(
    `Could not acquire process lock at ${path} within ${timeoutMs}ms. ` +
    "Another instance may be running.",
  );
}
