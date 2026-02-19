import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { parseEther, type Address } from "viem";
import { Guardrails } from "../guardrails.js";
import type { TransactionRequest } from "../types.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  return db;
}

function makeTx(valueEth: string): TransactionRequest {
  return {
    chainId: 1,
    from: "0x1111111111111111111111111111111111111111" as Address,
    to: "0x2222222222222222222222222222222222222222" as Address,
    value: parseEther(valueEth),
  };
}

describe("Guardrails", () => {
  let db: Database.Database;
  let guardrails: Guardrails;
  const ethPrice = 2500;

  beforeEach(() => {
    db = createTestDb();
    guardrails = new Guardrails(db);
  });

  afterEach(() => {
    db.close();
  });

  it("allows transactions within limits", async () => {
    const checks = await guardrails.check("user1", makeTx("0.1"), ethPrice);
    // 0.1 ETH = $250, well within $1000 per-tx default
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("blocks transactions exceeding per-tx limit", async () => {
    const checks = await guardrails.check("user1", makeTx("1"), ethPrice);
    // 1 ETH = $2500, exceeds $1000 default
    const perTxCheck = checks.find((c) => c.rule === "max_per_tx");
    expect(perTxCheck?.passed).toBe(false);
  });

  it("enforces cooldown between transactions", async () => {
    guardrails.recordTxSent("user1");

    const checks = await guardrails.check("user1", makeTx("0.01"), ethPrice);
    const cooldownCheck = checks.find((c) => c.rule === "cooldown");
    expect(cooldownCheck?.passed).toBe(false);
  });

  it("allows custom limits per user", async () => {
    guardrails.setLimits("whale", { maxPerTx: 100000, maxPerDay: 500000, cooldownSeconds: 0 });

    const checks = await guardrails.check("whale", makeTx("10"), ethPrice);
    // 10 ETH = $25000, within $100000 limit
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("returns default limits for unknown user", () => {
    const limits = guardrails.getLimits("newuser");
    expect(limits.maxPerTx).toBe(1000);
    expect(limits.maxPerDay).toBe(5000);
    expect(limits.slippageBps).toBe(100);
  });

  it("requires confirmation for large transactions", () => {
    const limits = guardrails.getLimits("user1");
    // Above 50% of $1000 = above $500
    expect(guardrails.requiresConfirmation(600, limits)).toBe(true);
    expect(guardrails.requiresConfirmation(400, limits)).toBe(false);
  });
});
