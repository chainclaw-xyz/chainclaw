import { describe, it, expect } from "vitest";
import { getChainInfo, getSupportedChainIds, CHAIN_REGISTRY } from "../registry.js";

describe("Chain Registry", () => {
  it("has Ethereum Mainnet (chainId 1)", () => {
    const chain = getChainInfo(1);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe("Ethereum Mainnet");
    expect(chain!.nativeCurrency.symbol).toBe("ETH");
  });

  it("has Base (chainId 8453)", () => {
    const chain = getChainInfo(8453);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe("Base");
    expect(chain!.nativeCurrency.symbol).toBe("ETH");
  });

  it("has Solana (chainId 900)", () => {
    const chain = getChainInfo(900);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe("Solana");
    expect(chain!.nativeCurrency.symbol).toBe("SOL");
    expect(chain!.nativeCurrency.decimals).toBe(9);
  });

  it("returns undefined for unsupported chains", () => {
    expect(getChainInfo(999999)).toBeUndefined();
  });

  it("lists all supported chain IDs", () => {
    const ids = getSupportedChainIds();
    expect(ids).toContain(1);
    expect(ids).toContain(8453);
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it("all registry entries have required fields", () => {
    for (const chain of Object.values(CHAIN_REGISTRY)) {
      expect(chain.id).toBeGreaterThan(0);
      expect(chain.name).toBeTruthy();
      expect(chain.shortName).toBeTruthy();
      expect(chain.nativeCurrency.symbol).toBeTruthy();
      expect(chain.nativeCurrency.decimals).toBeGreaterThan(0);
      expect(chain.rpcUrls.length).toBeGreaterThan(0);
      expect(chain.blockExplorerUrl).toMatch(/^https?:\/\//);
    }
  });
});
