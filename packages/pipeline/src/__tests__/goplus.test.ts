import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Address } from "viem";
import { GoPlusClient } from "../risk/goplus.js";

describe("GoPlusClient", () => {
  let client: GoPlusClient;
  const fetchSpy = vi.fn();

  beforeEach(() => {
    client = new GoPlusClient();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses a safe token response", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 1,
        result: {
          "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
            token_name: "USD Coin",
            token_symbol: "USDC",
            is_honeypot: "0",
            is_open_source: "1",
            is_proxy: "0",
            is_mintable: "0",
            can_take_back_ownership: "0",
            owner_change_balance: "0",
            is_blacklisted: "0",
            trading_cooldown: "0",
            buy_tax: "0",
            sell_tax: "0",
            holder_count: "1500000",
            holders: [
              { address: "0xaaa", percent: "0.05", is_locked: 0, is_contract: 0 },
            ],
          },
        },
      }),
    });

    const report = await client.getTokenSecurity(
      1,
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
    );

    expect(report).toBeDefined();
    expect(report!.symbol).toBe("USDC");
    expect(report!.isHoneypot).toBe(false);
    expect(report!.isOpenSource).toBe(true);
    expect(report!.riskLevel).toBe("safe");
    expect(report!.dimensions).toHaveLength(0);
  });

  it("parses a honeypot token response", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 1,
        result: {
          "0xdead": {
            token_name: "Scam Token",
            token_symbol: "SCAM",
            is_honeypot: "1",
            is_open_source: "0",
            is_proxy: "0",
            is_mintable: "1",
            can_take_back_ownership: "1",
            owner_change_balance: "1",
            is_blacklisted: "1",
            trading_cooldown: "1",
            buy_tax: "0.1",
            sell_tax: "0.99",
            holder_count: "5",
            holders: [
              { address: "0xwhale", percent: "0.9", is_locked: 0, is_contract: 0 },
            ],
          },
        },
      }),
    });

    const report = await client.getTokenSecurity(1, "0xdead" as Address);

    expect(report).toBeDefined();
    expect(report!.symbol).toBe("SCAM");
    expect(report!.isHoneypot).toBe(true);
    expect(report!.hasMintFunction).toBe(true);
    expect(report!.canTakeBackOwnership).toBe(true);
    expect(report!.canBlacklist).toBe(true);
    expect(report!.sellTax).toBe(99);
    // Overall risk level is the average of all dimension scores
    // With many moderate dimensions, average falls in "high" range
    expect(["high", "critical"]).toContain(report!.riskLevel);
    expect(report!.overallScore).toBeGreaterThanOrEqual(60);
    expect(report!.dimensions.length).toBeGreaterThan(0);
  });

  it("detects high buy/sell tax", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 1,
        result: {
          "0xfee": {
            token_name: "Fee Token",
            token_symbol: "FEE",
            is_honeypot: "0",
            is_open_source: "1",
            is_mintable: "0",
            can_take_back_ownership: "0",
            owner_change_balance: "0",
            is_blacklisted: "0",
            trading_cooldown: "0",
            buy_tax: "0.25",
            sell_tax: "0.30",
            holder_count: "500",
            holders: [],
          },
        },
      }),
    });

    const report = await client.getTokenSecurity(1, "0xfee" as Address);

    expect(report).toBeDefined();
    const taxDimensions = report!.dimensions.filter(
      (d) => d.name === "buy_tax" || d.name === "sell_tax",
    );
    expect(taxDimensions.length).toBe(2);
    expect(taxDimensions.some((d) => d.severity === "high")).toBe(true);
  });

  it("returns null for unsupported chain", async () => {
    const report = await client.getTokenSecurity(99999, "0xdead" as Address);
    expect(report).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null on API error", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const report = await client.getTokenSecurity(1, "0xdead" as Address);
    expect(report).toBeNull();
  });

  it("returns null on network failure", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("Network error"));

    const report = await client.getTokenSecurity(1, "0xdead" as Address);
    expect(report).toBeNull();
  });

  it("detects whale concentration", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 1,
        result: {
          "0xwhale": {
            token_name: "Whale Token",
            token_symbol: "WHALE",
            is_honeypot: "0",
            is_open_source: "1",
            is_mintable: "0",
            can_take_back_ownership: "0",
            owner_change_balance: "0",
            is_blacklisted: "0",
            trading_cooldown: "0",
            buy_tax: "0",
            sell_tax: "0",
            holder_count: "50",
            holders: [
              { address: "0xa", percent: "0.4", is_locked: 0, is_contract: 0 },
              { address: "0xb", percent: "0.3", is_locked: 0, is_contract: 0 },
            ],
          },
        },
      }),
    });

    const report = await client.getTokenSecurity(1, "0xwhale" as Address);

    expect(report).toBeDefined();
    const whaleDim = report!.dimensions.find(
      (d) => d.name === "whale_concentration",
    );
    expect(whaleDim).toBeDefined();
    expect(whaleDim!.severity).toBe("high");
  });
});
