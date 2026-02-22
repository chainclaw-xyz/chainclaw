import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireProcessLock, isPidAlive } from "../process-lock.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "chainclaw-lock-test-"));
}

const handles: { release(): void }[] = [];

afterEach(() => {
  for (const h of handles) {
    try { h.release(); } catch { /* ignore */ }
  }
  handles.length = 0;
});

describe("isPidAlive", () => {
  it("returns true for current process", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("returns false for non-existent PID", () => {
    // Use a very high PID unlikely to exist
    expect(isPidAlive(999999)).toBe(false);
  });
});

describe("acquireProcessLock", () => {
  it("acquires and releases a lock", () => {
    const dir = tempDir();
    const handle = acquireProcessLock(dir);
    handles.push(handle);

    expect(existsSync(join(dir, "chainclaw.lock"))).toBe(true);

    handle.release();
    expect(existsSync(join(dir, "chainclaw.lock"))).toBe(false);
  });

  it("blocks concurrent acquisition from same process", () => {
    const dir = tempDir();
    const handle = acquireProcessLock(dir);
    handles.push(handle);

    // Second acquisition should fail (same PID so not considered dead)
    expect(() =>
      acquireProcessLock(dir, { timeoutMs: 200, pollMs: 50 }),
    ).toThrow("Could not acquire process lock");

    handle.release();
  });

  it("cleans up stale lock from dead process", () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });

    // Write a lock with a dead PID
    const staleLock = {
      pid: 999998,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(dir, "chainclaw.lock"), JSON.stringify(staleLock));

    // Should acquire successfully after cleaning stale lock
    const handle = acquireProcessLock(dir);
    handles.push(handle);
    expect(existsSync(join(dir, "chainclaw.lock"))).toBe(true);

    handle.release();
  });

  it("cleans up lock older than staleMs", () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });

    // Write a lock with current PID but very old timestamp
    const staleLock = {
      pid: process.pid,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    };
    writeFileSync(join(dir, "chainclaw.lock"), JSON.stringify(staleLock));

    // Should acquire after detecting stale lock (staleMs = 1000)
    const handle = acquireProcessLock(dir, { staleMs: 1000 });
    handles.push(handle);

    handle.release();
  });

  it("creates lock directory if it doesn't exist", () => {
    const dir = join(tempDir(), "nested", "dir");
    const handle = acquireProcessLock(dir);
    handles.push(handle);

    expect(existsSync(join(dir, "chainclaw.lock"))).toBe(true);
    handle.release();
  });

  it("release is idempotent", () => {
    const dir = tempDir();
    const handle = acquireProcessLock(dir);
    handle.release();
    // Should not throw on double release
    expect(() => handle.release()).not.toThrow();
  });
});
