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

  it("has Polygon (chainId 137)", () => {
    const chain = getChainInfo(137);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe("Polygon");
    expect(chain!.nativeCurrency.symbol).toBe("MATIC");
  });

  it("has BNB Chain (chainId 56)", () => {
    const chain = getChainInfo(56);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe("BNB Chain");
    expect(chain!.nativeCurrency.symbol).toBe("BNB");
  });

  it("has Avalanche C-Chain (chainId 43114)", () => {
    const chain = getChainInfo(43114);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe("Avalanche C-Chain");
    expect(chain!.nativeCurrency.symbol).toBe("AVAX");
  });

  it("has zkSync Era (chainId 324)", () => {
    const chain = getChainInfo(324);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe("zkSync Era");
    expect(chain!.nativeCurrency.symbol).toBe("ETH");
  });

  it("has Scroll (chainId 534352)", () => {
    const chain = getChainInfo(534352);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe("Scroll");
    expect(chain!.nativeCurrency.symbol).toBe("ETH");
  });

  it("has Blast (chainId 81457)", () => {
    const chain = getChainInfo(81457);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe("Blast");
    expect(chain!.nativeCurrency.symbol).toBe("ETH");
  });

  it("has Gnosis (chainId 100)", () => {
    const chain = getChainInfo(100);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe("Gnosis");
    expect(chain!.nativeCurrency.symbol).toBe("XDAI");
  });

  it("has Linea (chainId 59144)", () => {
    const chain = getChainInfo(59144);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe("Linea");
    expect(chain!.nativeCurrency.symbol).toBe("ETH");
  });

  it("has Fantom (chainId 250)", () => {
    const chain = getChainInfo(250);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe("Fantom");
    expect(chain!.nativeCurrency.symbol).toBe("FTM");
  });

  it("has Mantle (chainId 5000)", () => {
    const chain = getChainInfo(5000);
    expect(chain).toBeDefined();
    expect(chain!.name).toBe("Mantle");
    expect(chain!.nativeCurrency.symbol).toBe("MNT");
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
