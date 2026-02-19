import { randomUUID } from "node:crypto";
import { getLogger } from "@chainclaw/core";
import type Database from "better-sqlite3";
import type { TransactionRecord, TxStatus } from "./types.js";

const logger = getLogger("tx-log");

export class TransactionLog {
  private db: Database.Database;
  private insertStmt: Database.Statement;
  private updateStatusStmt: Database.Statement;
  private getByIdStmt: Database.Statement;
  private getByUserStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;

    this.insertStmt = db.prepare(
      `INSERT INTO tx_log (id, user_id, chain_id, from_addr, to_addr, value, status, skill_name, intent_description, simulation_result, guardrail_checks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.updateStatusStmt = db.prepare(
      `UPDATE tx_log SET status = ?, hash = COALESCE(?, hash), gas_used = COALESCE(?, gas_used),
              gas_price = COALESCE(?, gas_price), block_number = COALESCE(?, block_number),
              error = COALESCE(?, error), updated_at = datetime('now')
       WHERE id = ?`,
    );

    this.getByIdStmt = db.prepare(
      `SELECT id, user_id as userId, chain_id as chainId, from_addr as "from", to_addr as "to",
              value, hash, status, skill_name as skillName, intent_description as intentDescription,
              simulation_result as simulationResult, guardrail_checks as guardrailChecks,
              gas_used as gasUsed, gas_price as gasPrice, block_number as blockNumber,
              error, created_at as createdAt, updated_at as updatedAt
       FROM tx_log WHERE id = ?`,
    );

    this.getByUserStmt = db.prepare(
      `SELECT id, user_id as userId, chain_id as chainId, from_addr as "from", to_addr as "to",
              value, hash, status, skill_name as skillName, intent_description as intentDescription,
              gas_used as gasUsed, created_at as createdAt
       FROM tx_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    );
  }

  create(params: {
    userId: string;
    chainId: number;
    from: string;
    to: string;
    value: string;
    skillName: string;
    intentDescription: string;
    simulationResult?: unknown;
    guardrailChecks?: unknown;
  }): string {
    const id = randomUUID();

    this.insertStmt.run(
      id,
      params.userId,
      params.chainId,
      params.from,
      params.to,
      params.value,
      "pending",
      params.skillName,
      params.intentDescription,
      params.simulationResult ? JSON.stringify(params.simulationResult) : null,
      params.guardrailChecks ? JSON.stringify(params.guardrailChecks) : null,
    );

    logger.info({ id, userId: params.userId, skill: params.skillName }, "Transaction logged");
    return id;
  }

  updateStatus(
    id: string,
    status: TxStatus,
    details?: {
      hash?: string;
      gasUsed?: string;
      gasPrice?: string;
      blockNumber?: number;
      error?: string;
    },
  ): void {
    this.updateStatusStmt.run(
      status,
      details?.hash ?? null,
      details?.gasUsed ?? null,
      details?.gasPrice ?? null,
      details?.blockNumber ?? null,
      details?.error ?? null,
      id,
    );

    logger.debug({ id, status }, "Transaction status updated");
  }

  getById(id: string): TransactionRecord | undefined {
    return this.getByIdStmt.get(id) as TransactionRecord | undefined;
  }

  getByUser(userId: string, limit: number = 10): TransactionRecord[] {
    return this.getByUserStmt.all(userId, limit) as TransactionRecord[];
  }

  formatHistory(records: TransactionRecord[]): string {
    if (records.length === 0) return "No transactions found.";

    const lines = ["*Recent Transactions*", ""];

    for (const tx of records) {
      const statusIcon = tx.status === "confirmed" ? "+" : tx.status === "failed" ? "x" : "~";
      const hashShort = tx.hash ? `\`${tx.hash.slice(0, 10)}...\`` : "pending";
      const date = tx.createdAt.split("T")[0];

      lines.push(
        `${statusIcon} ${tx.skillName} | ${tx.status} | ${hashShort} | ${date}`,
      );
    }

    return lines.join("\n");
  }
}
