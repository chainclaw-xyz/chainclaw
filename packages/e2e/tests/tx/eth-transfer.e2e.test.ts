import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { parseEther, createPublicClient, http, type Address } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { TransactionExecutor, type TransactionRequest } from "@chainclaw/pipeline";
import { LocalSigner } from "@chainclaw/wallet";
import { snapshot, revert, ANVIL_ACCOUNT_0, ANVIL_ACCOUNT_1 } from "../../src/anvil.js";

const skip = !!process.env.E2E_SKIP;
const rpcUrl = () => process.env.ANVIL_RPC_URL!;

describe.skipIf(skip)("ETH transfer through TransactionExecutor", () => {
  let db: Database.Database;
  let executor: TransactionExecutor;
  let signer: LocalSigner;
  let snapshotId: string;

  beforeAll(async () => {
    // In-memory DB — Guardrails constructor auto-creates tables
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const rpcOverrides: Record<number, string> = {
      1: rpcUrl(),
    };

    executor = new TransactionExecutor(
      db,
      { tenderlyApiKey: undefined, tenderlyAccount: undefined, tenderlyProject: undefined },
      rpcOverrides,
      { enableMevProtection: false },
    );

    const account = privateKeyToAccount(ANVIL_ACCOUNT_0.privateKey);
    signer = new LocalSigner(account, { 1: rpcUrl() });

    snapshotId = await snapshot(rpcUrl());
  });

  afterAll(async () => {
    try { await revert(rpcUrl(), snapshotId); } catch { /* best-effort */ }
    db.close();
  });

  it("sends ETH from account #0 to account #1 and confirms on-chain", async () => {
    const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl()) });

    const balanceBefore = await client.getBalance({ address: ANVIL_ACCOUNT_1.address as Address });

    const tx: TransactionRequest = {
      chainId: 1,
      from: ANVIL_ACCOUNT_0.address as Address,
      to: ANVIL_ACCOUNT_1.address as Address,
      value: parseEther("0.1"),  // ~$250 — stays under $1,000 guardrail
    };

    const result = await executor.execute(
      tx,
      signer,
      { userId: "e2e-test", skillName: "transfer", intentDescription: "E2E test ETH transfer" },
    );

    expect(result.success).toBe(true);
    expect(result.hash).toBeDefined();
    expect(result.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(result.message).toContain("confirmed in block");

    // Verify on-chain: recipient balance increased
    const balanceAfter = await client.getBalance({ address: ANVIL_ACCOUNT_1.address as Address });
    expect(balanceAfter - balanceBefore).toBe(parseEther("0.1"));

    // Verify tx log entry was persisted
    const txLog = executor.getTransactionLog();
    const record = txLog.getById(result.txId);
    expect(record).toBeDefined();
    expect(record!.status).toBe("confirmed");
    expect(record!.hash).toBe(result.hash);
    expect(record!.skillName).toBe("transfer");
  });

  it("tracks callbacks through the execution lifecycle", async () => {
    const events: string[] = [];

    const tx: TransactionRequest = {
      chainId: 1,
      from: ANVIL_ACCOUNT_0.address as Address,
      to: ANVIL_ACCOUNT_1.address as Address,
      value: parseEther("0.01"),
    };

    const result = await executor.execute(
      tx,
      signer,
      { userId: "e2e-test-2", skillName: "transfer", intentDescription: "callback test" },
      {
        onSimulated: async (simResult, preview) => {
          events.push("simulated");
          expect(simResult.success).toBe(true);
          expect(preview).toContain("ETH");
        },
        onGuardrails: async (checks) => {
          events.push("guardrails");
          expect(checks.every((c) => c.passed)).toBe(true);
        },
        onBroadcast: async (hash) => {
          events.push("broadcast");
          expect(hash).toMatch(/^0x/);
        },
        onConfirmed: async (hash, blockNumber) => {
          events.push("confirmed");
          expect(blockNumber).toBeGreaterThan(0n);
        },
      },
    );

    expect(result.success).toBe(true);
    expect(events).toEqual(["simulated", "guardrails", "broadcast", "confirmed"]);
  });
});
