import { z } from "zod";
import { getLogger, type SkillResult } from "@chainclaw/core";
import { ChainManager } from "@chainclaw/chains";
import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet, base, arbitrum, optimism, polygon, bsc, avalanche, zkSync, scroll, blast, gnosis, linea, fantom, mantle } from "viem/chains";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";

const logger = getLogger("skill-airdrop-tracker");

const airdropTrackerParams = z.object({
  address: z.string().optional(),
  chainId: z.number().optional(),
  protocol: z.string().optional(),
});

interface ChainActivity {
  chainId: number;
  chainName: string;
  txCount: number;
}

interface ProtocolScore {
  protocol: string;
  score: number;
  maxScore: number;
  status: string;
  tips: string[];
}

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum",
  10: "Optimism",
  137: "Polygon",
  56: "BNB Chain",
  43114: "Avalanche",
  324: "zkSync Era",
  534352: "Scroll",
  81457: "Blast",
  100: "Gnosis",
  59144: "Linea",
  250: "Fantom",
  5000: "Mantle",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const VIEM_CHAINS: Record<number, any> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
  137: polygon,
  56: bsc,
  43114: avalanche,
  324: zkSync,
  534352: scroll,
  81457: blast,
  100: gnosis,
  59144: linea,
  250: fantom,
  5000: mantle,
};

const SUPPORTED_CHAINS = [1, 8453, 42161, 10, 137, 56, 43114, 324, 534352, 81457, 100, 59144, 250, 5000];

export function createAirdropTrackerSkill(
  chainManager: ChainManager,
  rpcOverrides?: Record<number, string>,
): SkillDefinition {
  // Create public clients for each chain
  const clients = new Map<number, PublicClient>();
  for (const [chainId, chain] of Object.entries(VIEM_CHAINS)) {
    const id = Number(chainId);
    const rpcUrl = rpcOverrides?.[id];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const client = createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient;
    clients.set(id, client);
  }

  return {
    name: "airdrop-tracker",
    description:
      "Check airdrop eligibility across major protocols. Analyzes on-chain activity and " +
      "scores your wallet against known airdrop criteria. Example: 'Check my airdrop eligibility'.",
    parameters: airdropTrackerParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = airdropTrackerParams.parse(params);
      let address = parsed.address ?? context.walletAddress;

      if (!address) {
        return {
          success: false,
          message: "No wallet address provided. Use /wallet to create one, or specify an address to check.",
        };
      }

      // Resolve ENS name if needed
      if (!/^0x[a-fA-F0-9]{40}$/i.test(address)) {
        if (!context.resolveAddress) {
          return { success: false, message: "Invalid wallet address. Please provide a valid Ethereum address (0x...) or ENS name." };
        }
        try {
          const resolved = await context.resolveAddress(address);
          await context.sendReply(`_Resolved ${address} → \`${shortenAddress(resolved)}\`_`);
          address = resolved;
        } catch (err) {
          return { success: false, message: `Could not resolve '${address}': ${err instanceof Error ? err.message : "Unknown error"}` };
        }
      }

      await context.sendReply(`_Analyzing airdrop eligibility for \`${shortenAddress(address)}\`..._`);

      try {
        // Step 1: Gather on-chain activity across all chains
        const chainActivity = await getChainActivity(clients, address);
        const totalTxCount = chainActivity.reduce((sum, c) => sum + c.txCount, 0);
        const activeChains = chainActivity.filter((c) => c.txCount > 0).length;

        // Step 2: Score against protocol-specific criteria
        const scores = scoreProtocols(
          totalTxCount,
          activeChains,
          chainActivity,
          parsed.protocol,
        );

        // Step 3: Format results
        const lines: string[] = [
          `*Airdrop Eligibility — \`${shortenAddress(address)}\`*\n`,
          `*On-Chain Activity Summary*`,
          `  Total transactions: ${totalTxCount}`,
          `  Active chains: ${activeChains}/${SUPPORTED_CHAINS.length}`,
        ];

        for (const ca of chainActivity) {
          if (ca.txCount > 0) {
            lines.push(`  ${ca.chainName}: ${ca.txCount} txns`);
          }
        }

        lines.push("");
        lines.push("*Protocol Scores*\n");

        for (const score of scores) {
          const bar = progressBar(score.score, score.maxScore);
          lines.push(`*${score.protocol}* ${bar} ${score.score}/${score.maxScore} — ${score.status}`);
          if (score.tips.length > 0) {
            for (const tip of score.tips) {
              lines.push(`  → ${tip}`);
            }
          }
        }

        lines.push("");
        lines.push("_Scores are heuristic estimates based on public on-chain data. Not guaranteed eligibility._");

        return {
          success: true,
          message: lines.join("\n"),
          data: { chainActivity, scores },
        };
      } catch (err) {
        logger.error({ err, address }, "Airdrop tracker failed");
        return {
          success: false,
          message: "Failed to analyze airdrop eligibility. Please try again later.",
        };
      }
    },
  };
}

async function getChainActivity(
  clients: Map<number, PublicClient>,
  address: string,
): Promise<ChainActivity[]> {
  const results: ChainActivity[] = [];

  for (const chainId of SUPPORTED_CHAINS) {
    const client = clients.get(chainId);
    if (!client) {
      results.push({ chainId, chainName: CHAIN_NAMES[chainId] ?? `Chain ${chainId}`, txCount: 0 });
      continue;
    }

    try {
      const txCount = await client.getTransactionCount({
        address: address as `0x${string}`,
      });
      results.push({
        chainId,
        chainName: CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
        txCount: Number(txCount),
      });
    } catch (err) {
      logger.warn({ err, chainId, address }, "Failed to get tx count");
      results.push({
        chainId,
        chainName: CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
        txCount: 0,
      });
    }
  }

  return results;
}

function scoreProtocols(
  totalTxCount: number,
  activeChains: number,
  chainActivity: ChainActivity[],
  filterProtocol?: string,
): ProtocolScore[] {
  const allScores: ProtocolScore[] = [
    scoreLayerZero(activeChains, chainActivity),
    scoreZkSync(chainActivity),
    scoreScroll(chainActivity),
    scoreBase(chainActivity),
    scoreArbitrum(chainActivity),
    scoreGenericActivity(totalTxCount, activeChains),
  ];

  if (filterProtocol) {
    const filtered = allScores.filter(
      (s) => s.protocol.toLowerCase().includes(filterProtocol.toLowerCase()),
    );
    return filtered.length > 0 ? filtered : allScores;
  }

  return allScores;
}

function scoreLayerZero(activeChains: number, chainActivity: ChainActivity[]): ProtocolScore {
  let score = 0;
  const maxScore = 10;
  const tips: string[] = [];

  // Cross-chain activity is the main signal
  if (activeChains >= 4) score += 4;
  else if (activeChains >= 3) score += 3;
  else if (activeChains >= 2) score += 2;
  else {
    score += activeChains;
    tips.push(`Bridge to ${4 - activeChains} more chains`);
  }

  // Transaction volume across chains
  const totalCrossChain = chainActivity
    .filter((c) => c.chainId !== 1)
    .reduce((sum, c) => sum + c.txCount, 0);

  if (totalCrossChain >= 50) score += 3;
  else if (totalCrossChain >= 20) score += 2;
  else if (totalCrossChain >= 5) score += 1;
  else tips.push("Do more cross-chain transactions");

  // Ethereum activity
  const ethTx = chainActivity.find((c) => c.chainId === 1)?.txCount ?? 0;
  if (ethTx >= 20) score += 2;
  else if (ethTx >= 5) score += 1;
  else tips.push("Increase Ethereum mainnet activity");

  // Consistency bonus
  if (activeChains >= 3 && totalCrossChain >= 10) score += 1;

  return {
    protocol: "LayerZero",
    score: Math.min(score, maxScore),
    maxScore,
    status: getStatus(score, maxScore),
    tips,
  };
}

function scoreZkSync(chainActivity: ChainActivity[]): ProtocolScore {
  let score = 0;
  const maxScore = 10;
  const tips: string[] = [];

  // zkSync Era is not in our supported chains yet, so use general Ethereum activity as proxy
  const ethTx = chainActivity.find((c) => c.chainId === 1)?.txCount ?? 0;

  if (ethTx >= 100) score += 4;
  else if (ethTx >= 50) score += 3;
  else if (ethTx >= 20) score += 2;
  else if (ethTx >= 5) score += 1;
  else tips.push("Increase Ethereum activity (proxy for L2 eligibility)");

  // Multi-chain activity suggests bridge usage
  const activeChains = chainActivity.filter((c) => c.txCount > 0).length;
  if (activeChains >= 3) score += 3;
  else if (activeChains >= 2) score += 2;
  else tips.push("Use more L2 chains");

  // Volume proxy
  const totalTx = chainActivity.reduce((sum, c) => sum + c.txCount, 0);
  if (totalTx >= 100) score += 3;
  else if (totalTx >= 50) score += 2;
  else if (totalTx >= 20) score += 1;
  else tips.push("Interact with more dApps (50+ txns recommended)");

  return {
    protocol: "zkSync",
    score: Math.min(score, maxScore),
    maxScore,
    status: getStatus(score, maxScore),
    tips,
  };
}

function scoreScroll(chainActivity: ChainActivity[]): ProtocolScore {
  let score = 0;
  const maxScore = 10;
  const tips: string[] = [];

  // Scroll is Ethereum L2 — check Ethereum activity
  const ethTx = chainActivity.find((c) => c.chainId === 1)?.txCount ?? 0;

  if (ethTx >= 50) score += 3;
  else if (ethTx >= 20) score += 2;
  else if (ethTx >= 5) score += 1;
  else tips.push("Increase Ethereum mainnet activity");

  // Cross-chain bridges suggest Scroll usage potential
  const activeChains = chainActivity.filter((c) => c.txCount > 0).length;
  if (activeChains >= 3) score += 3;
  else if (activeChains >= 2) score += 2;
  else tips.push("Bridge to more L2 chains");

  // Total activity
  const totalTx = chainActivity.reduce((sum, c) => sum + c.txCount, 0);
  if (totalTx >= 100) score += 2;
  else if (totalTx >= 30) score += 1;
  else tips.push("Maintain consistent transaction activity");

  // Consistency
  if (ethTx >= 10 && activeChains >= 2) score += 2;

  return {
    protocol: "Scroll",
    score: Math.min(score, maxScore),
    maxScore,
    status: getStatus(score, maxScore),
    tips,
  };
}

function scoreBase(chainActivity: ChainActivity[]): ProtocolScore {
  let score = 0;
  const maxScore = 10;
  const tips: string[] = [];

  const baseTx = chainActivity.find((c) => c.chainId === 8453)?.txCount ?? 0;

  if (baseTx >= 50) score += 5;
  else if (baseTx >= 20) score += 3;
  else if (baseTx >= 5) score += 2;
  else if (baseTx >= 1) score += 1;
  else tips.push("Start using Base chain");

  // Bridge activity (Ethereum ↔ Base)
  const ethTx = chainActivity.find((c) => c.chainId === 1)?.txCount ?? 0;
  if (ethTx >= 10 && baseTx >= 10) score += 3;
  else if (ethTx >= 5 && baseTx >= 5) score += 2;
  else tips.push("Bridge between Ethereum and Base");

  // Multi-chain
  const activeChains = chainActivity.filter((c) => c.txCount > 0).length;
  if (activeChains >= 3) score += 2;

  return {
    protocol: "Base",
    score: Math.min(score, maxScore),
    maxScore,
    status: getStatus(score, maxScore),
    tips,
  };
}

function scoreArbitrum(chainActivity: ChainActivity[]): ProtocolScore {
  let score = 0;
  const maxScore = 10;
  const tips: string[] = [];

  const arbTx = chainActivity.find((c) => c.chainId === 42161)?.txCount ?? 0;

  if (arbTx >= 50) score += 5;
  else if (arbTx >= 20) score += 3;
  else if (arbTx >= 5) score += 2;
  else if (arbTx >= 1) score += 1;
  else tips.push("Start using Arbitrum chain");

  // Bridge activity
  const ethTx = chainActivity.find((c) => c.chainId === 1)?.txCount ?? 0;
  if (ethTx >= 10 && arbTx >= 10) score += 3;
  else if (ethTx >= 5 && arbTx >= 5) score += 2;
  else tips.push("Bridge between Ethereum and Arbitrum");

  // Volume
  if (arbTx >= 30) score += 2;

  return {
    protocol: "Arbitrum (STIP/future)",
    score: Math.min(score, maxScore),
    maxScore,
    status: getStatus(score, maxScore),
    tips,
  };
}

function scoreGenericActivity(totalTxCount: number, activeChains: number): ProtocolScore {
  let score = 0;
  const maxScore = 10;
  const tips: string[] = [];

  if (totalTxCount >= 200) score += 4;
  else if (totalTxCount >= 100) score += 3;
  else if (totalTxCount >= 50) score += 2;
  else if (totalTxCount >= 10) score += 1;
  else tips.push("Increase overall on-chain activity");

  if (activeChains >= 4) score += 3;
  else if (activeChains >= 3) score += 2;
  else if (activeChains >= 2) score += 1;
  else tips.push("Use more chains");

  // Sybil resistance signals
  if (totalTxCount >= 50 && activeChains >= 3) score += 3;
  else if (totalTxCount >= 20 && activeChains >= 2) score += 2;
  else tips.push("Diversify activity across chains and protocols");

  return {
    protocol: "General Eligibility",
    score: Math.min(score, maxScore),
    maxScore,
    status: getStatus(score, maxScore),
    tips,
  };
}

function getStatus(score: number, maxScore: number): string {
  const pct = score / maxScore;
  if (pct >= 0.8) return "Strong";
  if (pct >= 0.6) return "Likely eligible";
  if (pct >= 0.4) return "Moderate";
  if (pct >= 0.2) return "Needs work";
  return "Low activity";
}

function progressBar(score: number, maxScore: number): string {
  const filled = Math.round((score / maxScore) * 5);
  return "█".repeat(filled) + "░".repeat(5 - filled);
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
