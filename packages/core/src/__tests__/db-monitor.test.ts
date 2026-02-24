import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { DbMonitor } from "../db-monitor.js";

vi.mock("../logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../hooks.js", () => ({
  triggerHook: vi.fn(),
  createHookEvent: vi.fn((_type: string, _action: string, data: unknown) => ({ type: _type, action: _action, data })),
}));

let testDir: string;
let dbPath: string;
let db: Database.Database;

beforeEach(() => {
  testDir = join(tmpdir(), `chainclaw-dbmon-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  dbPath = join(testDir, "test.sqlite");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // Create test tables matching the retention rules
  db.exec(`
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE tx_log (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE risk_cache (
      address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      report TEXT,
      cached_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (address, chain_id)
    );
    CREATE TABLE delivery_queue (
      id INTEGER PRIMARY KEY,
      channel TEXT,
      recipient_id TEXT,
      payload TEXT,
      status TEXT DEFAULT 'dead',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
});

afterEach(() => {
  db.close();
  try { unlinkSync(dbPath); } catch { /* ok */ }
  try { unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
  try { unlinkSync(dbPath + "-shm"); } catch { /* ok */ }
  try { rmdirSync(testDir); } catch { /* ok */ }
});

describe("DbMonitor", () => {
  describe("checkSize", () => {
    it("returns size of the database file", () => {
      const monitor = new DbMonitor(dbPath, { maxSizeMb: 500, pruneEnabled: true });
      const result = monitor.checkSize();
      expect(result.sizeMb).toBeGreaterThan(0);
      expect(result.percentUsed).toBeGreaterThan(0);
      expect(result.overThreshold).toBe(false);
    });

    it("reports overThreshold when file exceeds 80% of max", () => {
      // Set a tiny max so the existing DB file triggers the threshold
      const monitor = new DbMonitor(dbPath, { maxSizeMb: 0.001, pruneEnabled: true });
      const result = monitor.checkSize();
      expect(result.overThreshold).toBe(true);
    });

    it("returns zeros for non-existent file", () => {
      const monitor = new DbMonitor("/tmp/nonexistent.sqlite", { maxSizeMb: 500, pruneEnabled: true });
      const result = monitor.checkSize();
      expect(result.sizeMb).toBe(0);
      expect(result.percentUsed).toBe(0);
    });
  });

  describe("pruneIfNeeded", () => {
    it("does not prune when size is under max", () => {
      const monitor = new DbMonitor(dbPath, { maxSizeMb: 500, pruneEnabled: true });
      const result = monitor.pruneIfNeeded(db);
      expect(result.pruned).toBe(false);
    });

    it("does not prune when pruning is disabled", () => {
      const monitor = new DbMonitor(dbPath, { maxSizeMb: 0.001, pruneEnabled: false });
      const result = monitor.pruneIfNeeded(db);
      expect(result.pruned).toBe(false);
    });

    it("deletes old rows when over max size", () => {
      // Insert old data (60 days ago for conversations — beyond 30 day retention)
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const recentDate = new Date().toISOString();

      const insert = db.prepare("INSERT INTO conversations (user_id, role, content, created_at) VALUES (?, ?, ?, ?)");
      insert.run("user1", "user", "old message", oldDate);
      insert.run("user1", "user", "recent message", recentDate);

      // Use tiny max to force pruning
      const monitor = new DbMonitor(dbPath, { maxSizeMb: 0.001, pruneEnabled: true });
      const result = monitor.pruneIfNeeded(db);

      expect(result.pruned).toBe(true);
      expect(result.tablesAffected).toContain("conversations");
      expect(result.rowsDeleted).toBeGreaterThanOrEqual(1);

      // Recent message should still exist
      const remaining = db.prepare("SELECT content FROM conversations").all() as Array<{ content: string }>;
      expect(remaining.some((r) => r.content === "recent message")).toBe(true);
      expect(remaining.some((r) => r.content === "old message")).toBe(false);
    });

    it("prunes delivery_queue only for dead entries", () => {
      const oldDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

      db.prepare("INSERT INTO delivery_queue (channel, recipient_id, payload, status, created_at) VALUES (?, ?, ?, ?, ?)")
        .run("telegram", "user1", "{}", "dead", oldDate);
      db.prepare("INSERT INTO delivery_queue (channel, recipient_id, payload, status, created_at) VALUES (?, ?, ?, ?, ?)")
        .run("telegram", "user1", "{}", "pending", oldDate);

      const monitor = new DbMonitor(dbPath, { maxSizeMb: 0.001, pruneEnabled: true });
      monitor.pruneIfNeeded(db);

      const rows = db.prepare("SELECT status FROM delivery_queue").all() as Array<{ status: string }>;
      // Only the "pending" one should remain (dead + old gets pruned)
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("pending");
    });
  });

  describe("start / stop", () => {
    it("starts and stops without errors", () => {
      const monitor = new DbMonitor(dbPath, { maxSizeMb: 500, pruneEnabled: true });
      monitor.start(db);
      monitor.stop();
    });

    it("can be stopped multiple times safely", () => {
      const monitor = new DbMonitor(dbPath, { maxSizeMb: 500, pruneEnabled: true });
      monitor.start(db);
      monitor.stop();
      monitor.stop(); // Should not throw
    });
  });
});
