import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address } from "viem";
import { TransactionSimulator } from "../simulator.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  fetchWithRetry: vi.fn(),
}));

import { fetchWithRetry } from "@chainclaw/core";

const mockFetch = vi.mocked(fetchWithRetry);

const BUY_TX = {
  chainId: 1,
  from: "0x1111111111111111111111111111111111111111" as Address,
  to: "0x2222222222222222222222222222222222222222" as Address,
  value: 100000000000000000n, // 0.1 ETH
  data: "0xcalldata" as `0x${string}`,
  gasLimit: 500000n,
};

const TOKEN = "0x3333333333333333333333333333333333333333" as Address;

describe("simulateSellAfterBuy", () => {
  let simulator: TransactionSimulator;

  beforeEach(() => {
    vi.clearAllMocks();
    simulator = new TransactionSimulator({
      tenderlyApiKey: "test-key",
      tenderlyAccount: "test-account",
      tenderlyProject: "test-project",
    });
  });

  it("returns canSell false when sell simulation fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        simulation_results: [
          { simulation: { status: true, gas_used: 200000 }, transaction: { transaction_info: { asset_changes: [] } } },
          { simulation: { status: true, gas_used: 50000 }, transaction: { transaction_info: { asset_changes: [] } } },
          { simulation: { status: false, gas_used: 0, error_message: "execution reverted" }, transaction: { transaction_info: { asset_changes: [] } } },
        ],
      }),
    } as any);

    const result = await simulator.simulateSellAfterBuy(BUY_TX, TOKEN);
    expect(result.canSell).toBe(false);
    expect(result.sellTax).toBe(100);
    expect(result.netLossPercent).toBe(100);
    expect(result.warning).toContain("Cannot sell");
  });

  it("calculates correct netLossPercent for round-trip", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        simulation_results: [
          {
            simulation: { status: true, gas_used: 200000 },
            transaction: {
              transaction_info: {
                asset_changes: [{
                  token_info: { symbol: "TEST", name: "Test", decimals: 18, address: TOKEN },
                  raw_amount: "1000000000000000000", from: "0xpool", to: BUY_TX.from,
                }],
              },
            },
          },
          { simulation: { status: true, gas_used: 50000 }, transaction: { transaction_info: {} } },
          {
            simulation: { status: true, gas_used: 300000 },
            transaction: {
              transaction_info: {
                asset_changes: [{
                  token_info: { symbol: "ETH", name: "Ether", decimals: 18 },
                  raw_amount: "90000000000000000", from: "0xpool", to: BUY_TX.from,
                }],
              },
            },
          },
        ],
      }),
    } as any);

    const result = await simulator.simulateSellAfterBuy(BUY_TX, TOKEN);
    expect(result.canSell).toBe(true);
    expect(result.netLossPercent).toBe(10); // 0.1 ETH in, 0.09 ETH out = 10% loss
    expect(result.sellReceived).toBe("0.09");
  });

  it("detects high sell tax with warning", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        simulation_results: [
          {
            simulation: { status: true, gas_used: 200000 },
            transaction: { transaction_info: { asset_changes: [] } },
          },
          { simulation: { status: true, gas_used: 50000 }, transaction: { transaction_info: {} } },
          {
            simulation: { status: true, gas_used: 300000 },
            transaction: {
              transaction_info: {
                asset_changes: [{
                  token_info: { symbol: "ETH", name: "Ether", decimals: 18 },
                  raw_amount: "70000000000000000", from: "0xpool", to: BUY_TX.from,
                }],
              },
            },
          },
        ],
      }),
    } as any);

    const result = await simulator.simulateSellAfterBuy(BUY_TX, TOKEN);
    expect(result.canSell).toBe(true);
    expect(result.netLossPercent).toBe(30); // 30% loss
    expect(result.warning).toContain("High round-trip loss");
  });

  it("returns permissive default when no Tenderly key", async () => {
    const noKeySimulator = new TransactionSimulator({});
    const result = await noKeySimulator.simulateSellAfterBuy(BUY_TX, TOKEN);
    expect(result.canSell).toBe(true);
    expect(result.netLossPercent).toBe(0);
    expect(result.warning).toContain("no Tenderly key");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns permissive default on API error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as any);
    const result = await simulator.simulateSellAfterBuy(BUY_TX, TOKEN);
    expect(result.canSell).toBe(true);
    expect(result.warning).toContain("failed");
  });

  it("returns permissive default on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const result = await simulator.simulateSellAfterBuy(BUY_TX, TOKEN);
    expect(result.canSell).toBe(true);
    expect(result.warning).toContain("error");
  });

  it("handles incomplete bundle response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ simulation_results: [] }),
    } as any);

    const result = await simulator.simulateSellAfterBuy(BUY_TX, TOKEN);
    expect(result.canSell).toBe(true);
    expect(result.warning).toContain("incomplete");
  });

  it("constructs bundle with correct 3-tx structure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        simulation_results: [
          { simulation: { status: true, gas_used: 200000 }, transaction: { transaction_info: {} } },
          { simulation: { status: true, gas_used: 50000 }, transaction: { transaction_info: {} } },
          { simulation: { status: true, gas_used: 300000 }, transaction: { transaction_info: { asset_changes: [] } } },
        ],
      }),
    } as any);

    await simulator.simulateSellAfterBuy(BUY_TX, TOKEN);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("simulate-bundle");
    const body = JSON.parse((options as any).body) as { simulations: unknown[] };
    expect(body.simulations).toHaveLength(3);
  });
});
