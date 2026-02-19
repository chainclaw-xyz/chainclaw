import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { RiskCache } from "../risk/cache.js";
import type { TokenSafetyReport } from "../risk/types.js";
import type { Address } from "viem";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  return db;
}

function makeFakeReport(overrides?: Partial<TokenSafetyReport>): TokenSafetyReport {
  return {
    address: "0x1234567890abcdef1234567890abcdef12345678" as Address,
    chainId: 1,
    symbol: "SCAM",
    name: "Scam Token",
    overallScore: 75,
    riskLevel: "high",
    dimensions: [
      { name: "honeypot", severity: "critical", description: "Honeypot detected", score: 100 },
    ],
    isHoneypot: true,
    canTakeBackOwnership: false,
    hasMintFunction: false,
    canBlacklist: false,
    hasTradingCooldown: false,
    buyTax: 0,
    sellTax: 0,
    holderCount: 50,
    topHolderPercent: 80,
    liquidityUsd: 1000,
    isOpenSource: false,
    cachedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("RiskCache", () => {
  let db: Database.Database;
  let cache: RiskCache;

  beforeEach(() => {
    db = createTestDb();
    cache = new RiskCache(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("report caching", () => {
    it("caches and retrieves a risk report", () => {
      const report = makeFakeReport();
      cache.cacheReport(report);

      const cached = cache.getCachedReport(report.address, report.chainId);
      expect(cached).toBeDefined();
      expect(cached!.symbol).toBe("SCAM");
      expect(cached!.overallScore).toBe(75);
      expect(cached!.isHoneypot).toBe(true);
    });

    it("returns null for uncached address", () => {
      const result = cache.getCachedReport("0xdead", 1);
      expect(result).toBeNull();
    });

    it("normalizes address to lowercase", () => {
      const report = makeFakeReport({
        address: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" as Address,
      });
      cache.cacheReport(report);

      const cached = cache.getCachedReport(
        "0xabcdef1234567890abcdef1234567890abcdef12",
        1,
      );
      expect(cached).toBeDefined();
    });

    it("overwrites existing cache entry", () => {
      const report1 = makeFakeReport({ overallScore: 50 });
      cache.cacheReport(report1);

      const report2 = makeFakeReport({ overallScore: 90 });
      cache.cacheReport(report2);

      const cached = cache.getCachedReport(report1.address, report1.chainId);
      expect(cached!.overallScore).toBe(90);
    });
  });

  describe("contract allowlist/blocklist", () => {
    it("blocks a contract", () => {
      cache.setContractAction("user1", "0xdead", 1, "block", "Known scam");
      expect(cache.isBlocked("user1", "0xdead", 1)).toBe(true);
      expect(cache.isAllowed("user1", "0xdead", 1)).toBe(false);
    });

    it("allows a contract", () => {
      cache.setContractAction("user1", "0xbeef", 1, "allow", "Trusted");
      expect(cache.isAllowed("user1", "0xbeef", 1)).toBe(true);
      expect(cache.isBlocked("user1", "0xbeef", 1)).toBe(false);
    });

    it("returns null for unknown contract", () => {
      const action = cache.getContractAction("user1", "0xunknown", 1);
      expect(action).toBeNull();
    });

    it("updates existing entry when action changes", () => {
      cache.setContractAction("user1", "0xdead", 1, "block", "Scam");
      cache.setContractAction("user1", "0xdead", 1, "allow", "Actually safe");

      expect(cache.isAllowed("user1", "0xdead", 1)).toBe(true);
      expect(cache.isBlocked("user1", "0xdead", 1)).toBe(false);
    });

    it("removes contract from list", () => {
      cache.setContractAction("user1", "0xdead", 1, "block", "Scam");
      const removed = cache.removeContractAction("user1", "0xdead", 1);
      expect(removed).toBe(true);
      expect(cache.isBlocked("user1", "0xdead", 1)).toBe(false);
    });

    it("returns false when removing non-existent entry", () => {
      const removed = cache.removeContractAction("user1", "0xnope", 1);
      expect(removed).toBe(false);
    });

    it("isolates lists per user", () => {
      cache.setContractAction("user1", "0xdead", 1, "block", "Scam");
      cache.setContractAction("user2", "0xdead", 1, "allow", "I trust it");

      expect(cache.isBlocked("user1", "0xdead", 1)).toBe(true);
      expect(cache.isAllowed("user2", "0xdead", 1)).toBe(true);
    });

    it("retrieves user list", () => {
      cache.setContractAction("user1", "0xaaa", 1, "block", "Bad");
      cache.setContractAction("user1", "0xbbb", 1, "allow", "Good");
      cache.setContractAction("user2", "0xccc", 1, "block", "Other user");

      const list = cache.getUserList("user1");
      expect(list).toHaveLength(2);
    });
  });
});
