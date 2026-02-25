import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  fetchWithRetry: vi.fn(),
}));

import { fetchWithRetry } from "@chainclaw/core";
import { createYieldFinderSkill } from "../yield-finder.js";

const mockFetch = vi.mocked(fetchWithRetry);

const MOCK_POOLS = [
  { chain: "Ethereum", project: "aave-v3", symbol: "USDC", tvlUsd: 5_000_000_000, apy: 4.5, apyBase: 4.5, apyReward: null, pool: "pool-1", stablecoin: true },
  { chain: "zkSync Era", project: "syncswap", symbol: "USDC-ETH", tvlUsd: 2_000_000, apy: 12.3, apyBase: 12.3, apyReward: null, pool: "pool-2", stablecoin: false },
  { chain: "Blast", project: "thruster", symbol: "USDB-ETH", tvlUsd: 3_000_000, apy: 8.1, apyBase: 8.1, apyReward: null, pool: "pool-3", stablecoin: false },
  { chain: "Solana", project: "marinade", symbol: "mSOL", tvlUsd: 1_500_000, apy: 7.2, apyBase: 7.2, apyReward: null, pool: "pool-4", stablecoin: false },
  { chain: "Gnosis", project: "curve", symbol: "WXDAI-USDC", tvlUsd: 1_200_000, apy: 3.1, apyBase: 3.1, apyReward: null, pool: "pool-5", stablecoin: true },
  { chain: "Fantom", project: "spookyswap", symbol: "FTM-USDC", tvlUsd: 1_100_000, apy: 15.0, apyBase: 15.0, apyReward: null, pool: "pool-6", stablecoin: false },
];

function mockPoolResponse() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: MOCK_POOLS }),
  } as any);
}

const mockContext = {
  userId: "user-1",
  walletAddress: null,
  chainIds: [],
  sendReply: vi.fn(),
};

describe("yield-finder skill", () => {
  let skill: ReturnType<typeof createYieldFinderSkill>;

  beforeEach(() => {
    vi.clearAllMocks();
    skill = createYieldFinderSkill();
  });

  it("filters pools by chainId 324 (zkSync Era)", async () => {
    mockPoolResponse();
    const result = await skill.execute({ chainId: 324 }, mockContext as any);
    expect(result.success).toBe(true);
    expect(result.message).toContain("syncswap");
    expect(result.message).toContain("zkSync Era");
    expect(result.message).not.toContain("aave-v3");
  });

  it("filters pools by chainId 900 (Solana)", async () => {
    mockPoolResponse();
    const result = await skill.execute({ chainId: 900 }, mockContext as any);
    expect(result.success).toBe(true);
    expect(result.message).toContain("marinade");
    expect(result.message).toContain("Solana");
  });

  it("filters pools by chainId 81457 (Blast)", async () => {
    mockPoolResponse();
    const result = await skill.execute({ chainId: 81457 }, mockContext as any);
    expect(result.success).toBe(true);
    expect(result.message).toContain("thruster");
  });

  it("returns error with all chain names for unsupported chainId", async () => {
    mockPoolResponse();
    const result = await skill.execute({ chainId: 99999 }, mockContext as any);
    expect(result.success).toBe(false);
    expect(result.message).toContain("99999");
    expect(result.message).toContain("Ethereum");
    expect(result.message).toContain("zkSync Era");
    expect(result.message).toContain("Blast");
    expect(result.message).toContain("Solana");
    expect(result.message).toContain("Gnosis");
    expect(result.message).toContain("Fantom");
    expect(result.message).toContain("Mantle");
  });

  it("returns sorted results by APY by default", async () => {
    mockPoolResponse();
    const result = await skill.execute({}, mockContext as any);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    const apys = (result.data as any[]).map((d: any) => d.apy);
    for (let i = 1; i < apys.length; i++) {
      expect(apys[i - 1]).toBeGreaterThanOrEqual(apys[i]);
    }
  });

  it("filters by token symbol", async () => {
    mockPoolResponse();
    const result = await skill.execute({ token: "USDC" }, mockContext as any);
    expect(result.success).toBe(true);
    expect(result.message).toContain("USDC");
    expect(result.message).not.toContain("mSOL");
  });
});
