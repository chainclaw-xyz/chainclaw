import { getLogger } from "@chainclaw/core";
import { formatEther } from "viem";
import type Database from "better-sqlite3";
import type { TransactionRequest, GuardrailCheck, UserLimits } from "./types.js";
import { DEFAULT_LIMITS } from "./types.js";

const logger = getLogger("guardrails");

export class Guardrails {
  private db: Database.Database;
  private userLimits: Map<string, UserLimits> = new Map();
  private lastTxTime: Map<string, number> = new Map(); // userId → timestamp

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_limits (
        user_id TEXT PRIMARY KEY,
        max_per_tx REAL NOT NULL DEFAULT 1000,
        max_per_day REAL NOT NULL DEFAULT 5000,
        cooldown_seconds INTEGER NOT NULL DEFAULT 30,
        slippage_bps INTEGER NOT NULL DEFAULT 100
      );

      CREATE TABLE IF NOT EXISTS tx_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        from_addr TEXT NOT NULL,
        to_addr TEXT NOT NULL,
        value TEXT NOT NULL,
        hash TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        skill_name TEXT NOT NULL DEFAULT '',
        intent_description TEXT NOT NULL DEFAULT '',
        simulation_result TEXT,
        guardrail_checks TEXT,
        gas_used TEXT,
        gas_price TEXT,
        block_number INTEGER,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tx_log_user ON tx_log(user_id, created_at);
    `);
  }

  getLimits(userId: string): UserLimits {
    const cached = this.userLimits.get(userId);
    if (cached) return cached;

    const row = this.db
      .prepare(
        `SELECT max_per_tx as maxPerTx, max_per_day as maxPerDay,
                cooldown_seconds as cooldownSeconds, slippage_bps as slippageBps
         FROM user_limits WHERE user_id = ?`,
      )
      .get(userId) as UserLimits | undefined;

    const limits = row ?? DEFAULT_LIMITS;
    this.userLimits.set(userId, limits);
    return limits;
  }

  setLimits(userId: string, limits: Partial<UserLimits>): UserLimits {
    const current = this.getLimits(userId);
    const updated = { ...current, ...limits };

    this.db
      .prepare(
        `INSERT INTO user_limits (user_id, max_per_tx, max_per_day, cooldown_seconds, slippage_bps)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           max_per_tx = excluded.max_per_tx,
           max_per_day = excluded.max_per_day,
           cooldown_seconds = excluded.cooldown_seconds,
           slippage_bps = excluded.slippage_bps`,
      )
      .run(userId, updated.maxPerTx, updated.maxPerDay, updated.cooldownSeconds, updated.slippageBps);

    this.userLimits.set(userId, updated);
    return updated;
  }

  async check(
    userId: string,
    tx: TransactionRequest,
    ethPriceUsd: number,
  ): Promise<GuardrailCheck[]> {
    const limits = this.getLimits(userId);
    const checks: GuardrailCheck[] = [];

    // 1. Per-transaction limit
    const txValueEth = Number(formatEther(tx.value));
    const txValueUsd = txValueEth * ethPriceUsd;

    checks.push({
      passed: txValueUsd <= limits.maxPerTx,
      rule: "max_per_tx",
      message:
        txValueUsd <= limits.maxPerTx
          ? `Transaction value $${txValueUsd.toFixed(2)} within limit ($${limits.maxPerTx})`
          : `Transaction value $${txValueUsd.toFixed(2)} exceeds per-tx limit of $${limits.maxPerTx}`,
    });

    // 2. Daily spending limit
    const dailySpent = this.getDailySpending(userId, ethPriceUsd);
    const dailyTotal = dailySpent + txValueUsd;

    checks.push({
      passed: dailyTotal <= limits.maxPerDay,
      rule: "max_per_day",
      message:
        dailyTotal <= limits.maxPerDay
          ? `Daily spending $${dailyTotal.toFixed(2)} within limit ($${limits.maxPerDay})`
          : `Daily spending $${dailyTotal.toFixed(2)} would exceed limit of $${limits.maxPerDay}`,
    });

    // 3. Cooldown between transactions
    const lastTx = this.lastTxTime.get(userId) ?? 0;
    const elapsed = (Date.now() - lastTx) / 1000;

    checks.push({
      passed: elapsed >= limits.cooldownSeconds,
      rule: "cooldown",
      message:
        elapsed >= limits.cooldownSeconds
          ? "Cooldown period passed"
          : `Please wait ${Math.ceil(limits.cooldownSeconds - elapsed)}s before next transaction`,
    });

    logger.info(
      {
        userId,
        passed: checks.every((c) => c.passed),
        checks: checks.map((c) => ({ rule: c.rule, passed: c.passed })),
      },
      "Guardrail checks complete",
    );

    return checks;
  }

  private getDailySpending(userId: string, ethPriceUsd: number): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(CAST(value AS REAL)), 0) as totalWei
         FROM tx_log
         WHERE user_id = ?
           AND status IN ('confirmed', 'broadcast')
           AND created_at >= datetime('now', '-1 day')`,
      )
      .get(userId) as { totalWei: number } | undefined;

    if (!row) return 0;
    // value is stored in wei as string, totalWei here is sum of those as float
    const totalEth = row.totalWei / 1e18;
    return totalEth * ethPriceUsd;
  }

  recordTxSent(userId: string): void {
    this.lastTxTime.set(userId, Date.now());
  }

  requiresConfirmation(txValueUsd: number, limits: UserLimits): boolean {
    // Require confirmation for transactions above 50% of per-tx limit
    return txValueUsd > limits.maxPerTx * 0.5;
  }
}
