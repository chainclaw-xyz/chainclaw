import { describe, it, expect } from "vitest";
import { computeNextRunAtMs } from "../schedule.js";

describe("computeNextRunAtMs", () => {
  const NOW = 1_700_000_000_000; // Fixed reference point

  describe("at schedule", () => {
    it("returns the timestamp if in the future", () => {
      const future = NOW + 60_000;
      expect(computeNextRunAtMs({ kind: "at", at: future }, NOW)).toBe(future);
    });

    it("returns undefined if the time is in the past", () => {
      const past = NOW - 1000;
      expect(computeNextRunAtMs({ kind: "at", at: past }, NOW)).toBeUndefined();
    });

    it("returns undefined if the time equals now", () => {
      expect(computeNextRunAtMs({ kind: "at", at: NOW }, NOW)).toBeUndefined();
    });

    it("parses ISO string dates", () => {
      const isoDate = new Date(NOW + 3600_000).toISOString();
      const result = computeNextRunAtMs({ kind: "at", at: isoDate }, NOW);
      expect(result).toBeGreaterThan(NOW);
    });

    it("throws for invalid date strings", () => {
      expect(() =>
        computeNextRunAtMs({ kind: "at", at: "not-a-date" }, NOW),
      ).toThrow("Invalid date");
    });
  });

  describe("every schedule", () => {
    it("returns anchor-aligned next run", () => {
      const anchor = NOW - 5000;
      const result = computeNextRunAtMs(
        { kind: "every", everyMs: 10_000, anchorMs: anchor },
        NOW,
      );
      // anchor + 10_000 = NOW + 5000
      expect(result).toBe(anchor + 10_000);
    });

    it("defaults anchor to now when not specified", () => {
      const result = computeNextRunAtMs(
        { kind: "every", everyMs: 60_000 },
        NOW,
      );
      // With anchor=NOW, next should be NOW + 60_000
      expect(result).toBe(NOW + 60_000);
    });

    it("returns anchor if now is before anchor", () => {
      const anchor = NOW + 5000;
      const result = computeNextRunAtMs(
        { kind: "every", everyMs: 10_000, anchorMs: anchor },
        NOW,
      );
      expect(result).toBe(anchor);
    });

    it("skips past intervals", () => {
      const anchor = NOW - 25_000;
      const result = computeNextRunAtMs(
        { kind: "every", everyMs: 10_000, anchorMs: anchor },
        NOW,
      );
      // anchor + 30_000 = NOW + 5_000
      expect(result).toBe(anchor + 30_000);
    });

    it("handles zero everyMs gracefully (floors to 1ms)", () => {
      const result = computeNextRunAtMs(
        { kind: "every", everyMs: 0 },
        NOW,
      );
      expect(result).toBeGreaterThan(NOW);
    });
  });

  describe("cron schedule", () => {
    it("computes next run for a simple cron expression", () => {
      // Every minute
      const result = computeNextRunAtMs(
        { kind: "cron", expr: "* * * * *" },
        NOW,
      );
      expect(result).toBeDefined();
      expect(result!).toBeGreaterThan(NOW);
      // Should be within the next 60 seconds
      expect(result! - NOW).toBeLessThanOrEqual(60_000);
    });

    it("supports timezone", () => {
      const result = computeNextRunAtMs(
        { kind: "cron", expr: "0 12 * * *", tz: "America/New_York" },
        NOW,
      );
      expect(result).toBeDefined();
      expect(result!).toBeGreaterThan(NOW);
    });

    it("defaults to UTC timezone", () => {
      const result = computeNextRunAtMs(
        { kind: "cron", expr: "0 0 * * *" },
        NOW,
      );
      expect(result).toBeDefined();
      expect(result!).toBeGreaterThan(NOW);
    });
  });
});
