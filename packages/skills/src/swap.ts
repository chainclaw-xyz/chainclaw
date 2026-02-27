import { z } from "zod";
import { parseEther, parseUnits, type Address, type Hex } from "viem";
import { VersionedTransaction } from "@solana/web3.js";
import { getLogger, fetchWithRetry, type SkillResult } from "@chainclaw/core";
import type { TransactionExecutor, SolanaTransactionExecutor } from "@chainclaw/pipeline";
import type { WalletManager } from "@chainclaw/wallet";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";
import { getEthPriceUsd, getSolPriceUsd } from "./prices.js";
import { TOKEN_INFO, CHAIN_NAMES, resolveToken } from "./token-addresses.js";
import { getJupiterQuote, getJupiterSwapTransaction, formatSolanaTokenAmount } from "./providers/jupiter.js";

const logger = getLogger("skill-swap");

export const swapParams = z.object({
  fromToken: z.string(),
  toToken: z.string(),
  amount: z.string(),
  chainId: z.number().optional().default(1),
  slippageBps: z.number().optional(),
});

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
  solanaExecutor?: SolanaTransactionExecutor,
): SkillDefinition {
  return {
    name: "swap",
    description: "Swap tokens via DEX aggregators. Finds best price across DEXes. Supports EVM chains (1inch) and Solana (Jupiter).",
    parameters: swapParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = swapParams.parse(params);

      if (!context.walletAddress) {
        return { success: false, message: "No wallet configured. Use /wallet create first." };
      }

      const { fromToken, toToken, amount, chainId } = parsed;
      const fromUpper = fromToken.toUpperCase();
      const toUpper = toToken.toUpperCase();

      // Use slippage from LLM params, fall back to user preferences, then default 100 bps (1%)
      const slippageBps = parsed.slippageBps
        ?? (context.preferences?.slippageTolerance ? context.preferences.slippageTolerance * 100 : undefined)
        ?? 100;

      logger.info({ fromToken: fromUpper, toToken: toUpper, amount, chainId, slippageBps }, "Executing swap");

      // ─── Solana swap via Jupiter ─────────────────────────
      if (chainId === 900) {
        return executeSolanaSwap(
          { fromToken: fromUpper, toToken: toUpper, amount, slippageBps },
          context,
          walletManager,
          solanaExecutor,
        );
      }

      // ─── EVM swap via 1inch ──────────────────────────────
      const isFromNative = fromUpper === "ETH";

      // Resolve token addresses
      const chainTokens = TOKEN_INFO[chainId];
      if (!chainTokens && !isFromNative) {
        return { success: false, message: `Chain ${chainId} is not supported for swaps yet.` };
      }

      // Use swap endpoint when API key available, quote endpoint otherwise
      const fromInfo = resolveToken(chainId, fromUpper);
      const toInfo = resolveToken(chainId, toUpper);
      const quote = await getSwapQuote(
        chainId,
        isFromNative ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" : fromInfo?.address,
        toUpper === "ETH" ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" : toInfo?.address,
        amount,
        isFromNative ? 18 : fromInfo?.decimals ?? 18,
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
      const toDecimals = toUpper === "ETH" ? 18 : toInfo?.decimals ?? 18;
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

// ─── Solana Swap (Jupiter) ──────────────────────────────────

async function executeSolanaSwap(
  parsed: { fromToken: string; toToken: string; amount: string; slippageBps: number },
  context: SkillExecutionContext,
  walletManager: WalletManager,
  solanaExecutor?: SolanaTransactionExecutor,
): Promise<SkillResult> {
  if (!solanaExecutor) {
    return { success: false, message: "Solana transaction executor is not configured. Set SOLANA_RPC_URL to enable Solana swaps." };
  }

  const { fromToken, toToken, amount, slippageBps } = parsed;

  // Resolve Solana token mints
  const fromInfo = resolveToken(900, fromToken);
  const toInfo = resolveToken(900, toToken);

  const isFromNative = fromToken === "SOL";
  const isToNative = toToken === "SOL";

  const inputMint = fromInfo?.address ?? (isFromNative ? "So11111111111111111111111111111111111111112" : null);
  const outputMint = toInfo?.address ?? (isToNative ? "So11111111111111111111111111111111111111112" : null);

  if (!inputMint || !outputMint) {
    return { success: false, message: `Could not resolve token${!inputMint ? ` ${fromToken}` : ""}${!outputMint ? ` ${toToken}` : ""} on Solana. Use the token mint address directly.` };
  }

  // Convert amount to smallest unit
  const fromDecimals = fromInfo?.decimals ?? (isFromNative ? 9 : 9);
  const amountSmallest = BigInt(Math.floor(Number(amount) * 10 ** fromDecimals)).toString();

  // Get Jupiter quote
  const quote = await getJupiterQuote(inputMint, outputMint, amountSmallest, slippageBps);

  if (!quote) {
    return { success: false, message: `Could not get a Jupiter quote for ${amount} ${fromToken} → ${toToken} on Solana.` };
  }

  // Format output for user
  const toDecimals = toInfo?.decimals ?? (isToNative ? 9 : 9);
  const estimatedOutput = formatSolanaTokenAmount(quote.outAmount, toDecimals);
  const priceImpact = Number(quote.priceImpactPct).toFixed(2);
  const routeLabels = quote.routePlan.map((r) => r.swapInfo.label).join(" → ");

  await context.sendReply(
    `*Swap Quote (Jupiter)*\n\n` +
    `${amount} ${fromToken} → ~${estimatedOutput} ${toToken}\n` +
    `Chain: Solana\n` +
    `Route: ${routeLabels}\n` +
    `Price impact: ${priceImpact}%\n` +
    `Slippage: ${slippageBps / 100}%\n\n` +
    `_Executing via Jupiter..._`,
  );

  // Get the Solana wallet address
  const solanaAddress = walletManager.getSolanaAddress();
  if (!solanaAddress) {
    return { success: false, message: "No Solana wallet configured. Create one with /wallet create-solana." };
  }

  // Get swap transaction from Jupiter
  const swapResponse = await getJupiterSwapTransaction(quote, solanaAddress);

  if (!swapResponse) {
    return {
      success: true,
      message: `*Quote:* ${amount} ${fromToken} → ~${estimatedOutput} ${toToken}\n_Could not build swap transaction. Jupiter API may be temporarily unavailable._`,
    };
  }

  // Deserialize the versioned transaction
  const transactionBuf = Buffer.from(swapResponse.swapTransaction, "base64");
  const transaction = VersionedTransaction.deserialize(transactionBuf);

  // Get Solana signer
  const signer = walletManager.getSolanaSigner(solanaAddress);
  const solPrice = await getSolPriceUsd();

  // Estimate value in USD for guardrails
  const estimatedSolValue = isFromNative ? Number(amount) : 0;
  const estimatedUsd = estimatedSolValue * solPrice;

  // Execute through Solana pipeline
  const result = await solanaExecutor.executePrebuilt(
    transaction,
    signer,
    {
      userId: context.userId,
      skillName: "swap",
      intentDescription: `Swap ${amount} ${fromToken} → ${toToken} on Solana`,
      solPriceUsd: solPrice,
      estimatedValueUsd: estimatedUsd,
    },
    {
      onSimulated: async (preview) => {
        await context.sendReply(preview);
      },
      onConfirmationRequired: context.requestConfirmation
        ? async (preview) => {
            return context.requestConfirmation!(
              `*Confirmation Required*\n\n${preview}\n\nApprove this swap?`,
            );
          }
        : undefined,
      onBroadcast: async (signature) => {
        await context.sendReply(`Transaction broadcast: \`${signature}\``);
      },
      onConfirmed: async (signature) => {
        await context.sendReply(
          `Swap confirmed on Solana!\n\n` +
          `${amount} ${fromToken} → ~${estimatedOutput} ${toToken}\n` +
          `Signature: \`${signature}\`\n` +
          `[View on Solscan](https://solscan.io/tx/${signature})`,
        );
      },
      onFailed: async (error) => {
        await context.sendReply(`Swap failed: ${error}`);
      },
    },
  );

  return { success: result.success, message: result.message };
}

// ─── EVM Helpers ────────────────────────────────────────────

async function getSwapQuote(
  chainId: number,
  fromAddress: string | undefined,
  toAddress: string | undefined,
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

    const response = await fetchWithRetry(
      `https://api.1inch.dev/swap/v6.0/${chainId}/${endpoint}?${params.toString()}`,
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
