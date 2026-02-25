import { z } from "zod";
import type Database from "better-sqlite3";
import { getLogger, triggerHook, createHookEvent, type SkillResult } from "@chainclaw/core";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";
import { getTokenPrice } from "./prices.js";
import { resolveToken } from "./token-addresses.js";

const logger = getLogger("skill-trailing-stop");

// ─── Types ──────────────────────────────────────────────────

export interface TrailingStopTier {
  triggerPct: number;       // % gain from entry to activate this tier
  lockPct: number;          // % of high-water mark to lock as floor
  retrace: number;          // max trailing distance from high-water (%)
  breachesRequired: number; // consecutive checks below floor to trigger close
}

export interface TrailingStopPreset {
  name: string;
  phase1RetracePct: number;       // Phase 1 (pre-tier) max retrace from entry
  phase1MaxDurationMin: number;   // Auto-cut if no tier hit within this time
  phase1BreachesRequired: number; // Consecutive breaches to close in Phase 1
  tiers: TrailingStopTier[];
  stagnationPct: number;          // Take profit if gain > this % and stagnant
  stagnationMinutes: number;      // Duration of stagnation before take-profit
}

interface TrailingStopRow {
  id: number;
  user_id: string;
  token: string;
  chain_id: number;
  amount: string;
  entry_price: number;
  current_tier: number;       // 0 = Phase 1, 1-N = tier index + 1
  high_water: number;
  floor_price: number;
  breach_count: number;
  high_water_updated_at: number; // epoch ms
  status: string;
  preset: string;
  created_at: string;
}

// ─── Presets ────────────────────────────────────────────────

const PRESETS: Record<string, TrailingStopPreset> = {
  conservative: {
    name: "conservative",
    phase1RetracePct: 5,
    phase1MaxDurationMin: 120,
    phase1BreachesRequired: 3,
    tiers: [
      { triggerPct: 3,  lockPct: 40, retrace: 4,   breachesRequired: 3 },
      { triggerPct: 6,  lockPct: 50, retrace: 3.5, breachesRequired: 2 },
      { triggerPct: 10, lockPct: 60, retrace: 3,   breachesRequired: 2 },
      { triggerPct: 15, lockPct: 70, retrace: 2.5, breachesRequired: 2 },
      { triggerPct: 20, lockPct: 80, retrace: 2,   breachesRequired: 1 },
      { triggerPct: 30, lockPct: 85, retrace: 1.5, breachesRequired: 1 },
    ],
    stagnationPct: 8,
    stagnationMinutes: 90,
  },
  moderate: {
    name: "moderate",
    phase1RetracePct: 4,
    phase1MaxDurationMin: 90,
    phase1BreachesRequired: 3,
    tiers: [
      { triggerPct: 5,  lockPct: 50, retrace: 3,   breachesRequired: 2 },
      { triggerPct: 10, lockPct: 65, retrace: 2.5, breachesRequired: 2 },
      { triggerPct: 15, lockPct: 75, retrace: 2,   breachesRequired: 2 },
      { triggerPct: 20, lockPct: 85, retrace: 1.5, breachesRequired: 1 },
    ],
    stagnationPct: 8,
    stagnationMinutes: 60,
  },
  aggressive: {
    name: "aggressive",
    phase1RetracePct: 3,
    phase1MaxDurationMin: 60,
    phase1BreachesRequired: 2,
    tiers: [
      { triggerPct: 4,  lockPct: 55, retrace: 2.5, breachesRequired: 2 },
      { triggerPct: 8,  lockPct: 70, retrace: 2,   breachesRequired: 1 },
      { triggerPct: 15, lockPct: 80, retrace: 1.5, breachesRequired: 1 },
      { triggerPct: 20, lockPct: 90, retrace: 1,   breachesRequired: 1 },
    ],
    stagnationPct: 6,
    stagnationMinutes: 45,
  },
};

// ─── Trailing Stop Engine ───────────────────────────────────

export class TrailingStopEngine {
  private db: Database.Database;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private onTrigger: ((stop: TrailingStopRow) => Promise<void>) | null = null;

  constructor(db: Database.Database) {
    this.db = db;
    this.initTable();
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trailing_stops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        token TEXT NOT NULL,
        chain_id INTEGER NOT NULL DEFAULT 1,
        amount TEXT NOT NULL,
        entry_price REAL NOT NULL,
        current_tier INTEGER NOT NULL DEFAULT 0,
        high_water REAL NOT NULL,
        floor_price REAL NOT NULL,
        breach_count INTEGER NOT NULL DEFAULT 0,
        high_water_updated_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'triggered', 'cancelled', 'expired')),
        preset TEXT NOT NULL DEFAULT 'moderate',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_trailing_stops_user ON trailing_stops(user_id);
      CREATE INDEX IF NOT EXISTS idx_trailing_stops_status ON trailing_stops(status);
    `);
    logger.debug("Trailing stops table initialized");
  }

  /**
   * Set callback for when a trailing stop triggers (auto-sell).
   */
  setTriggerCallback(cb: (stop: TrailingStopRow) => Promise<void>): void {
    this.onTrigger = cb;
  }

  /**
   * Create a new trailing stop for a token position.
   */
  create(
    userId: string,
    token: string,
    amount: string,
    entryPrice: number,
    chainId: number,
    preset: string = "moderate",
  ): number {
    const presetConfig = PRESETS[preset];
    if (!presetConfig) throw new Error(`Unknown preset: ${preset}`);

    // Phase 1 floor: entry price minus phase1RetracePct
    const floorPrice = entryPrice * (1 - presetConfig.phase1RetracePct / 100);

    const result = this.db.prepare(
      `INSERT INTO trailing_stops (user_id, token, chain_id, amount, entry_price, current_tier, high_water, floor_price, breach_count, high_water_updated_at, preset)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?)`,
    ).run(userId, token.toUpperCase(), chainId, amount, entryPrice, entryPrice, floorPrice, Date.now(), preset);

    const id = Number(result.lastInsertRowid);
    logger.info({ id, token, entryPrice, preset, floorPrice }, "Trailing stop created");
    return id;
  }

  /**
   * Get all active stops for a user.
   */
  getActiveStops(userId?: string): TrailingStopRow[] {
    if (userId) {
      return this.db.prepare(
        "SELECT * FROM trailing_stops WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC",
      ).all(userId) as TrailingStopRow[];
    }
    return this.db.prepare(
      "SELECT * FROM trailing_stops WHERE status = 'active' ORDER BY created_at DESC",
    ).all() as TrailingStopRow[];
  }

  /**
   * Cancel a trailing stop.
   */
  cancel(stopId: number, userId: string): boolean {
    const result = this.db.prepare(
      "UPDATE trailing_stops SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'active'",
    ).run(stopId, userId);
    return result.changes > 0;
  }

  /**
   * Core price check logic. Called periodically for each active stop.
   * Returns the action taken: 'none' | 'tier_up' | 'triggered' | 'breach' | 'stagnation_close'
   */
  checkPrice(stop: TrailingStopRow, currentPrice: number): string {
    const preset = PRESETS[stop.preset];
    if (!preset) return "none";

    const now = Date.now();
    const gainPct = ((currentPrice - stop.entry_price) / stop.entry_price) * 100;

    // ─── Update high-water mark ───
    if (currentPrice > stop.high_water) {
      this.db.prepare(
        "UPDATE trailing_stops SET high_water = ?, high_water_updated_at = ? WHERE id = ?",
      ).run(currentPrice, now, stop.id);
      stop.high_water = currentPrice;
      stop.high_water_updated_at = now;
    }

    // ─── Check tier progression ───
    const currentTierIdx = stop.current_tier; // 0 = Phase 1
    let newTierIdx = currentTierIdx;

    for (let i = preset.tiers.length - 1; i >= 0; i--) {
      if (gainPct >= preset.tiers[i].triggerPct && i + 1 > currentTierIdx) {
        newTierIdx = i + 1; // Tier indices are 1-based
        break;
      }
    }

    if (newTierIdx > currentTierIdx) {
      // Tier upgraded — compute new floor from high-water
      const tier = preset.tiers[newTierIdx - 1];
      const newFloor = stop.high_water * (tier.lockPct / 100);

      this.db.prepare(
        "UPDATE trailing_stops SET current_tier = ?, floor_price = ?, breach_count = 0 WHERE id = ?",
      ).run(newTierIdx, newFloor, stop.id);

      logger.info({ stopId: stop.id, token: stop.token, oldTier: currentTierIdx, newTier: newTierIdx, newFloor }, "Tier upgraded");
      void triggerHook(createHookEvent("tx", "trailing_stop_tier_changed", {
        stopId: stop.id, token: stop.token, tier: newTierIdx, floor: newFloor,
      }));

      stop.current_tier = newTierIdx;
      stop.floor_price = newFloor;
      stop.breach_count = 0;
      return "tier_up";
    }

    // ─── If in a tier, update trailing floor (ratchet up, never down) ───
    if (currentTierIdx > 0) {
      const tier = preset.tiers[currentTierIdx - 1];
      const trailingFloor = stop.high_water * (1 - tier.retrace / 100);
      const lockFloor = stop.high_water * (tier.lockPct / 100);
      const bestFloor = Math.max(trailingFloor, lockFloor);

      if (bestFloor > stop.floor_price) {
        this.db.prepare("UPDATE trailing_stops SET floor_price = ? WHERE id = ?").run(bestFloor, stop.id);
        stop.floor_price = bestFloor;
      }
    }

    // ─── Check floor breach ───
    const breachesRequired = currentTierIdx === 0
      ? preset.phase1BreachesRequired
      : preset.tiers[currentTierIdx - 1].breachesRequired;

    if (currentPrice < stop.floor_price) {
      const newBreachCount = stop.breach_count + 1;
      this.db.prepare("UPDATE trailing_stops SET breach_count = ? WHERE id = ?").run(newBreachCount, stop.id);

      if (newBreachCount >= breachesRequired) {
        this.triggerStop(stop, "floor_breach");
        return "triggered";
      }
      return "breach";
    } else {
      // Reset breach count if price recovers
      if (stop.breach_count > 0) {
        this.db.prepare("UPDATE trailing_stops SET breach_count = 0 WHERE id = ?").run(stop.id);
      }
    }

    // ─── Phase 1 auto-cut: max duration ───
    if (currentTierIdx === 0) {
      // SQLite datetime('now') returns UTC without Z suffix; append Z for correct parsing
      const createdAt = new Date(stop.created_at.endsWith("Z") ? stop.created_at : stop.created_at + "Z").getTime();
      const elapsedMin = (now - createdAt) / 60_000;
      if (elapsedMin >= preset.phase1MaxDurationMin) {
        this.triggerStop(stop, "phase1_timeout");
        return "triggered";
      }
    }

    // ─── Stagnation take-profit ───
    if (gainPct >= preset.stagnationPct) {
      const stagnantMs = now - stop.high_water_updated_at;
      if (stagnantMs >= preset.stagnationMinutes * 60_000) {
        this.triggerStop(stop, "stagnation_tp");
        return "triggered";
      }
    }

    return "none";
  }

  /**
   * Run a check cycle for all active stops.
   */
  async checkAll(): Promise<{ checked: number; triggered: number; errors: number }> {
    const stops = this.getActiveStops();
    let triggered = 0;
    let errors = 0;

    for (const stop of stops) {
      try {
        const price = await getTokenPrice(stop.token);
        if (price === null) {
          logger.warn({ token: stop.token }, "Could not fetch price for trailing stop");
          errors++;
          continue;
        }

        const action = this.checkPrice(stop, price);
        if (action === "triggered") triggered++;
      } catch (err) {
        logger.error({ err, stopId: stop.id }, "Error checking trailing stop");
        errors++;
      }
    }

    return { checked: stops.length, triggered, errors };
  }

  /**
   * Start periodic monitoring. Typically called once at app startup.
   */
  startMonitoring(intervalMs: number = 60_000): void {
    if (this.checkInterval) return;
    this.checkInterval = setInterval(() => {
      void this.checkAll();
    }, intervalMs);

    if (this.checkInterval.unref) {
      this.checkInterval.unref();
    }
    logger.info({ intervalMs }, "Trailing stop monitoring started");
  }

  /**
   * Stop periodic monitoring.
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private triggerStop(stop: TrailingStopRow, reason: string): void {
    this.db.prepare("UPDATE trailing_stops SET status = 'triggered' WHERE id = ?").run(stop.id);
    logger.info({ stopId: stop.id, token: stop.token, reason, tier: stop.current_tier }, "Trailing stop triggered");

    void triggerHook(createHookEvent("tx", "trailing_stop_triggered", {
      stopId: stop.id, token: stop.token, reason, tier: stop.current_tier, entryPrice: stop.entry_price, floor: stop.floor_price,
    }));

    if (this.onTrigger) {
      void this.onTrigger(stop);
    }
  }
}

// ─── Skill Definition ───────────────────────────────────────

const trailingStopParams = z.object({
  action: z.enum(["create", "list", "cancel"]).default("create"),
  token: z.string().optional(),
  amount: z.string().optional(),
  entryPrice: z.number().optional(),
  preset: z.enum(["conservative", "moderate", "aggressive"]).default("moderate"),
  chainId: z.number().default(1),
  stopId: z.number().optional(),
});

export function createTrailingStopSkill(db: Database.Database): SkillDefinition & { engine: TrailingStopEngine } {
  const engine = new TrailingStopEngine(db);

  const skill: SkillDefinition & { engine: TrailingStopEngine } = {
    name: "trailing-stop",
    description: "Create, list, or cancel trailing stop orders with tier-based profit locking",
    parameters: trailingStopParams,
    engine,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = trailingStopParams.parse(params);

      switch (parsed.action) {
        case "create": {
          if (!parsed.token) return { success: false, message: "Token symbol is required for creating a trailing stop." };
          if (!parsed.amount) return { success: false, message: "Amount is required for creating a trailing stop." };

          const tokenInfo = resolveToken(parsed.chainId, parsed.token);
          if (!tokenInfo) return { success: false, message: `Unknown token ${parsed.token} on chain ${parsed.chainId}.` };

          // Get entry price from param or current market price
          let entryPrice = parsed.entryPrice;
          if (!entryPrice) {
            const price = await getTokenPrice(parsed.token);
            if (!price) return { success: false, message: `Could not fetch current price for ${parsed.token}. Specify entryPrice manually.` };
            entryPrice = price;
          }

          const presetConfig = PRESETS[parsed.preset];
          const floorPct = presetConfig.phase1RetracePct;
          const preview = [
            `**Trailing Stop Preview**`,
            `Token: ${parsed.token} | Chain: ${parsed.chainId}`,
            `Amount: ${parsed.amount} | Entry: $${entryPrice.toFixed(2)}`,
            `Preset: ${parsed.preset} | Phase 1 floor: -${floorPct}% ($${(entryPrice * (1 - floorPct / 100)).toFixed(2)})`,
            `Tiers: ${presetConfig.tiers.map((t, i) => `T${i + 1} at +${t.triggerPct}%`).join(", ")}`,
            `Stagnation TP: +${presetConfig.stagnationPct}% stale for ${presetConfig.stagnationMinutes}min`,
          ].join("\n");

          if (context.requestConfirmation) {
            const confirmed = await context.requestConfirmation(preview);
            if (!confirmed) return { success: false, message: "Trailing stop cancelled." };
          }

          const id = engine.create(context.userId, parsed.token, parsed.amount, entryPrice, parsed.chainId, parsed.preset);
          const msg = `Trailing stop #${id} created for ${parsed.amount} ${parsed.token} at $${entryPrice.toFixed(2)} (${parsed.preset} preset)`;
          await context.sendReply(msg);
          return { success: true, message: msg, data: { stopId: id } };
        }

        case "list": {
          const stops = engine.getActiveStops(context.userId);
          if (stops.length === 0) {
            return { success: true, message: "No active trailing stops." };
          }

          const lines = ["**Active Trailing Stops**", ""];
          for (const s of stops) {
            const gainPct = ((s.high_water - s.entry_price) / s.entry_price * 100).toFixed(1);
            const tierLabel = s.current_tier === 0 ? "Phase 1" : `Tier ${s.current_tier}`;
            lines.push(
              `#${s.id} | ${s.token} | ${s.amount} | Entry: $${s.entry_price.toFixed(2)} | HW: $${s.high_water.toFixed(2)} (+${gainPct}%) | Floor: $${s.floor_price.toFixed(2)} | ${tierLabel} | ${s.preset}`,
            );
          }

          const msg = lines.join("\n");
          await context.sendReply(msg);
          return { success: true, message: msg };
        }

        case "cancel": {
          if (!parsed.stopId) return { success: false, message: "Stop ID is required for cancellation." };
          const cancelled = engine.cancel(parsed.stopId, context.userId);
          if (!cancelled) return { success: false, message: `Trailing stop #${parsed.stopId} not found or already closed.` };

          const msg = `Trailing stop #${parsed.stopId} cancelled.`;
          await context.sendReply(msg);
          return { success: true, message: msg };
        }
      }
    },
  };

  return skill;
}

export { PRESETS as TRAILING_STOP_PRESETS };
