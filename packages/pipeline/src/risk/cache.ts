import { getLogger } from "@chainclaw/core";
import type Database from "better-sqlite3";
import type { TokenSafetyReport, ContractListEntry, AllowlistAction } from "./types.js";

const logger = getLogger("risk-cache");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class RiskCache {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureTables();
  }

  private ensureTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS risk_cache (
        address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        report TEXT NOT NULL,
        cached_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (address, chain_id)
      );

      CREATE TABLE IF NOT EXISTS contract_list (
        user_id TEXT NOT NULL,
        address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('allow', 'block')),
        reason TEXT NOT NULL DEFAULT '',
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, address, chain_id)
      );

      CREATE INDEX IF NOT EXISTS idx_contract_list_user ON contract_list(user_id);
    `);
  }

  getCachedReport(
    address: string,
    chainId: number,
  ): TokenSafetyReport | null {
    const row = this.db
      .prepare(
        `SELECT report, cached_at FROM risk_cache WHERE address = ? AND chain_id = ?`,
      )
      .get(address.toLowerCase(), chainId) as
      | { report: string; cached_at: string }
      | undefined;

    if (!row) return null;

    // Check if cache is expired
    const cachedTime = new Date(row.cached_at).getTime();
    if (Date.now() - cachedTime > CACHE_TTL_MS) {
      this.db
        .prepare(`DELETE FROM risk_cache WHERE address = ? AND chain_id = ?`)
        .run(address.toLowerCase(), chainId);
      return null;
    }

    try {
      return JSON.parse(row.report) as TokenSafetyReport;
    } catch {
      return null;
    }
  }

  cacheReport(report: TokenSafetyReport): void {
    this.db
      .prepare(
        `INSERT INTO risk_cache (address, chain_id, report, cached_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(address, chain_id) DO UPDATE SET
           report = excluded.report,
           cached_at = excluded.cached_at`,
      )
      .run(
        report.address.toLowerCase(),
        report.chainId,
        JSON.stringify(report),
      );

    logger.debug(
      { address: report.address, chainId: report.chainId },
      "Risk report cached",
    );
  }

  // ─── Contract Allowlist / Blocklist ───────────────────────

  setContractAction(
    userId: string,
    address: string,
    chainId: number,
    action: AllowlistAction,
    reason: string = "",
  ): void {
    this.db
      .prepare(
        `INSERT INTO contract_list (user_id, address, chain_id, action, reason)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, address, chain_id) DO UPDATE SET
           action = excluded.action,
           reason = excluded.reason,
           added_at = datetime('now')`,
      )
      .run(userId, address.toLowerCase(), chainId, action, reason);

    logger.info({ userId, address, chainId, action }, "Contract list updated");
  }

  removeContractAction(
    userId: string,
    address: string,
    chainId: number,
  ): boolean {
    const result = this.db
      .prepare(
        `DELETE FROM contract_list WHERE user_id = ? AND address = ? AND chain_id = ?`,
      )
      .run(userId, address.toLowerCase(), chainId);

    return result.changes > 0;
  }

  getContractAction(
    userId: string,
    address: string,
    chainId: number,
  ): AllowlistAction | null {
    const row = this.db
      .prepare(
        `SELECT action FROM contract_list WHERE user_id = ? AND address = ? AND chain_id = ?`,
      )
      .get(userId, address.toLowerCase(), chainId) as
      | { action: AllowlistAction }
      | undefined;

    return row?.action ?? null;
  }

  getUserList(userId: string): ContractListEntry[] {
    return this.db
      .prepare(
        `SELECT address, chain_id as chainId, action, reason, added_at as addedAt
         FROM contract_list WHERE user_id = ? ORDER BY added_at DESC`,
      )
      .all(userId) as ContractListEntry[];
  }

  isBlocked(userId: string, address: string, chainId: number): boolean {
    return this.getContractAction(userId, address, chainId) === "block";
  }

  isAllowed(userId: string, address: string, chainId: number): boolean {
    return this.getContractAction(userId, address, chainId) === "allow";
  }
}
