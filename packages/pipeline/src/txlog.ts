import { randomUUID } from "node:crypto";
import { getLogger } from "@chainclaw/core";
import type Database from "better-sqlite3";
import type { TransactionRecord, TxStatus } from "./types.js";

const logger = getLogger("tx-log");

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

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
              gas_price = COALESCE(?, gas_price), gas_cost_usd = COALESCE(?, gas_cost_usd),
              block_number = COALESCE(?, block_number),
              error = COALESCE(?, error), updated_at = datetime('now')
       WHERE id = ?`,
    );

    this.getByIdStmt = db.prepare(
      `SELECT id, user_id as userId, chain_id as chainId, from_addr as "from", to_addr as "to",
              value, hash, status, skill_name as skillName, intent_description as intentDescription,
              simulation_result as simulationResult, guardrail_checks as guardrailChecks,
              gas_used as gasUsed, gas_price as gasPrice, gas_cost_usd as gasCostUsd,
              block_number as blockNumber,
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
      params.simulationResult ? JSON.stringify(params.simulationResult, bigintReplacer) : null,
      params.guardrailChecks ? JSON.stringify(params.guardrailChecks, bigintReplacer) : null,
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
      gasCostUsd?: number;
      blockNumber?: number;
      error?: string;
    },
  ): void {
    this.updateStatusStmt.run(
      status,
      details?.hash ?? null,
      details?.gasUsed ?? null,
      details?.gasPrice ?? null,
      details?.gasCostUsd ?? null,
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

  getGasCostSummary(userId: string, periodDays: number = 1): { totalGasCostUsd: number; txCount: number; perChain: Record<number, number> } {
    const rows = this.db
      .prepare(
        `SELECT chain_id as chainId, gas_cost_usd as gasCostUsd
         FROM tx_log
         WHERE user_id = ? AND status = 'confirmed' AND gas_cost_usd IS NOT NULL
           AND created_at >= datetime('now', '-' || ? || ' day')`,
      )
      .all(userId, periodDays) as Array<{ chainId: number; gasCostUsd: number }>;

    let totalGasCostUsd = 0;
    const perChain: Record<number, number> = {};
    for (const row of rows) {
      totalGasCostUsd += row.gasCostUsd;
      perChain[row.chainId] = (perChain[row.chainId] ?? 0) + row.gasCostUsd;
    }
    return { totalGasCostUsd, txCount: rows.length, perChain };
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
