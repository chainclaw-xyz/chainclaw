import { z } from "zod";
import { parseUnits, type Address, type Hex } from "viem";
import { getLogger, fetchWithRetry, type SkillResult } from "@chainclaw/core";
import { ChainManager } from "@chainclaw/chains";
import type { TransactionExecutor } from "@chainclaw/pipeline";
import type { WalletManager } from "@chainclaw/wallet";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";
import { getTokenPrice, getEthPriceUsd } from "./prices.js";
import { resolveToken, getChainName } from "./token-addresses.js";

const logger = getLogger("skill-rebalance");

const rebalanceParams = z.object({
  action: z.enum(["preview", "execute"]),
  allocations: z.record(z.string(), z.number()), // e.g., { ETH: 50, USDC: 30, DAI: 20 }
  chainId: z.number().optional().default(1),
  slippageBps: z.number().optional(),
});

interface TokenDelta {
  symbol: string;
  currentUsd: number;
  targetUsd: number;
  deltaUsd: number;
  action: "sell" | "buy" | "hold";
}

export function createRebalanceSkill(
  executor: TransactionExecutor,
  walletManager: WalletManager,
  chainManager: ChainManager,
  oneInchApiKey?: string,
): SkillDefinition {
  return {
    name: "rebalance",
    description:
      "Rebalance portfolio to target allocations. Specify percentage per token (must sum to 100). " +
      "Preview mode shows the plan; execute mode swaps to reach targets.",
    parameters: rebalanceParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = rebalanceParams.parse(params);

      if (!context.walletAddress) {
        return { success: false, message: "No wallet configured. Use /wallet create first." };
      }

      const { action, allocations, chainId } = parsed;
      const slippageBps = parsed.slippageBps
        ?? (context.preferences?.slippageTolerance ? context.preferences.slippageTolerance * 100 : undefined)
        ?? 100;

      // Validate allocations sum to 100
      const totalAlloc = Object.values(allocations).reduce((sum, v) => sum + v, 0);
      if (Math.abs(totalAlloc - 100) > 0.01) {
        return { success: false, message: `Allocations must sum to 100% (got ${totalAlloc}%).` };
      }

      // Normalize allocation keys to uppercase
      const normalizedAlloc: Record<string, number> = {};
      for (const [key, val] of Object.entries(allocations)) {
        normalizedAlloc[key.toUpperCase()] = val;
      }

      // Read current portfolio
      const portfolio = await chainManager.getPortfolio(context.walletAddress);
      const chainData = portfolio.chains.find((c) => c.chainId === chainId);

      if (!chainData || chainData.tokens.length === 0) {
        return { success: false, message: `No tokens found on ${getChainName(chainId)}.` };
      }

      // Calculate current USD values
      let totalUsd = 0;
      const currentHoldings: Record<string, number> = {};

      for (const token of chainData.tokens) {
        const balance = parseFloat(token.formatted);
        if (balance === 0) continue;
        const price = await getTokenPrice(token.symbol);
        const usdValue = price ? balance * price : 0;
        currentHoldings[token.symbol.toUpperCase()] = usdValue;
        totalUsd += usdValue;
      }

      if (totalUsd < 1) {
        return { success: false, message: `Portfolio value too low (~$${totalUsd.toFixed(2)}) to rebalance.` };
      }

      // Compute deltas
      const deltas: TokenDelta[] = [];
      const allSymbols = new Set([...Object.keys(normalizedAlloc), ...Object.keys(currentHoldings)]);

      for (const symbol of allSymbols) {
        const currentUsd = currentHoldings[symbol] ?? 0;
        const targetPct = normalizedAlloc[symbol] ?? 0;
        const targetUsd = totalUsd * (targetPct / 100);
        const deltaUsd = targetUsd - currentUsd;

        // Only include if delta is significant (> $1)
        if (Math.abs(deltaUsd) < 1) {
          deltas.push({ symbol, currentUsd, targetUsd, deltaUsd: 0, action: "hold" });
        } else {
          deltas.push({
            symbol,
            currentUsd,
            targetUsd,
            deltaUsd,
            action: deltaUsd < 0 ? "sell" : "buy",
          });
        }
      }

      // Sort: sells first, then buys (sell overweight to fund underweight)
      const sells = deltas.filter((d) => d.action === "sell").sort((a, b) => a.deltaUsd - b.deltaUsd);
      const buys = deltas.filter((d) => d.action === "buy").sort((a, b) => b.deltaUsd - a.deltaUsd);
      const holds = deltas.filter((d) => d.action === "hold");
      const ordered = [...sells, ...buys, ...holds];

      // Format preview
      const previewLines = [
        `*Rebalance Plan — ${getChainName(chainId)}*`,
        `Total value: ~$${totalUsd.toFixed(2)}\n`,
        "```",
        "Token    | Current     | Target      | Delta",
        "─────────┼─────────────┼─────────────┼──────────",
      ];

      for (const d of ordered) {
        const sym = d.symbol.padEnd(8);
        const cur = `$${d.currentUsd.toFixed(2)}`.padEnd(11);
        const tgt = `$${d.targetUsd.toFixed(2)}`.padEnd(11);
        const sign = d.deltaUsd >= 0 ? "+" : "";
        const delta = d.action === "hold" ? "—" : `${sign}$${d.deltaUsd.toFixed(2)}`;
        previewLines.push(`${sym} | ${cur} | ${tgt} | ${delta}`);
      }

      previewLines.push("```");

      const swapCount = sells.length + buys.length;
      if (swapCount === 0) {
        previewLines.push("\nPortfolio is already balanced.");
        return { success: true, message: previewLines.join("\n") };
      }

      previewLines.push(`\n${swapCount} swap(s) needed.`);

      if (action === "preview") {
        previewLines.push("_Use action: execute to rebalance._");
        return { success: true, message: previewLines.join("\n") };
      }

      // Execute mode
      await context.sendReply(previewLines.join("\n"));

      // Ask for confirmation
      if (context.requestConfirmation) {
        const confirmed = await context.requestConfirmation(
          `*Rebalance ${swapCount} swap(s)*\n\n` +
          `Total portfolio: ~$${totalUsd.toFixed(2)}\n` +
          `Chain: ${getChainName(chainId)}\n` +
          `Slippage: ${slippageBps / 100}%\n\n` +
          `Proceed?`,
        );
        if (!confirmed) {
          return { success: false, message: "Rebalance cancelled." };
        }
      }

      // Execute sells first, then buys
      // All trades go through a stable intermediary (USDC) for simplicity
      const trades = [...sells, ...buys];
      let completed = 0;
      let failed = 0;

      for (const trade of trades) {
        const absAmount = Math.abs(trade.deltaUsd);
        if (absAmount < 1) continue;

        // Determine swap direction
        const fromSymbol = trade.action === "sell" ? trade.symbol : "USDC";
        const toSymbol = trade.action === "sell" ? "USDC" : trade.symbol;

        // Get price to convert USD to token amount
        const fromPrice = await getTokenPrice(fromSymbol);
        if (!fromPrice) {
          await context.sendReply(`Skipping ${trade.symbol}: price unavailable.`);
          failed++;
          continue;
        }

        const tokenAmount = (absAmount / fromPrice).toFixed(6);
        const fromInfo = resolveToken(chainId, fromSymbol);
        const toInfo = resolveToken(chainId, toSymbol);

        if (!fromInfo || !toInfo) {
          await context.sendReply(`Skipping ${fromSymbol} → ${toSymbol}: token not supported on ${getChainName(chainId)}.`);
          failed++;
          continue;
        }

        await context.sendReply(`_Swapping ~${tokenAmount} ${fromSymbol} → ${toSymbol}..._`);

        const swapResult = await executeRebalanceSwap(
          executor, walletManager, context, chainId,
          fromSymbol, toSymbol, tokenAmount, fromInfo.decimals,
          fromInfo.address as Address, toInfo.address as Address,
          slippageBps, oneInchApiKey,
        );

        if (swapResult.success) {
          completed++;
          await context.sendReply(`Swap ${completed}/${trades.length}: ${fromSymbol} → ${toSymbol} done.`);
        } else {
          failed++;
          await context.sendReply(`Swap failed: ${fromSymbol} → ${toSymbol}: ${swapResult.message}`);
        }
      }

      return {
        success: failed === 0,
        message: `Rebalance complete: ${completed} succeeded, ${failed} failed out of ${trades.length} swaps.`,
      };
    },
  };
}

async function executeRebalanceSwap(
  executor: TransactionExecutor,
  walletManager: WalletManager,
  context: SkillExecutionContext,
  chainId: number,
  fromSymbol: string,
  toSymbol: string,
  amount: string,
  fromDecimals: number,
  fromAddress: Address,
  toAddress: Address,
  slippageBps: number,
  apiKey?: string,
): Promise<{ success: boolean; message: string }> {
  const isFromNative = fromSymbol === "ETH";
  const fromAddr = isFromNative ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" : fromAddress;
  const isToNative = toSymbol === "ETH";
  const toAddr = isToNative ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" : toAddress;

  const amountWei = parseUnits(amount, fromDecimals).toString();

  const params = new URLSearchParams({
    src: fromAddr,
    dst: toAddr,
    amount: amountWei,
    from: context.walletAddress!,
    slippage: String(slippageBps / 100),
    disableEstimate: "true",
  });

  const endpoint = apiKey ? "swap" : "quote";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetchWithRetry(
      `https://api.1inch.dev/swap/v6.0/${chainId}/${endpoint}?${params.toString()}`,
      { headers },
    );

    if (!response.ok) {
      return { success: false, message: `1inch API error (${response.status})` };
    }

    const quote = (await response.json()) as {
      toAmount: string;
      tx?: { to: string; data: string; value: string; gas: number };
    };

    if (!quote.tx) {
      return { success: false, message: "No executable tx (API key required for live swaps)" };
    }

    const signer = walletManager.getSigner(context.walletAddress!);
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
        skillName: "rebalance",
        intentDescription: `Rebalance: ${amount} ${fromSymbol} → ${toSymbol}`,
        ethPriceUsd: ethPrice,
      },
      {},
    );

    return { success: result.success, message: result.message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, fromSymbol, toSymbol }, "Rebalance swap failed");
    return { success: false, message: msg };
  }
}
