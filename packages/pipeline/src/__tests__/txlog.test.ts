import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { TransactionLog } from "../txlog.js";
import { Guardrails } from "../guardrails.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  // Guardrails constructor creates the tx_log table
  new Guardrails(db);
  return db;
}

describe("TransactionLog", () => {
  let db: Database.Database;
  let txLog: TransactionLog;

  beforeEach(() => {
    db = createTestDb();
    txLog = new TransactionLog(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates a transaction record and returns id", () => {
    const id = txLog.create({
      userId: "user1",
      chainId: 1,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      value: "1000000000000000000",
      skillName: "swap",
      intentDescription: "Swap 1 ETH to USDC",
    });

    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("retrieves a transaction by id", () => {
    const id = txLog.create({
      userId: "user1",
      chainId: 1,
      from: "0xaaaa",
      to: "0xbbbb",
      value: "500",
      skillName: "transfer",
      intentDescription: "Send ETH",
    });

    const record = txLog.getById(id);
    expect(record).toBeDefined();
    expect(record!.userId).toBe("user1");
    expect(record!.chainId).toBe(1);
    expect(record!.skillName).toBe("transfer");
    expect(record!.status).toBe("pending");
  });

  it("updates transaction status with details", () => {
    const id = txLog.create({
      userId: "user1",
      chainId: 1,
      from: "0xaaaa",
      to: "0xbbbb",
      value: "500",
      skillName: "swap",
      intentDescription: "Swap tokens",
    });

    txLog.updateStatus(id, "broadcast", {
      hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    });

    const record = txLog.getById(id);
    expect(record!.status).toBe("broadcast");
    expect(record!.hash).toBe("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
  });

  it("updates status to confirmed with gas details", () => {
    const id = txLog.create({
      userId: "user1",
      chainId: 1,
      from: "0xaaaa",
      to: "0xbbbb",
      value: "500",
      skillName: "swap",
      intentDescription: "Swap tokens",
    });

    txLog.updateStatus(id, "confirmed", {
      hash: "0xabc123",
      gasUsed: "21000",
      gasPrice: "20000000000",
      blockNumber: 12345678,
    });

    const record = txLog.getById(id);
    expect(record!.status).toBe("confirmed");
    expect(record!.gasUsed).toBe("21000");
    expect(record!.gasPrice).toBe("20000000000");
    expect(record!.blockNumber).toBe(12345678);
  });

  it("retrieves transactions by user", () => {
    for (let i = 0; i < 5; i++) {
      txLog.create({
        userId: "user1",
        chainId: 1,
        from: "0xaaaa",
        to: "0xbbbb",
        value: String(i * 100),
        skillName: `skill${i}`,
        intentDescription: `Action ${i}`,
      });
    }

    // Different user
    txLog.create({
      userId: "user2",
      chainId: 1,
      from: "0xcccc",
      to: "0xdddd",
      value: "999",
      skillName: "other",
      intentDescription: "Other action",
    });

    const user1Txs = txLog.getByUser("user1");
    expect(user1Txs).toHaveLength(5);

    const user2Txs = txLog.getByUser("user2");
    expect(user2Txs).toHaveLength(1);
  });

  it("respects limit parameter in getByUser", () => {
    for (let i = 0; i < 15; i++) {
      txLog.create({
        userId: "user1",
        chainId: 1,
        from: "0xaaaa",
        to: "0xbbbb",
        value: String(i),
        skillName: "swap",
        intentDescription: `Swap ${i}`,
      });
    }

    const limited = txLog.getByUser("user1", 3);
    expect(limited).toHaveLength(3);

    const defaultLimit = txLog.getByUser("user1");
    expect(defaultLimit).toHaveLength(10); // default limit is 10
  });

  it("returns undefined for non-existent id", () => {
    const record = txLog.getById("non-existent-id");
    expect(record).toBeUndefined();
  });

  it("stores simulation and guardrail data as JSON", () => {
    const simResult = { success: true, gasEstimate: "21000" };
    const guardrailChecks = [{ rule: "max_per_tx", passed: true }];

    const id = txLog.create({
      userId: "user1",
      chainId: 1,
      from: "0xaaaa",
      to: "0xbbbb",
      value: "500",
      skillName: "swap",
      intentDescription: "Swap tokens",
      simulationResult: simResult,
      guardrailChecks,
    });

    const record = txLog.getById(id);
    expect(record!.simulationResult).toBe(JSON.stringify(simResult));
    expect(record!.guardrailChecks).toBe(JSON.stringify(guardrailChecks));
  });

  it("formats transaction history", () => {
    const id = txLog.create({
      userId: "user1",
      chainId: 1,
      from: "0xaaaa",
      to: "0xbbbb",
      value: "500",
      skillName: "swap",
      intentDescription: "Swap tokens",
    });

    txLog.updateStatus(id, "confirmed", {
      hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    });

    const records = txLog.getByUser("user1");
    const formatted = txLog.formatHistory(records);

    expect(formatted).toContain("Recent Transactions");
    expect(formatted).toContain("swap");
    expect(formatted).toContain("confirmed");
    expect(formatted).toContain("0xabcdef12");
  });

  it("formats empty history", () => {
    const formatted = txLog.formatHistory([]);
    expect(formatted).toBe("No transactions found.");
  });
});
