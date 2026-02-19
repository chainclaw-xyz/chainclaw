import { describe, it, expect, beforeEach } from "vitest";
import { MevProtection } from "../mev.js";

describe("MevProtection", () => {
  let mev: MevProtection;

  beforeEach(() => {
    mev = new MevProtection();
  });

  it("supports Ethereum mainnet", () => {
    expect(mev.isSupported(1)).toBe(true);
  });

  it("does not support other chains", () => {
    expect(mev.isSupported(8453)).toBe(false);
    expect(mev.isSupported(42161)).toBe(false);
    expect(mev.isSupported(10)).toBe(false);
  });

  it("returns Flashbots RPC URL", () => {
    const url = mev.getProtectedRpcUrl();
    expect(url).toBe("https://rpc.flashbots.net");
  });
});
