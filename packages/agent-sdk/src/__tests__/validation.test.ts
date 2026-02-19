import { describe, it, expect } from "vitest";
import { riskParametersSchema, backtestConfigSchema } from "../validation.js";

describe("riskParametersSchema", () => {
  it("validates correct risk parameters", () => {
    const params = {
      maxPositionSizeUsd: 1000,
      maxDrawdownPercent: 20,
      maxDailyTradesCount: 10,
      maxDailyExposureUsd: 5000,
      allowedChainIds: [1, 8453],
    };

    const result = riskParametersSchema.parse(params);
    expect(result.maxPositionSizeUsd).toBe(1000);
    expect(result.allowedChainIds).toEqual([1, 8453]);
  });

  it("rejects negative position size", () => {
    const params = {
      maxPositionSizeUsd: -100,
      maxDrawdownPercent: 20,
      maxDailyTradesCount: 10,
      maxDailyExposureUsd: 5000,
      allowedChainIds: [1],
    };

    expect(() => riskParametersSchema.parse(params)).toThrow();
  });

  it("rejects drawdown over 100%", () => {
    const params = {
      maxPositionSizeUsd: 1000,
      maxDrawdownPercent: 150,
      maxDailyTradesCount: 10,
      maxDailyExposureUsd: 5000,
      allowedChainIds: [1],
    };

    expect(() => riskParametersSchema.parse(params)).toThrow();
  });

  it("rejects empty allowedChainIds", () => {
    const params = {
      maxPositionSizeUsd: 1000,
      maxDrawdownPercent: 20,
      maxDailyTradesCount: 10,
      maxDailyExposureUsd: 5000,
      allowedChainIds: [],
    };

    expect(() => riskParametersSchema.parse(params)).toThrow();
  });

  it("accepts optional fields", () => {
    const params = {
      maxPositionSizeUsd: 1000,
      maxDrawdownPercent: 20,
      maxDailyTradesCount: 10,
      maxDailyExposureUsd: 5000,
      stopLossPercent: 5,
      takeProfitPercent: 50,
      allowedChainIds: [1],
      allowedTokens: ["ETH", "BTC"],
      blockedTokens: ["SHIB"],
    };

    const result = riskParametersSchema.parse(params);
    expect(result.stopLossPercent).toBe(5);
    expect(result.allowedTokens).toEqual(["ETH", "BTC"]);
  });
});

describe("backtestConfigSchema", () => {
  it("validates correct backtest config", () => {
    const config = {
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-06-01"),
      startingCapitalUsd: 10000,
    };

    const result = backtestConfigSchema.parse(config);
    expect(result.startingCapitalUsd).toBe(10000);
    expect(result.feePercent).toBe(0.3); // default
    expect(result.slippagePercent).toBe(0.5); // default
  });

  it("rejects endDate before startDate", () => {
    const config = {
      startDate: new Date("2024-06-01"),
      endDate: new Date("2024-01-01"),
      startingCapitalUsd: 10000,
    };

    expect(() => backtestConfigSchema.parse(config)).toThrow("endDate must be after startDate");
  });

  it("rejects negative capital", () => {
    const config = {
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-06-01"),
      startingCapitalUsd: -100,
    };

    expect(() => backtestConfigSchema.parse(config)).toThrow();
  });
});
