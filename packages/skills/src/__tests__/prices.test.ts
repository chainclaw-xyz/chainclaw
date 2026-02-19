import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// We need to reset modules between tests to clear the price cache
describe("prices", () => {
  const mockFetch = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("getTokenPrice returns price from API", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ethereum: { usd: 3200 } }),
    });

    const { getTokenPrice } = await import("../prices.js");
    const price = await getTokenPrice("ETH");
    expect(price).toBe(3200);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("stablecoins return 1.0 without fetch", async () => {
    const { getTokenPrice } = await import("../prices.js");

    expect(await getTokenPrice("USDC")).toBe(1.0);
    expect(await getTokenPrice("USDT")).toBe(1.0);
    expect(await getTokenPrice("DAI")).toBe(1.0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("API failure returns null", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const { getTokenPrice } = await import("../prices.js");
    const price = await getTokenPrice("ETH");
    expect(price).toBeNull();
  });

  it("getEthPriceUsd falls back to 2500 on failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const { getEthPriceUsd } = await import("../prices.js");
    const price = await getEthPriceUsd();
    expect(price).toBe(2500);
  });

  it("cache returns cached value within TTL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ethereum: { usd: 3000 } }),
    });

    const { getTokenPrice } = await import("../prices.js");

    // First call hits API
    const price1 = await getTokenPrice("ETH");
    expect(price1).toBe(3000);
    expect(mockFetch).toHaveBeenCalledOnce();

    // Second call should use cache
    const price2 = await getTokenPrice("ETH");
    expect(price2).toBe(3000);
    expect(mockFetch).toHaveBeenCalledOnce(); // Still only 1 call
  });
});
