import { getLogger } from "@chainclaw/core";
import type { UserLimits } from "./types.js";

const logger = getLogger("risk-profiles");

// ─── Types ──────────────────────────────────────────────────

export type RiskProfileName = "conservative" | "moderate" | "aggressive";

export interface RiskProfile {
  name: RiskProfileName;
  maxPerTxPct: number;      // % of portfolio per transaction
  maxPerDayPct: number;     // % of portfolio per day
  cooldownSeconds: number;
  slippageBps: number;
  maxPositions: number;
  trailingStopPreset: string;
}

// ─── Profiles ───────────────────────────────────────────────

const PROFILES: Record<RiskProfileName, RiskProfile> = {
  conservative: {
    name: "conservative",
    maxPerTxPct: 5,
    maxPerDayPct: 15,
    cooldownSeconds: 60,
    slippageBps: 50,
    maxPositions: 3,
    trailingStopPreset: "conservative",
  },
  moderate: {
    name: "moderate",
    maxPerTxPct: 15,
    maxPerDayPct: 40,
    cooldownSeconds: 30,
    slippageBps: 100,
    maxPositions: 5,
    trailingStopPreset: "moderate",
  },
  aggressive: {
    name: "aggressive",
    maxPerTxPct: 30,
    maxPerDayPct: 80,
    cooldownSeconds: 10,
    slippageBps: 300,
    maxPositions: 10,
    trailingStopPreset: "aggressive",
  },
};

// ─── Profile Manager ────────────────────────────────────────

/**
 * Computes UserLimits dynamically based on portfolio value and risk profile.
 *
 * Usage:
 * ```ts
 * const limits = RiskProfiles.computeLimits("moderate", 10_000);
 * // { maxPerTx: 1500, maxPerDay: 4000, cooldownSeconds: 30, slippageBps: 100 }
 * ```
 */
export const RiskProfiles = {
  /**
   * Get a profile definition by name.
   */
  get(name: RiskProfileName): RiskProfile {
    return PROFILES[name];
  },

  /**
   * List all available profiles.
   */
  list(): RiskProfile[] {
    return Object.values(PROFILES);
  },

  /**
   * Compute concrete UserLimits from a profile and portfolio value.
   */
  computeLimits(profileName: RiskProfileName, portfolioValueUsd: number): UserLimits {
    const profile = PROFILES[profileName];

    const limits: UserLimits = {
      maxPerTx: Math.round(portfolioValueUsd * profile.maxPerTxPct / 100),
      maxPerDay: Math.round(portfolioValueUsd * profile.maxPerDayPct / 100),
      cooldownSeconds: profile.cooldownSeconds,
      slippageBps: profile.slippageBps,
    };

    // Enforce minimum floors so tiny portfolios don't get $0 limits
    limits.maxPerTx = Math.max(limits.maxPerTx, 10);
    limits.maxPerDay = Math.max(limits.maxPerDay, 50);

    logger.debug({ profileName, portfolioValueUsd, limits }, "Risk limits computed");
    return limits;
  },

  /**
   * Format a profile for display.
   */
  formatProfile(profileName: RiskProfileName, portfolioValueUsd?: number): string {
    const profile = PROFILES[profileName];
    const lines = [
      `**${profile.name.charAt(0).toUpperCase() + profile.name.slice(1)} Risk Profile**`,
      `Max per tx: ${profile.maxPerTxPct}% of portfolio`,
      `Max per day: ${profile.maxPerDayPct}% of portfolio`,
      `Cooldown: ${profile.cooldownSeconds}s`,
      `Slippage: ${profile.slippageBps} bps`,
      `Max positions: ${profile.maxPositions}`,
      `Trailing stop: ${profile.trailingStopPreset}`,
    ];

    if (portfolioValueUsd != null) {
      const limits = RiskProfiles.computeLimits(profileName, portfolioValueUsd);
      lines.push("");
      lines.push(`At $${portfolioValueUsd.toLocaleString()} portfolio:`);
      lines.push(`  Max per tx: $${limits.maxPerTx.toLocaleString()}`);
      lines.push(`  Max per day: $${limits.maxPerDay.toLocaleString()}`);
    }

    return lines.join("\n");
  },
};
