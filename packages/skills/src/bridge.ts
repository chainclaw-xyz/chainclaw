import { z } from "zod";
import { type Address, type Hex } from "viem";
import { getLogger, fetchWithRetry, type SkillResult } from "@chainclaw/core";
import type { TransactionExecutor } from "@chainclaw/pipeline";
import type { WalletManager } from "@chainclaw/wallet";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";
import { getEthPriceUsd } from "./prices.js";

const logger = getLogger("skill-bridge");

const bridgeParams = z.object({
  token: z.string(),
  amount: z.string(),
  fromChainId: z.number(),
  toChainId: z.number(),
  slippageBps: z.number().optional(),
});

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum",
  10: "Optimism",
};

// Native token address used by Li.Fi
const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

// Token addresses per chain for Li.Fi
const TOKEN_ADDRESSES: Record<number, Record<string, Address>> = {
  1: {
    ETH: NATIVE_TOKEN as Address,
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  },
  8453: {
    ETH: NATIVE_TOKEN as Address,
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
  },
  42161: {
    ETH: NATIVE_TOKEN as Address,
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
  },
  10: {
    ETH: NATIVE_TOKEN as Address,
    USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
  },
};

// Token decimals
const TOKEN_DECIMALS: Record<string, number> = {
  ETH: 18,
  USDC: 6,
  USDT: 6,
  DAI: 18,
};

interface LiFiQuoteResponse {
  estimate: {
    toAmount: string;
    toAmountMin: string;
    approvalAddress?: string;
    executionDuration: number;
    gasCosts: Array<{ amountUSD: string }>;
    feeCosts: Array<{ amountUSD: string }>;
  };
  transactionRequest?: {
    to: string;
    data: string;
    value: string;
    gasLimit: string;
    chainId: number;
  };
  tool: string;
  toolDetails?: {
    name: string;
  };
  action: {
    fromChainId: number;
    toChainId: number;
    fromToken: { symbol: string; decimals: number };
    toToken: { symbol: string; decimals: number };
  };
}

export function createBridgeSkill(
  executor: TransactionExecutor,
  walletManager: WalletManager,
): SkillDefinition {
  return {
    name: "bridge",
    description: "Bridge tokens across chains via Li.Fi. Finds best route for speed and cost.",
    parameters: bridgeParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = bridgeParams.parse(params);

      if (!context.walletAddress) {
        return { success: false, message: "No wallet configured. Use /wallet create first." };
      }

      const { token, amount, fromChainId, toChainId } = parsed;
      const tokenUpper = token.toUpperCase();
      const slippageBps = parsed.slippageBps
        ?? (context.preferences?.slippageTolerance ? context.preferences.slippageTolerance * 100 : undefined)
        ?? 100;

      const fromChainName = CHAIN_NAMES[fromChainId] ?? `Chain ${fromChainId}`;
      const toChainName = CHAIN_NAMES[toChainId] ?? `Chain ${toChainId}`;

      logger.info({ token: tokenUpper, amount, fromChainId, toChainId }, "Executing bridge");

      if (fromChainId === toChainId) {
        return { success: false, message: "Source and destination chains must be different." };
      }

      // Resolve token addresses
      const fromTokenAddress = TOKEN_ADDRESSES[fromChainId]?.[tokenUpper];
      const toTokenAddress = TOKEN_ADDRESSES[toChainId]?.[tokenUpper];

      if (!fromTokenAddress) {
        return { success: false, message: `${tokenUpper} is not supported on ${fromChainName} for bridging.` };
      }
      if (!toTokenAddress) {
        return { success: false, message: `${tokenUpper} is not supported on ${toChainName} for bridging.` };
      }

      const decimals = TOKEN_DECIMALS[tokenUpper] ?? 18;

      await context.sendReply(
        `_Finding best bridge route for ${amount} ${tokenUpper} from ${fromChainName} to ${toChainName}..._`,
      );

      // Get Li.Fi quote
      const quote = await getLiFiQuote(
        fromChainId,
        toChainId,
        fromTokenAddress,
        toTokenAddress,
        amount,
        decimals,
        context.walletAddress as Address,
        slippageBps,
      );

      if (!quote) {
        return {
          success: false,
          message: `Could not find a bridge route for ${amount} ${tokenUpper} from ${fromChainName} to ${toChainName}. The Li.Fi API may be unavailable or no routes exist for this pair.`,
        };
      }

      // Format estimated output
      const toDecimals = quote.action.toToken.decimals;
      const estimatedOutput = formatTokenAmount(quote.estimate.toAmount, toDecimals);
      const minOutput = formatTokenAmount(quote.estimate.toAmountMin, toDecimals);
      const durationMin = Math.ceil(quote.estimate.executionDuration / 60);
      const gasCost = quote.estimate.gasCosts.reduce((sum, g) => sum + Number(g.amountUSD), 0).toFixed(2);
      const bridgeName = quote.toolDetails?.name ?? quote.tool;

      await context.sendReply(
        `*Bridge Quote*\n\n` +
        `${amount} ${tokenUpper} (${fromChainName}) → ~${estimatedOutput} ${tokenUpper} (${toChainName})\n` +
        `Min received: ${minOutput} ${tokenUpper}\n` +
        `Est. time: ~${durationMin} min\n` +
        `Gas cost: ~$${gasCost}\n` +
        `Route: ${bridgeName}\n` +
        `Slippage: ${slippageBps / 100}%`,
      );

      if (!quote.transactionRequest) {
        return {
          success: true,
          message: `*Quote:* ${amount} ${tokenUpper} (${fromChainName}) → ~${estimatedOutput} ${tokenUpper} (${toChainName})\n_Bridge execution data not available from Li.Fi for this route._`,
        };
      }

      // Ask for confirmation if available
      if (context.requestConfirmation) {
        const confirmed = await context.requestConfirmation(
          `*Bridge ${amount} ${tokenUpper}*\n\n` +
          `From: ${fromChainName}\n` +
          `To: ${toChainName}\n` +
          `You receive: ~${estimatedOutput} ${tokenUpper}\n` +
          `Est. time: ~${durationMin} min\n` +
          `Gas: ~$${gasCost}\n\n` +
          `Proceed with this bridge?`,
        );
        if (!confirmed) {
          return { success: false, message: "Bridge cancelled." };
        }
      }

      // Execute through pipeline
      const signer = walletManager.getSigner(context.walletAddress);
      const ethPrice = await getEthPriceUsd();
      const txReq = quote.transactionRequest;

      const result = await executor.execute(
        {
          chainId: txReq.chainId,
          from: context.walletAddress as Address,
          to: txReq.to as Address,
          value: BigInt(txReq.value),
          data: txReq.data as Hex,
          gasLimit: BigInt(txReq.gasLimit),
        },
        signer,
        {
          userId: context.userId,
          skillName: "bridge",
          intentDescription: `Bridge ${amount} ${tokenUpper} from ${fromChainName} to ${toChainName}`,
          ethPriceUsd: ethPrice,
        },
        {
          onSimulated: async (_sim, preview) => {
            await context.sendReply(preview);
          },
          onRiskWarning: context.requestConfirmation
            ? async (warning) => context.requestConfirmation!(`*Risk Warning*\n\n${warning}\n\nProceed?`)
            : undefined,
          onBroadcast: async (hash) => {
            await context.sendReply(
              `Bridge tx broadcast: \`${hash}\`\n_Funds should arrive on ${toChainName} in ~${durationMin} min._`,
            );
          },
          onConfirmed: async (_hash, blockNumber) => {
            await context.sendReply(
              `Bridge source tx confirmed in block ${blockNumber}!\n\n` +
              `${amount} ${tokenUpper} (${fromChainName}) → ~${estimatedOutput} ${tokenUpper} (${toChainName})\n` +
              `_Check your ${toChainName} balance in a few minutes._`,
            );
          },
          onFailed: async (error) => {
            await context.sendReply(`Bridge failed: ${error}`);
          },
        },
      );

      return { success: result.success, message: result.message };
    },
  };
}

async function getLiFiQuote(
  fromChainId: number,
  toChainId: number,
  fromTokenAddress: Address,
  toTokenAddress: Address,
  amount: string,
  decimals: number,
  walletAddress: Address,
  slippageBps: number,
): Promise<LiFiQuoteResponse | null> {
  const amountWei = BigInt(Math.round(Number(amount) * 10 ** decimals)).toString();

  try {
    const params = new URLSearchParams({
      fromChain: String(fromChainId),
      toChain: String(toChainId),
      fromToken: fromTokenAddress,
      toToken: toTokenAddress,
      fromAmount: amountWei,
      fromAddress: walletAddress,
      toAddress: walletAddress,
      slippage: String(slippageBps / 10000), // Li.Fi expects 0-1 range
      order: "RECOMMENDED",
    });

    const response = await fetchWithRetry(`https://li.quest/v1/quote?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const body = await response.text();
      logger.warn({ status: response.status, body: body.substring(0, 200) }, "Li.Fi quote API error");
      return null;
    }

    return (await response.json()) as LiFiQuoteResponse;
  } catch (err) {
    logger.error({ err }, "Failed to get Li.Fi quote");
    return null;
  }
}

function formatTokenAmount(rawAmount: string, decimals: number): string {
  const value = Number(BigInt(rawAmount)) / 10 ** decimals;
  if (value < 0.0001) return "<0.0001";
  if (value < 1) return value.toFixed(4);
  if (value < 10000) return value.toFixed(2);
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
