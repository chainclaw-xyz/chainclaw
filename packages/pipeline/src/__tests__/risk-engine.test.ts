import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Address } from "viem";
import { RiskEngine } from "../risk/engine.js";
import { RiskCache } from "../risk/cache.js";
import { Guardrails } from "../guardrails.js";
import type { TokenSafetyReport } from "../risk/types.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  // Create tx_log table needed by guardrails
  new Guardrails(db);
  return db;
}

function makeSafeReport(): TokenSafetyReport {
  return {
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" as Address,
    chainId: 1,
    symbol: "USDC",
    name: "USD Coin",
    overallScore: 5,
    riskLevel: "safe",
    dimensions: [],
    isHoneypot: false,
    canTakeBackOwnership: false,
    hasMintFunction: false,
    canBlacklist: false,
    hasTradingCooldown: false,
    buyTax: 0,
    sellTax: 0,
    holderCount: 1000000,
    topHolderPercent: 10,
    liquidityUsd: 1000000000,
    isOpenSource: true,
    cachedAt: new Date().toISOString(),
  };
}

function makeHoneypotReport(): TokenSafetyReport {
  return {
    address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Address,
    chainId: 1,
    symbol: "SCAM",
    name: "Scam Token",
    overallScore: 95,
    riskLevel: "critical",
    dimensions: [
      { name: "honeypot", severity: "critical", description: "Honeypot", score: 100 },
    ],
    isHoneypot: true,
    canTakeBackOwnership: true,
    hasMintFunction: true,
    canBlacklist: true,
    hasTradingCooldown: false,
    buyTax: 50,
    sellTax: 99,
    holderCount: 10,
    topHolderPercent: 95,
    liquidityUsd: 100,
    isOpenSource: false,
    cachedAt: new Date().toISOString(),
  };
}

describe("RiskEngine", () => {
  let db: Database.Database;
  let engine: RiskEngine;

  beforeEach(() => {
    db = createTestDb();
    engine = new RiskEngine(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("shouldBlock", () => {
    it("blocks contracts on user blocklist", async () => {
      engine.blockContract("user1", "0xdead", 1, "Known scam");

      const result = await engine.shouldBlock("user1", 1, "0xdead" as Address);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("blocklist");
    });

    it("allows contracts on user allowlist without risk check", async () => {
      engine.allowContract("user1", "0xbeef", 1, "Trusted");

      const result = await engine.shouldBlock("user1", 1, "0xbeef" as Address);
      expect(result.blocked).toBe(false);
      expect(result.reason).toContain("allowlist");
    });

    it("blocks honeypot tokens from cache", async () => {
      // Seed the cache with a honeypot report
      const cache = new RiskCache(db);
      cache.cacheReport(makeHoneypotReport());

      const result = await engine.shouldBlock(
        "user1",
        1,
        "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Address,
      );
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("honeypot");
    });

    it("allows safe tokens from cache", async () => {
      const cache = new RiskCache(db);
      cache.cacheReport(makeSafeReport());

      const result = await engine.shouldBlock(
        "user1",
        1,
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" as Address,
      );
      expect(result.blocked).toBe(false);
    });

    it("auto-blocks tokens above threshold", async () => {
      const engineStrict = new RiskEngine(db, { autoBlockThreshold: 50 });
      const cache = new RiskCache(db);

      const riskyReport = makeSafeReport();
      riskyReport.overallScore = 60;
      riskyReport.riskLevel = "high";
      riskyReport.address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
      cache.cacheReport(riskyReport);

      const result = await engineStrict.shouldBlock(
        "user1",
        1,
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address,
      );
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("Auto-blocked");
    });
  });

  describe("needsWarning", () => {
    it("warns for medium risk", () => {
      const report = makeSafeReport();
      report.overallScore = 45;
      expect(engine.needsWarning(report)).toBe(true);
    });

    it("does not warn for safe tokens", () => {
      const report = makeSafeReport();
      report.overallScore = 10;
      expect(engine.needsWarning(report)).toBe(false);
    });
  });

  describe("contract list management", () => {
    it("adds and removes from allowlist", () => {
      engine.allowContract("user1", "0xabc", 1, "Trusted");

      let list = engine.getUserList("user1");
      expect(list).toHaveLength(1);
      expect(list[0].action).toBe("allow");

      const removed = engine.removeFromList("user1", "0xabc", 1);
      expect(removed).toBe(true);

      list = engine.getUserList("user1");
      expect(list).toHaveLength(0);
    });
  });

  describe("formatRiskReport", () => {
    it("formats safe token report", () => {
      const report = makeSafeReport();
      const formatted = engine.formatRiskReport(report);

      expect(formatted).toContain("USDC");
      expect(formatted).toContain("SAFE");
      expect(formatted).toContain("No significant risks");
    });

    it("formats honeypot report with warnings", () => {
      const report = makeHoneypotReport();
      const formatted = engine.formatRiskReport(report);

      expect(formatted).toContain("SCAM");
      expect(formatted).toContain("CRITICAL");
      expect(formatted).toContain("Honeypot");
      expect(formatted).toContain("YES");
    });
  });
});
