import { z } from "zod";
import { getLogger, fetchWithRetry, type SkillResult } from "@chainclaw/core";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";

const logger = getLogger("skill-yield-finder");

const yieldFinderParams = z.object({
  token: z.string().optional(),
  chainId: z.number().optional(),
  minTvl: z.number().optional().default(1_000_000),
  limit: z.number().optional().default(10),
  sortBy: z.enum(["apy", "tvl"]).optional().default("apy"),
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
        let pools = await fetchPools();

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
              message: `Chain ID ${parsed.chainId} is not supported for yield search. Supported: Ethereum, Base, Arbitrum, Optimism.`,
            };
          }
        }

        // Filter by minimum TVL
        pools = pools.filter((p) => p.tvlUsd >= parsed.minTvl);

        // Filter out pools with null/zero APY
        pools = pools.filter((p) => p.apy != null && p.apy > 0);

        // Sort
        if (parsed.sortBy === "tvl") {
          pools.sort((a, b) => b.tvlUsd - a.tvlUsd);
        } else {
          pools.sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0));
        }

        // Limit results
        pools = pools.slice(0, parsed.limit);

        if (pools.length === 0) {
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
        const sortLabel = parsed.sortBy === "tvl" ? "TVL" : "APY";

        const lines: string[] = [
          `*Top Yields — ${tokenLabel} (${chainLabel}, sorted by ${sortLabel})*\n`,
        ];

        for (let i = 0; i < pools.length; i++) {
          const pool = pools[i];
          const apy = pool.apy!.toFixed(2);
          const tvl = formatUsd(pool.tvlUsd);
          lines.push(
            `*${i + 1}.* ${pool.project} — ${pool.symbol}`,
          );
          lines.push(
            `   APY: ${apy}% | TVL: ${tvl} | ${pool.chain}`,
          );
        }

        return {
          success: true,
          message: lines.join("\n"),
          data: pools.map((p) => ({
            project: p.project,
            symbol: p.symbol,
            apy: p.apy,
            tvl: p.tvlUsd,
            chain: p.chain,
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
