import { z } from "zod";
import { getLogger, fetchWithRetry, type SkillResult } from "@chainclaw/core";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";

const logger = getLogger("skill-yield-finder");

const yieldFinderParams = z.object({
  token: z.string().optional(),
  chainId: z.number().optional(),
  minTvl: z.number().optional().default(1_000_000),
  limit: z.number().optional().default(10),
  sortBy: z.enum(["apy", "tvl", "score"]).optional().default("apy"),
});

// DeFiLlama chain ID → chain name mapping
const CHAIN_ID_TO_LLAMA: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum",
  10: "Optimism",
  137: "Polygon",
  43114: "Avalanche",
  56: "BSC",
  324: "zkSync Era",
  534352: "Scroll",
  81457: "Blast",
  100: "Gnosis",
  59144: "Linea",
  250: "Fantom",
  5000: "Mantle",
  900: "Solana",
};

interface DefiLlamaPool {
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number | null;
  apyBase: number | null;
  apyReward: number | null;
  pool: string;
  stablecoin: boolean;
}

// ─── Yield Scoring (0-400 scale, 4 pillars at 0-100 each) ──

const AUDIT_ALLOWLIST = new Set([
  "aave-v3", "aave-v2", "compound-v3", "compound-v2", "lido", "rocket-pool",
  "maker", "curve-dex", "convex-finance", "yearn-finance", "uniswap-v3",
  "sushiswap", "balancer-v2", "morpho", "spark", "sky", "pendle",
  "eigenlayer", "ether-fi", "renzo", "jito", "marinade",
]);

interface YieldScore {
  total: number;
  yieldQuality: number;
  protocolSafety: number;
  liquidityDepth: number;
  sustainability: number;
}

function scorePool(pool: DefiLlamaPool, allPools: DefiLlamaPool[]): YieldScore | null {
  const apy = pool.apy ?? 0;

  // Hard disqualifiers
  if (pool.tvlUsd < 100_000) return null;
  if (apy > 1000) return null;   // likely scam / unsustainable
  if (apy <= 0) return null;

  // 1. Yield Quality (0-100): APY percentile + base vs reward ratio + stability
  const apyValues = allPools.filter((p) => p.apy != null && p.apy > 0).map((p) => p.apy!).sort((a, b) => a - b);
  const apyPercentile = apyValues.length > 0 ? (apyValues.filter((a) => a <= apy).length / apyValues.length) * 100 : 50;
  const baseRatio = pool.apyBase != null && apy > 0 ? (pool.apyBase / apy) * 100 : 50; // higher base % = more sustainable
  const yieldQuality = Math.min(100, Math.round(apyPercentile * 0.5 + baseRatio * 0.5));

  // 2. Protocol Safety (0-100): TVL tier + audit allowlist
  let protocolSafety: number;
  if (pool.tvlUsd >= 1_000_000_000) protocolSafety = 100;
  else if (pool.tvlUsd >= 100_000_000) protocolSafety = 70;
  else if (pool.tvlUsd >= 10_000_000) protocolSafety = 50;
  else if (pool.tvlUsd >= 1_000_000) protocolSafety = 30;
  else protocolSafety = 15;

  if (AUDIT_ALLOWLIST.has(pool.project.toLowerCase())) {
    protocolSafety = Math.min(100, protocolSafety + 20);
  }

  // 3. Liquidity Depth (0-100): TVL absolute scale
  let liquidityDepth: number;
  if (pool.tvlUsd >= 500_000_000) liquidityDepth = 100;
  else if (pool.tvlUsd >= 100_000_000) liquidityDepth = 80;
  else if (pool.tvlUsd >= 50_000_000) liquidityDepth = 65;
  else if (pool.tvlUsd >= 10_000_000) liquidityDepth = 50;
  else if (pool.tvlUsd >= 1_000_000) liquidityDepth = 30;
  else liquidityDepth = 10;

  // 4. Sustainability (0-100): TVL/APY ratio — high TVL relative to APY means more capital trusts this yield
  const tvlApyRatio = apy > 0 ? pool.tvlUsd / apy : 0;
  let sustainability: number;
  if (tvlApyRatio >= 100_000_000) sustainability = 100;
  else if (tvlApyRatio >= 10_000_000) sustainability = 80;
  else if (tvlApyRatio >= 1_000_000) sustainability = 60;
  else if (tvlApyRatio >= 100_000) sustainability = 40;
  else sustainability = 20;

  // Bonus: stablecoins with reasonable yields are more sustainable
  if (pool.stablecoin && apy < 20) {
    sustainability = Math.min(100, sustainability + 15);
  }

  const total = yieldQuality + protocolSafety + liquidityDepth + sustainability;
  return { total, yieldQuality, protocolSafety, liquidityDepth, sustainability };
}

export { scorePool, type YieldScore };

// In-memory cache
let poolCache: { data: DefiLlamaPool[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchPools(): Promise<DefiLlamaPool[]> {
  if (poolCache && poolCache.expiresAt > Date.now()) {
    return poolCache.data;
  }

  const response = await fetchWithRetry("https://yields.llama.fi/pools");
  if (!response.ok) {
    logger.warn({ status: response.status }, "DeFiLlama yields API error");
    throw new Error(`DeFiLlama API returned ${response.status}`);
  }

  const json = (await response.json()) as { data: DefiLlamaPool[] };
  poolCache = { data: json.data, expiresAt: Date.now() + CACHE_TTL_MS };
  logger.debug({ poolCount: json.data.length }, "Pools fetched from DeFiLlama");
  return json.data;
}

function formatUsd(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function createYieldFinderSkill(): SkillDefinition {
  return {
    name: "yield-finder",
    description:
      "Find the best DeFi yields across protocols. Search by token, chain, and minimum TVL. " +
      "Example: 'Find best yields for USDC' or 'Top yields on Base'.",
    parameters: yieldFinderParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = yieldFinderParams.parse(params);

      await context.sendReply("_Searching for the best yields across DeFi protocols..._");

      try {
        const allPools = await fetchPools();
        let pools = allPools;

        // Filter by token symbol (case-insensitive partial match)
        if (parsed.token) {
          const tokenUpper = parsed.token.toUpperCase();
          pools = pools.filter((p) => p.symbol.toUpperCase().includes(tokenUpper));
        }

        // Filter by chain
        if (parsed.chainId) {
          const llamaChain = CHAIN_ID_TO_LLAMA[parsed.chainId];
          if (llamaChain) {
            pools = pools.filter((p) => p.chain === llamaChain);
          } else {
            return {
              success: false,
              message: `Chain ID ${parsed.chainId} is not supported for yield search. Supported: ${Object.values(CHAIN_ID_TO_LLAMA).join(", ")}.`,
            };
          }
        }

        // Filter by minimum TVL
        pools = pools.filter((p) => p.tvlUsd >= parsed.minTvl);

        // Filter out pools with null/zero APY
        pools = pools.filter((p) => p.apy != null && p.apy > 0);

        // Score filtered pools against full dataset for percentile calc
        const scoredPools = pools.map((p) => ({ pool: p, score: scorePool(p, allPools) })).filter((s) => s.score !== null) as Array<{ pool: DefiLlamaPool; score: YieldScore }>;

        // Sort
        if (parsed.sortBy === "tvl") {
          scoredPools.sort((a, b) => b.pool.tvlUsd - a.pool.tvlUsd);
        } else if (parsed.sortBy === "score") {
          scoredPools.sort((a, b) => b.score.total - a.score.total);
        } else {
          scoredPools.sort((a, b) => (b.pool.apy ?? 0) - (a.pool.apy ?? 0));
        }

        // Limit results
        const limited = scoredPools.slice(0, parsed.limit);

        if (limited.length === 0) {
          const tokenMsg = parsed.token ? ` for ${parsed.token.toUpperCase()}` : "";
          const chainMsg = parsed.chainId ? ` on ${CHAIN_ID_TO_LLAMA[parsed.chainId] ?? `chain ${parsed.chainId}`}` : "";
          return {
            success: true,
            message: `No yields found${tokenMsg}${chainMsg} with TVL > ${formatUsd(parsed.minTvl)}. Try lowering the minimum TVL.`,
          };
        }

        // Format results
        const tokenLabel = parsed.token ? parsed.token.toUpperCase() : "All Tokens";
        const chainLabel = parsed.chainId ? CHAIN_ID_TO_LLAMA[parsed.chainId] : "All Chains";
        const sortLabel = parsed.sortBy === "tvl" ? "TVL" : parsed.sortBy === "score" ? "Score" : "APY";

        const lines: string[] = [
          `*Top Yields — ${tokenLabel} (${chainLabel}, sorted by ${sortLabel})*\n`,
        ];

        for (let i = 0; i < limited.length; i++) {
          const { pool, score } = limited[i];
          const apy = pool.apy!.toFixed(2);
          const tvl = formatUsd(pool.tvlUsd);
          lines.push(
            `*${i + 1}.* ${pool.project} — ${pool.symbol}`,
          );
          lines.push(
            `   APY: ${apy}% | TVL: ${tvl} | Score: ${score.total}/400 | ${pool.chain}`,
          );
        }

        return {
          success: true,
          message: lines.join("\n"),
          data: limited.map(({ pool: p, score }) => ({
            project: p.project,
            symbol: p.symbol,
            apy: p.apy,
            tvl: p.tvlUsd,
            chain: p.chain,
            score: score.total,
            scoreBreakdown: score,
          })),
        };
      } catch (err) {
        logger.error({ err }, "Yield finder failed");
        return {
          success: false,
          message: "Failed to fetch yield data from DeFiLlama. Please try again later.",
        };
      }
    },
  };
}
