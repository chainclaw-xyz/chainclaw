import { describe, it, expect } from "vitest";
import {
  outcomeLabelSchema,
  trainingExampleSchema,
  hostingTierSchema,
  LABEL_WINDOWS,
  labelWindowMs,
  HOSTING_TIERS,
} from "../types.js";

describe("types", () => {
  describe("LABEL_WINDOWS", () => {
    it("has 3 windows", () => {
      expect(LABEL_WINDOWS).toEqual(["1h", "24h", "7d"]);
    });

    it("labelWindowMs maps to correct milliseconds", () => {
      expect(labelWindowMs["1h"]).toBe(3_600_000);
      expect(labelWindowMs["24h"]).toBe(86_400_000);
      expect(labelWindowMs["7d"]).toBe(604_800_000);
    });
  });

  describe("outcomeLabelSchema", () => {
    it("parses a valid outcome label", () => {
      const label = {
        tradeId: "trade-1",
        agentId: "agent-1",
        token: "ETH",
        action: "buy",
        priceAtExecution: 2500,
        window: "24h",
        priceAtWindow: 2600,
        pnlUsd: 4.0,
        pnlPercent: 4.0,
        labeledAt: Date.now(),
      };
      expect(() => outcomeLabelSchema.parse(label)).not.toThrow();
    });

    it("rejects invalid window", () => {
      const label = {
        tradeId: "trade-1",
        agentId: "agent-1",
        token: "ETH",
        action: "buy",
        priceAtExecution: 2500,
        window: "2h",
        priceAtWindow: 2600,
        pnlUsd: 4.0,
        pnlPercent: 4.0,
        labeledAt: Date.now(),
      };
      expect(() => outcomeLabelSchema.parse(label)).toThrow();
    });
  });

  describe("trainingExampleSchema", () => {
    it("parses a valid training example", () => {
      const example = {
        id: "ex-1",
        tradeId: "trade-1",
        agentId: "agent-1",
        context: {
          prices: { ETH: 2500, BTC: 43000 },
          portfolio: { ETH: 0.5 },
          totalValueUsd: 1250,
          timestamp: 1700000000,
        },
        decision: {
          action: "buy",
          token: "ETH",
          amountUsd: 100,
          chainId: 1,
        },
        reasoning: "ETH looks bullish",
        createdAt: Date.now(),
      };
      expect(() => trainingExampleSchema.parse(example)).not.toThrow();
    });
  });

  describe("HOSTING_TIERS", () => {
    it("has 3 tiers", () => {
      expect(HOSTING_TIERS).toHaveLength(3);
    });

    it("tiers have ascending prices", () => {
      const prices = HOSTING_TIERS.map((t) => t.priceUsd);
      expect(prices).toEqual([29, 59, 99]);
    });

    it("all tiers pass schema validation", () => {
      for (const tier of HOSTING_TIERS) {
        expect(() => hostingTierSchema.parse(tier)).not.toThrow();
      }
    });
  });
});
