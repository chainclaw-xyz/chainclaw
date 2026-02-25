import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { TrailingStopEngine, TRAILING_STOP_PRESETS } from "../trailing-stop.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  return db;
}

describe("TrailingStopEngine", () => {
  let db: Database.Database;
  let engine: TrailingStopEngine;

  beforeEach(() => {
    db = createTestDb();
    engine = new TrailingStopEngine(db);
  });

  afterEach(() => {
    engine.stopMonitoring();
    db.close();
  });

  describe("create", () => {
    it("creates a trailing stop with correct Phase 1 floor", () => {
      const id = engine.create("user1", "ETH", "1.0", 2500, 1, "moderate");
      expect(id).toBeGreaterThan(0);

      const stops = engine.getActiveStops("user1");
      expect(stops).toHaveLength(1);
      expect(stops[0].token).toBe("ETH");
      expect(stops[0].entry_price).toBe(2500);
      expect(stops[0].high_water).toBe(2500);
      expect(stops[0].current_tier).toBe(0); // Phase 1

      // Moderate preset has 4% phase1 retrace
      const expectedFloor = 2500 * (1 - 4 / 100); // 2400
      expect(stops[0].floor_price).toBe(expectedFloor);
    });

    it("throws for unknown preset", () => {
      expect(() => engine.create("user1", "ETH", "1.0", 2500, 1, "yolo")).toThrow("Unknown preset");
    });

    it("uppercases token symbol", () => {
      engine.create("user1", "eth", "1.0", 2500, 1);
      const stops = engine.getActiveStops("user1");
      expect(stops[0].token).toBe("ETH");
    });
  });

  describe("cancel", () => {
    it("cancels an active stop", () => {
      const id = engine.create("user1", "ETH", "1.0", 2500, 1);
      expect(engine.cancel(id, "user1")).toBe(true);
      expect(engine.getActiveStops("user1")).toHaveLength(0);
    });

    it("returns false for non-existent stop", () => {
      expect(engine.cancel(999, "user1")).toBe(false);
    });

    it("returns false for wrong user", () => {
      const id = engine.create("user1", "ETH", "1.0", 2500, 1);
      expect(engine.cancel(id, "user2")).toBe(false);
    });
  });

  describe("checkPrice — Phase 1", () => {
    it("returns none when price is above floor", () => {
      engine.create("user1", "ETH", "1.0", 2500, 1, "moderate");
      const stop = engine.getActiveStops("user1")[0];
      expect(engine.checkPrice(stop, 2480)).toBe("none");
    });

    it("records a breach when price drops below floor", () => {
      engine.create("user1", "ETH", "1.0", 2500, 1, "moderate");
      let stop = engine.getActiveStops("user1")[0];

      // Floor = 2400 (4% retrace). Price 2390 is below.
      const action = engine.checkPrice(stop, 2390);
      expect(action).toBe("breach");

      stop = engine.getActiveStops("user1")[0];
      expect(stop.breach_count).toBe(1);
    });

    it("triggers after consecutive breaches (moderate = 3)", () => {
      engine.create("user1", "ETH", "1.0", 2500, 1, "moderate");

      // Need 3 consecutive breaches in Phase 1
      for (let i = 0; i < 2; i++) {
        const stop = engine.getActiveStops("user1")[0];
        engine.checkPrice(stop, 2390);
      }

      const stop = engine.getActiveStops("user1")[0];
      expect(stop.breach_count).toBe(2);

      const action = engine.checkPrice(stop, 2390);
      expect(action).toBe("triggered");

      // Stop should no longer be active
      expect(engine.getActiveStops("user1")).toHaveLength(0);
    });

    it("resets breach count when price recovers", () => {
      engine.create("user1", "ETH", "1.0", 2500, 1, "moderate");
      let stop = engine.getActiveStops("user1")[0];

      // 1 breach
      engine.checkPrice(stop, 2390);
      stop = engine.getActiveStops("user1")[0];
      expect(stop.breach_count).toBe(1);

      // Price recovers above floor
      engine.checkPrice(stop, 2450);
      stop = engine.getActiveStops("user1")[0];
      expect(stop.breach_count).toBe(0);
    });
  });

  describe("checkPrice — Tier progression", () => {
    it("upgrades to Tier 1 when gain hits trigger", () => {
      engine.create("user1", "ETH", "1.0", 2500, 1, "moderate");
      let stop = engine.getActiveStops("user1")[0];

      // Moderate Tier 1 triggers at +5% = $2625
      const action = engine.checkPrice(stop, 2650);
      expect(action).toBe("tier_up");

      stop = engine.getActiveStops("user1")[0];
      expect(stop.current_tier).toBe(1);
      // Floor should be lockPct=50% of high_water=2650 = 1325
      expect(stop.floor_price).toBe(2650 * 0.5);
      expect(stop.high_water).toBe(2650);
    });

    it("upgrades directly to highest qualifying tier", () => {
      engine.create("user1", "ETH", "1.0", 2500, 1, "moderate");
      let stop = engine.getActiveStops("user1")[0];

      // +20% = $3000, should skip to Tier 4 (triggerPct=20)
      const action = engine.checkPrice(stop, 3000);
      expect(action).toBe("tier_up");

      stop = engine.getActiveStops("user1")[0];
      expect(stop.current_tier).toBe(4); // Highest tier for moderate
    });

    it("never downgrades tier", () => {
      engine.create("user1", "ETH", "1.0", 2500, 1, "moderate");
      let stop = engine.getActiveStops("user1")[0];

      // Up to Tier 2 (+10%)
      engine.checkPrice(stop, 2800);
      stop = engine.getActiveStops("user1")[0];
      expect(stop.current_tier).toBe(2);

      // Price drops but still above floor — tier stays
      engine.checkPrice(stop, 2600);
      stop = engine.getActiveStops("user1")[0];
      expect(stop.current_tier).toBe(2);
    });

    it("updates high-water mark on new highs", () => {
      engine.create("user1", "ETH", "1.0", 2500, 1, "moderate");
      let stop = engine.getActiveStops("user1")[0];

      engine.checkPrice(stop, 2700);
      stop = engine.getActiveStops("user1")[0];
      expect(stop.high_water).toBe(2700);

      engine.checkPrice(stop, 2800);
      stop = engine.getActiveStops("user1")[0];
      expect(stop.high_water).toBe(2800);

      // Lower price doesn't update high-water
      engine.checkPrice(stop, 2750);
      stop = engine.getActiveStops("user1")[0];
      expect(stop.high_water).toBe(2800);
    });

    it("triggers on floor breach in higher tier", () => {
      engine.create("user1", "ETH", "1.0", 2500, 1, "aggressive");
      let stop = engine.getActiveStops("user1")[0];

      // Aggressive Tier 2 triggers at +8%, lockPct=70%, breachesRequired=1
      // Push to Tier 2
      engine.checkPrice(stop, 2750); // +10%
      stop = engine.getActiveStops("user1")[0];
      expect(stop.current_tier).toBe(2);

      // Floor = 70% of 2750 = 1925. Also trailing retrace = 2% → 2750 * 0.98 = 2695
      // Best floor = max(1925, 2695) = 2695
      // With breachesRequired=1, a single breach triggers
      const action = engine.checkPrice(stop, 2690);
      expect(action).toBe("triggered");
    });
  });

  describe("checkPrice — Stagnation take-profit", () => {
    it("triggers stagnation TP when gain is high but stale", () => {
      engine.create("user1", "ETH", "1.0", 2500, 1, "moderate");
      let stop = engine.getActiveStops("user1")[0];

      // Push price up to +10% (above stagnationPct=8%)
      engine.checkPrice(stop, 2800);
      stop = engine.getActiveStops("user1")[0];

      // Manually backdate high_water_updated_at by 61 minutes (stagnationMinutes=60)
      const staleTime = Date.now() - 61 * 60 * 1000;
      db.prepare("UPDATE trailing_stops SET high_water_updated_at = ? WHERE id = ?").run(staleTime, stop.id);
      stop = engine.getActiveStops("user1")[0];

      const action = engine.checkPrice(stop, 2800);
      expect(action).toBe("triggered");
    });
  });

  describe("presets", () => {
    it("has 3 presets defined", () => {
      expect(Object.keys(TRAILING_STOP_PRESETS)).toHaveLength(3);
      expect(TRAILING_STOP_PRESETS.conservative).toBeDefined();
      expect(TRAILING_STOP_PRESETS.moderate).toBeDefined();
      expect(TRAILING_STOP_PRESETS.aggressive).toBeDefined();
    });

    it("conservative has the widest Phase 1 retrace", () => {
      expect(TRAILING_STOP_PRESETS.conservative.phase1RetracePct).toBeGreaterThan(
        TRAILING_STOP_PRESETS.aggressive.phase1RetracePct,
      );
    });

    it("aggressive has fewer breaches required", () => {
      expect(TRAILING_STOP_PRESETS.aggressive.phase1BreachesRequired).toBeLessThan(
        TRAILING_STOP_PRESETS.conservative.phase1BreachesRequired,
      );
    });
  });
});
