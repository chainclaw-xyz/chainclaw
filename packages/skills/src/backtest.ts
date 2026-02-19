import { z } from "zod";
import { getLogger, type SkillResult } from "@chainclaw/core";
import type { BacktestEngine, AgentDefinition } from "@chainclaw/agent-sdk";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";

const logger = getLogger("skill-backtest");

const backtestParams = z.object({
  action: z.enum(["run"]),
  strategy: z.enum(["dca"]).optional().default("dca"),
  token: z.string().optional().default("ETH"),
  months: z.number().optional().default(6),
  capitalUsd: z.number().optional().default(10000),
  benchmarkToken: z.string().optional(),
});

/**
 * Factory for the backtest chat skill.
 * Requires a BacktestEngine instance and a function that resolves
 * strategy names to AgentDefinitions.
 */
export function createBacktestSkill(
  engine: BacktestEngine,
  resolveAgent: (strategy: string, token: string) => AgentDefinition | null,
): SkillDefinition {
  return {
    name: "backtest",
    description:
      "Run backtests on trading strategies. " +
      "Example: 'Backtest a weekly ETH DCA over the last 6 months with $10k'.",
    parameters: backtestParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = backtestParams.parse(params);

      const agent = resolveAgent(parsed.strategy, parsed.token);
      if (!agent) {
        return {
          success: false,
          message: `Unknown strategy: "${parsed.strategy}". Available: dca.`,
        };
      }

      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - parsed.months);

      await context.sendReply(
        `Running backtest: *${agent.name}* on ${parsed.token}\n` +
        `Period: ${parsed.months} months | Capital: $${parsed.capitalUsd.toLocaleString()}\n` +
        `_This may take a moment..._`,
      );

      try {
        const result = await engine.run({
          agentDefinition: agent,
          startDate,
          endDate,
          startingCapitalUsd: parsed.capitalUsd,
          feePercent: 0.3,
          slippagePercent: 0.5,
          benchmarkToken: parsed.benchmarkToken ?? parsed.token,
        });

        const report = engine.formatReport(result);
        return { success: true, message: report };
      } catch (err) {
        logger.error({ err }, "Backtest failed");
        const message = err instanceof Error ? err.message : "Unknown error";
        return { success: false, message: `Backtest failed: ${message}` };
      }
    },
  };
}
