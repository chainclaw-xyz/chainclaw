import { describe, it, expect } from "vitest";
import { RiskProfiles, type RiskProfileName } from "../risk-profiles.js";

describe("RiskProfiles", () => {
  it("lists all 3 profiles", () => {
    const profiles = RiskProfiles.list();
    expect(profiles).toHaveLength(3);
    expect(profiles.map((p) => p.name).sort()).toEqual(["aggressive", "conservative", "moderate"]);
  });

  it("gets a profile by name", () => {
    const profile = RiskProfiles.get("moderate");
    expect(profile.name).toBe("moderate");
    expect(profile.maxPerTxPct).toBe(15);
    expect(profile.maxPerDayPct).toBe(40);
    expect(profile.cooldownSeconds).toBe(30);
    expect(profile.slippageBps).toBe(100);
    expect(profile.maxPositions).toBe(5);
  });

  describe("computeLimits", () => {
    it("scales limits to portfolio value", () => {
      const limits = RiskProfiles.computeLimits("moderate", 10_000);
      expect(limits.maxPerTx).toBe(1500);  // 15% of 10k
      expect(limits.maxPerDay).toBe(4000); // 40% of 10k
      expect(limits.cooldownSeconds).toBe(30);
      expect(limits.slippageBps).toBe(100);
    });

    it("conservative is more restrictive", () => {
      const limits = RiskProfiles.computeLimits("conservative", 10_000);
      expect(limits.maxPerTx).toBe(500);   // 5% of 10k
      expect(limits.maxPerDay).toBe(1500); // 15% of 10k
      expect(limits.cooldownSeconds).toBe(60);
      expect(limits.slippageBps).toBe(50);
    });

    it("aggressive allows more", () => {
      const limits = RiskProfiles.computeLimits("aggressive", 10_000);
      expect(limits.maxPerTx).toBe(3000);  // 30% of 10k
      expect(limits.maxPerDay).toBe(8000); // 80% of 10k
      expect(limits.cooldownSeconds).toBe(10);
      expect(limits.slippageBps).toBe(300);
    });

    it("enforces minimum floors for tiny portfolios", () => {
      const limits = RiskProfiles.computeLimits("conservative", 50);
      expect(limits.maxPerTx).toBeGreaterThanOrEqual(10);
      expect(limits.maxPerDay).toBeGreaterThanOrEqual(50);
    });

    it("scales correctly for large portfolios", () => {
      const limits = RiskProfiles.computeLimits("moderate", 100_000);
      expect(limits.maxPerTx).toBe(15_000);  // 15% of 100k
      expect(limits.maxPerDay).toBe(40_000); // 40% of 100k
    });
  });

  describe("formatProfile", () => {
    it("formats without portfolio value", () => {
      const formatted = RiskProfiles.formatProfile("moderate");
      expect(formatted).toContain("Moderate Risk Profile");
      expect(formatted).toContain("15%");
      expect(formatted).toContain("40%");
      expect(formatted).not.toContain("$");
    });

    it("formats with portfolio value", () => {
      const formatted = RiskProfiles.formatProfile("moderate", 10_000);
      expect(formatted).toContain("$10,000");
      expect(formatted).toContain("$1,500");
      expect(formatted).toContain("$4,000");
    });
  });

  it("profiles have increasing risk tolerance", () => {
    const profiles: RiskProfileName[] = ["conservative", "moderate", "aggressive"];
    for (let i = 1; i < profiles.length; i++) {
      const prev = RiskProfiles.get(profiles[i - 1]);
      const curr = RiskProfiles.get(profiles[i]);

      expect(curr.maxPerTxPct).toBeGreaterThan(prev.maxPerTxPct);
      expect(curr.maxPerDayPct).toBeGreaterThan(prev.maxPerDayPct);
      expect(curr.cooldownSeconds).toBeLessThan(prev.cooldownSeconds);
      expect(curr.maxPositions).toBeGreaterThan(prev.maxPositions);
    }
  });
});
