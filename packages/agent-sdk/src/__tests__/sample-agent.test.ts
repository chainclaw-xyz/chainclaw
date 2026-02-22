import { describe, it, expect } from "vitest";
import { createSampleDcaAgent } from "../samples/dca-agent.js";
import type { StrategyContext } from "../types.js";

describe("createSampleDcaAgent", () => {
  it("creates a valid agent definition", () => {
    const agent = createSampleDcaAgent();

    expect(agent.name).toBe("sample-dca");
    expect(agent.version).toBe("1.0.0");
    expect(agent.category).toBe("dca");
    expect(agent.strategy.watchlist).toEqual(["ETH"]);
    expect(agent.riskParams.allowedChainIds).toEqual([1]);
  });

  it("accepts custom options", () => {
    const agent = createSampleDcaAgent({
      amountPerBuy: 500,
      targetToken: "BTC",
      chainId: 8453,
    });

    expect(agent.strategy.watchlist).toEqual(["BTC"]);
    expect(agent.riskParams.maxPositionSizeUsd).toBe(1000);
    expect(agent.riskParams.allowedChainIds).toEqual([8453]);
    expect(agent.description).toContain("$500");
    expect(agent.description).toContain("BTC");
  });

  it("evaluate returns a buy decision", async () => {
    const agent = createSampleDcaAgent({ amountPerBuy: 200, targetToken: "ETH" });

    const context: StrategyContext = {
      portfolio: {},
      totalValueUsd: 10000,
      prices: { ETH: 3000 },
      recentTrades: [],
      knowledge: {},
      timestamp: Math.floor(Date.now() / 1000),
    };

    const decisions = await agent.strategy.evaluate(context);

    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe("buy");
    expect(decisions[0].token).toBe("ETH");
    expect(decisions[0].amountUsd).toBe(200);
    expect(decisions[0].reasoning).toContain("$200");
  });

  it("returns empty when no price available", async () => {
    const agent = createSampleDcaAgent();

    const context: StrategyContext = {
      portfolio: {},
      totalValueUsd: 10000,
      prices: {},
      recentTrades: [],
      knowledge: {},
      timestamp: Math.floor(Date.now() / 1000),
    };

    const decisions = await agent.strategy.evaluate(context);
    expect(decisions).toHaveLength(0);
  });
});
