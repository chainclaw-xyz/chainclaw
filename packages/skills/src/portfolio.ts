import { z } from "zod";
import type { SkillResult } from "@chainclaw/core";
import { ChainManager } from "@chainclaw/chains";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";
import { getTokenPrice } from "./prices.js";

const portfolioParams = z.object({
  chainId: z.number().optional(),
});

export function createPortfolioSkill(chainManager: ChainManager): SkillDefinition {
  return {
    name: "portfolio",
    description: "Show portfolio with USD values across all connected chains",
    parameters: portfolioParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = portfolioParams.parse(params);

      if (!context.walletAddress) {
        return { success: false, message: "No wallet configured. Use /wallet create first." };
      }

      const portfolio = await chainManager.getPortfolio(context.walletAddress);

      const chains = parsed.chainId
        ? portfolio.chains.filter((c) => c.chainId === parsed.chainId)
        : portfolio.chains;

      if (chains.length === 0) {
        return { success: true, message: `No balances found for \`${shortenAddress(context.walletAddress)}\`` };
      }

      const lines: string[] = [
        `*Portfolio — \`${shortenAddress(context.walletAddress)}\`*`,
        "",
      ];

      let totalUsd = 0;

      for (const chain of chains) {
        lines.push(`*${chain.chainName}*`);

        if (chain.tokens.length === 0) {
          lines.push("  No tokens found");
        } else {
          for (const token of chain.tokens) {
            const balance = parseFloat(token.formatted);
            if (balance === 0) continue;

            const price = await getTokenPrice(token.symbol);
            const usdValue = price ? balance * price : null;
            if (usdValue) totalUsd += usdValue;

            const balanceStr = formatBalance(token.formatted);
            const usdStr = usdValue ? ` ($${formatUsd(usdValue)})` : "";
            lines.push(`  ${token.symbol}: ${balanceStr}${usdStr}`);
          }
        }
        lines.push("");
      }

      lines.push(`*Total: ~$${formatUsd(totalUsd)}*`);

      return {
        success: true,
        message: lines.join("\n"),
        data: { totalUsd, portfolio },
      };
    },
  };
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatBalance(value: string): string {
  const num = parseFloat(value);
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  if (num < 1) return num.toFixed(4);
  if (num < 1000) return num.toFixed(4);
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatUsd(value: number): string {
  if (value < 0.01) return "<0.01";
  if (value < 1000) return value.toFixed(2);
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
