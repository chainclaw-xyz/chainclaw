import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseEther, type Address } from "viem";
import { TransactionSimulator } from "../simulator.js";
import type { TransactionRequest, SimulationResult } from "../types.js";

function makeTx(valueEth: string, data?: `0x${string}`): TransactionRequest {
  return {
    chainId: 1,
    from: "0x1111111111111111111111111111111111111111" as Address,
    to: "0x2222222222222222222222222222222222222222" as Address,
    value: parseEther(valueEth),
    data,
  };
}

describe("TransactionSimulator", () => {
  describe("estimate-only mode (no Tenderly)", () => {
    let sim: TransactionSimulator;

    beforeEach(() => {
      sim = new TransactionSimulator({});
    });

    it("returns success with gas estimate for basic tx", async () => {
      const result = await sim.simulate(makeTx("1"));
      expect(result.success).toBe(true);
      expect(result.gasEstimate).toBe(200000n);
    });

    it("includes ETH balance change for value transfers", async () => {
      const result = await sim.simulate(makeTx("0.5"));
      expect(result.balanceChanges).toHaveLength(1);
      expect(result.balanceChanges[0].symbol).toBe("ETH");
      expect(result.balanceChanges[0].direction).toBe("out");
      expect(result.balanceChanges[0].amount).toBe("0.5");
    });

    it("returns empty balance changes for zero-value tx", async () => {
      const result = await sim.simulate(makeTx("0"));
      expect(result.balanceChanges).toHaveLength(0);
    });

    it("uses gasLimit from tx if provided", async () => {
      const tx = makeTx("0.1");
      tx.gasLimit = 50000n;
      const result = await sim.simulate(tx);
      expect(result.gasEstimate).toBe(50000n);
    });
  });

  describe("Tenderly simulation", () => {
    let sim: TransactionSimulator;
    const fetchSpy = vi.fn();

    beforeEach(() => {
      sim = new TransactionSimulator({
        tenderlyApiKey: "test-key",
        tenderlyAccount: "test-account",
        tenderlyProject: "test-project",
      });
      vi.stubGlobal("fetch", fetchSpy);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("calls Tenderly API and parses response", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          simulation: { status: true, gas_used: 21000 },
          transaction: {
            transaction_info: {
              asset_changes: [
                {
                  token_info: { symbol: "ETH", name: "Ether", decimals: 18 },
                  raw_amount: "1000000000000000000",
                  from: "0x1111111111111111111111111111111111111111",
                  to: "0x2222222222222222222222222222222222222222",
                },
              ],
            },
          },
        }),
      });

      const result = await sim.simulate(makeTx("1"));
      expect(result.success).toBe(true);
      expect(result.gasEstimate).toBe(21000n);
      expect(result.balanceChanges).toHaveLength(1);
      expect(result.balanceChanges[0].symbol).toBe("ETH");
      expect(result.balanceChanges[0].direction).toBe("out");
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it("falls back to estimate on API error", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const result = await sim.simulate(makeTx("1"));
      expect(result.success).toBe(true);
      expect(result.gasEstimate).toBe(200000n); // fallback default
    });

    it("falls back to estimate on network error", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Network failure"));

      const result = await sim.simulate(makeTx("0.5"));
      expect(result.success).toBe(true);
      expect(result.gasEstimate).toBe(200000n);
    });
  });

  describe("formatPreview", () => {
    let sim: TransactionSimulator;

    beforeEach(() => {
      sim = new TransactionSimulator({});
    });

    it("formats successful simulation with balance changes", () => {
      const result: SimulationResult = {
        success: true,
        gasEstimate: 21000n,
        balanceChanges: [
          { token: "ETH", symbol: "ETH", amount: "1.0", direction: "out" },
          { token: "USDC", symbol: "USDC", amount: "2500.0", direction: "in" },
        ],
      };

      const preview = sim.formatPreview(result);
      expect(preview).toContain("Transaction Preview");
      expect(preview).toContain("-1.0 ETH");
      expect(preview).toContain("+2500.0 USDC");
      expect(preview).toContain("21,000");
    });

    it("formats failed simulation", () => {
      const result: SimulationResult = {
        success: false,
        gasEstimate: 0n,
        balanceChanges: [],
        error: "Insufficient balance",
      };

      const preview = sim.formatPreview(result);
      expect(preview).toContain("WOULD FAIL");
      expect(preview).toContain("Insufficient balance");
    });

    it("includes gas cost when gasPrice provided", () => {
      const result: SimulationResult = {
        success: true,
        gasEstimate: 21000n,
        balanceChanges: [],
      };

      const preview = sim.formatPreview(result, 20000000000n); // 20 gwei
      expect(preview).toContain("ETH");
    });
  });
});
