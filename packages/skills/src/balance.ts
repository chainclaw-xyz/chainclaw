import { z } from "zod";
import type { SkillResult } from "@chainclaw/core";
import { ChainManager } from "@chainclaw/chains";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";

const balanceParams = z.object({
  chainId: z.number().optional(),
});

export function createBalanceSkill(chainManager: ChainManager): SkillDefinition {
  return {
    name: "balance",
    description: "Check token balances across connected chains",
    parameters: balanceParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = balanceParams.parse(params);

      if (!context.walletAddress) {
        return {
          success: false,
          message: "No wallet configured. Use /wallet to create or import one.",
        };
      }

      const portfolio = await chainManager.getPortfolio(context.walletAddress);

      // Filter to specific chain if requested
      const chains = parsed.chainId
        ? portfolio.chains.filter((c) => c.chainId === parsed.chainId)
        : portfolio.chains;

      if (chains.length === 0) {
        return {
          success: true,
          message: `No balances found for ${context.walletAddress}`,
        };
      }

      // Format response
      const lines: string[] = [
        `*Portfolio for* \`${shortenAddress(context.walletAddress)}\``,
        "",
      ];

      for (const chain of chains) {
        lines.push(`*${chain.chainName}*`);
        if (chain.tokens.length === 0) {
          lines.push("  No tokens found");
        } else {
          for (const token of chain.tokens) {
            const formatted = formatBalance(token.formatted);
            lines.push(`  ${token.symbol}: ${formatted}`);
          }
        }
        lines.push("");
      }

      return {
        success: true,
        message: lines.join("\n"),
        data: portfolio,
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
  if (num < 1000) return num.toFixed(2);
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
