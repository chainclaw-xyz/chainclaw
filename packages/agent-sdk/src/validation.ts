import { z } from "zod";

export const riskParametersSchema = z.object({
  maxPositionSizeUsd: z.number().positive(),
  maxDrawdownPercent: z.number().min(1).max(100),
  maxDailyTradesCount: z.number().int().positive(),
  maxDailyExposureUsd: z.number().positive(),
  stopLossPercent: z.number().min(0).max(100).optional(),
  takeProfitPercent: z.number().min(0).max(1000).optional(),
  allowedChainIds: z.array(z.number()).min(1),
  allowedTokens: z.array(z.string()).optional(),
  blockedTokens: z.array(z.string()).optional(),
});

export const agentDefinitionSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(10).max(500),
  author: z.string().min(1).max(64),
  category: z.enum(["yield", "trading", "lp", "dca", "risk", "airdrop", "multi-strategy"]),
  skills: z.array(z.string()).min(1),
  knowledgeSources: z.array(z.object({
    type: z.enum(["price_feed", "on_chain", "social", "custom"]),
    name: z.string(),
    description: z.string(),
    fetch: z.function(),
  })),
  riskParams: riskParametersSchema,
  strategy: z.object({
    evaluate: z.function(),
    evaluationIntervalMs: z.number().min(1000),
    watchlist: z.array(z.string()).min(1),
  }),
});

export const backtestConfigSchema = z.object({
  startDate: z.date(),
  endDate: z.date(),
  startingCapitalUsd: z.number().positive(),
  feePercent: z.number().min(0).max(10).default(0.3),
  slippagePercent: z.number().min(0).max(10).default(0.5),
  benchmarkToken: z.string().optional(),
}).refine(
  (d) => d.endDate > d.startDate,
  { message: "endDate must be after startDate" },
);

export function validateAgentDefinition(def: unknown): void {
  agentDefinitionSchema.parse(def);
}
