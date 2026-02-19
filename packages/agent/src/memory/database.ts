import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { getLogger } from "@chainclaw/core";

const logger = getLogger("database");

let db: Database.Database | null = null;

export function getDatabase(dataDir: string): Database.Database {
  if (db) return db;

  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "chainclaw.sqlite");

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);
  logger.info({ path: dbPath }, "Database initialized");

  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_user_id
      ON conversations(user_id);

    CREATE INDEX IF NOT EXISTS idx_conversations_created_at
      ON conversations(user_id, created_at);

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      default_chain_id INTEGER DEFAULT 1,
      slippage_tolerance REAL DEFAULT 1.0,
      confirmation_threshold REAL DEFAULT 100.0,
      max_tx_per_day INTEGER DEFAULT 50,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  logger.debug("Database migrations applied");
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
