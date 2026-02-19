import { z } from "zod";
import { parseEther, parseUnits, type Address, type Hex } from "viem";
import { getLogger, type SkillResult } from "@chainclaw/core";
import type { TransactionExecutor } from "@chainclaw/pipeline";
import type { WalletManager } from "@chainclaw/wallet";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";
import { getEthPriceUsd } from "./prices.js";

const logger = getLogger("skill-swap");

const swapParams = z.object({
  fromToken: z.string(),
  toToken: z.string(),
  amount: z.string(),
  chainId: z.number().optional().default(1),
  slippageBps: z.number().optional(),
});

// Known token addresses per chain
const TOKEN_ADDRESSES: Record<number, Record<string, { address: Address; decimals: number }>> = {
  1: {
    USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
    DAI: { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
  },
  8453: {
    USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    DAI: { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
  },
  42161: {
    USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    USDT: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
    WETH: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
    DAI: { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 },
    ARB: { address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18 },
  },
  10: {
    USDC: { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
    USDT: { address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
    WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    DAI: { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 },
    OP: { address: "0x4200000000000000000000000000000000000042", decimals: 18 },
  },
};

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum",
  10: "Optimism",
};

interface OneInchQuoteResponse {
  toAmount: string;
  tx?: {
    to: string;
    data: string;
    value: string;
    gas: number;
  };
}

export function createSwapSkill(
  executor: TransactionExecutor,
  walletManager: WalletManager,
  apiKey?: string,
): SkillDefinition {
  return {
    name: "swap",
    description: "Swap tokens via DEX aggregators. Finds best price across DEXes.",
    parameters: swapParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = swapParams.parse(params);

      if (!context.walletAddress) {
        return { success: false, message: "No wallet configured. Use /wallet create first." };
      }

      const { fromToken, toToken, amount, chainId } = parsed;
      const fromUpper = fromToken.toUpperCase();
      const toUpper = toToken.toUpperCase();
      const isFromNative = fromUpper === "ETH";

      // Use slippage from LLM params, fall back to user preferences, then default 100 bps (1%)
      const slippageBps = parsed.slippageBps
        ?? (context.preferences?.slippageTolerance ? context.preferences.slippageTolerance * 100 : undefined)
        ?? 100;

      logger.info({ fromToken: fromUpper, toToken: toUpper, amount, chainId, slippageBps }, "Executing swap");

      // Resolve token addresses
      const chainTokens = TOKEN_ADDRESSES[chainId];
      if (!chainTokens && !isFromNative) {
        return { success: false, message: `Chain ${chainId} is not supported for swaps yet.` };
      }

      // Use swap endpoint when API key available, quote endpoint otherwise
      const quote = await getSwapQuote(
        chainId,
        isFromNative ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" : chainTokens[fromUpper]?.address,
        toUpper === "ETH" ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" : chainTokens[toUpper]?.address,
        amount,
        isFromNative ? 18 : chainTokens[fromUpper]?.decimals ?? 18,
        context.walletAddress as Address,
        slippageBps,
        apiKey,
      );

      if (!quote) {
        return {
          success: false,
          message: `Could not get a swap quote for ${amount} ${fromUpper} → ${toUpper} on chain ${chainId}. The 1inch API may be unavailable or the token pair is not supported.`,
        };
      }

      // Format quote for user
      const toDecimals = toUpper === "ETH" ? 18 : chainTokens?.[toUpper]?.decimals ?? 18;
      const estimatedOutput = formatTokenAmount(quote.toAmount, toDecimals);

      await context.sendReply(
        `*Swap Quote*\n\n` +
        `${amount} ${fromUpper} → ~${estimatedOutput} ${toUpper}\n` +
        `Chain: ${CHAIN_NAMES[chainId] ?? `Chain ${chainId}`}\n` +
        `Slippage: ${slippageBps / 100}%\n\n` +
        `_Executing via 1inch..._`,
      );

      if (!quote.tx) {
        return {
          success: true,
          message: `*Quote:* ${amount} ${fromUpper} → ~${estimatedOutput} ${toUpper}\n_Swap execution requires 1INCH\\_API\\_KEY for live swaps. Currently showing quotes only._`,
        };
      }

      // Execute through pipeline
      const signer = walletManager.getSigner(context.walletAddress);
      const ethPrice = await getEthPriceUsd();

      const result = await executor.execute(
        {
          chainId,
          from: context.walletAddress as Address,
          to: quote.tx.to as Address,
          value: BigInt(quote.tx.value),
          data: quote.tx.data as Hex,
          gasLimit: BigInt(quote.tx.gas),
        },
        signer,
        {
          userId: context.userId,
          skillName: "swap",
          intentDescription: `Swap ${amount} ${fromUpper} → ${toUpper}`,
          ethPriceUsd: ethPrice,
        },
        {
          onSimulated: async (_sim, preview) => {
            await context.sendReply(preview);
          },
          onRiskWarning: context.requestConfirmation
            ? async (warning) => {
                return context.requestConfirmation!(
                  `*Risk Warning*\n\n${warning}\n\nDo you want to proceed?`,
                );
              }
            : undefined,
          onConfirmationRequired: context.requestConfirmation
            ? async (preview) => {
                return context.requestConfirmation!(
                  `*Confirmation Required*\n\n${preview}\n\nApprove this transaction?`,
                );
              }
            : undefined,
          onBroadcast: async (hash) => {
            await context.sendReply(`Transaction broadcast: \`${hash}\``);
          },
          onConfirmed: async (hash, blockNumber) => {
            await context.sendReply(
              `Swap confirmed in block ${blockNumber}!\n\n` +
              `${amount} ${fromUpper} → ~${estimatedOutput} ${toUpper}`,
            );
          },
          onFailed: async (error) => {
            await context.sendReply(`Swap failed: ${error}`);
          },
        },
      );

      return { success: result.success, message: result.message };
    },
  };
}

async function getSwapQuote(
  chainId: number,
  fromAddress: Address | string | undefined,
  toAddress: Address | string | undefined,
  amount: string,
  fromDecimals: number,
  walletAddress: Address,
  slippageBps: number,
  apiKey?: string,
): Promise<OneInchQuoteResponse | null> {
  if (!fromAddress || !toAddress) return null;

  const amountWei = fromDecimals === 18
    ? parseEther(amount).toString()
    : parseUnits(amount, fromDecimals).toString();

  try {
    const params = new URLSearchParams({
      src: fromAddress,
      dst: toAddress,
      amount: amountWei,
      from: walletAddress,
      slippage: String(slippageBps / 100), // convert bps to %
      disableEstimate: "true",
    });

    // Use swap endpoint with API key for executable tx, quote endpoint otherwise
    const endpoint = apiKey ? "swap" : "quote";
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(
      `https://api.1inch.dev/swap/v6.0/${chainId}/${endpoint}?${params}`,
      { headers },
    );

    if (!response.ok) {
      logger.warn({ status: response.status, chainId, endpoint }, "1inch API error");
      return null;
    }

    return (await response.json()) as OneInchQuoteResponse;
  } catch (err) {
    logger.error({ err }, "Failed to get swap quote");
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
