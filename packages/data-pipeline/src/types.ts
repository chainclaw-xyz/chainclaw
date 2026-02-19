import { z } from "zod";

// ─── Outcome Label Windows ──────────────────────────────────

export const LABEL_WINDOWS = ["1h", "24h", "7d"] as const;
export type LabelWindow = (typeof LABEL_WINDOWS)[number];

export const labelWindowMs: Record<LabelWindow, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

// ─── Outcome Label ──────────────────────────────────────────

export const outcomeLabelSchema = z.object({
  tradeId: z.string(),
  agentId: z.string(),
  token: z.string(),
  action: z.enum(["buy", "sell"]),
  priceAtExecution: z.number(),
  window: z.enum(LABEL_WINDOWS),
  priceAtWindow: z.number(),
  pnlUsd: z.number(),
  pnlPercent: z.number(),
  labeledAt: z.number(),
});

export type OutcomeLabel = z.infer<typeof outcomeLabelSchema>;

// ─── Training Data Example ──────────────────────────────────

export const trainingExampleSchema = z.object({
  id: z.string(),
  tradeId: z.string(),
  agentId: z.string(),
  context: z.object({
    prices: z.record(z.number()),
    portfolio: z.record(z.number()),
    totalValueUsd: z.number(),
    timestamp: z.number(),
  }),
  decision: z.object({
    action: z.enum(["buy", "sell", "hold"]),
    token: z.string(),
    amountUsd: z.number(),
    chainId: z.number(),
  }),
  reasoning: z.string(),
  enrichedReasoning: z.string().optional(),
  outcomes: z
    .record(
      z.object({
        pnlUsd: z.number(),
        pnlPercent: z.number(),
        priceAtWindow: z.number(),
      }),
    )
    .optional(),
  createdAt: z.number(),
});

export type TrainingExample = z.infer<typeof trainingExampleSchema>;

// ─── Export Formats ─────────────────────────────────────────

export type ExportFormat = "alpaca" | "chatml" | "jsonl";

export interface AlpacaExample {
  instruction: string;
  input: string;
  output: string;
}

export interface ChatMLExample {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}

// ─── Enrichment Result ──────────────────────────────────────

export interface EnrichmentResult {
  traceId: number;
  enrichedReasoning: string;
  tokensUsed: number;
}

// ─── Labeler Stats ──────────────────────────────────────────

export interface LabelingStats {
  processed: number;
  labeled: number;
  skipped: number;
  errors: number;
}

// ─── Export Stats ───────────────────────────────────────────

export interface ExportStats {
  totalExamples: number;
  exportedExamples: number;
  format: ExportFormat;
  outputPath: string;
}

// ─── Export Options ─────────────────────────────────────────

export interface ExportOptions {
  format: ExportFormat;
  minOutcomeWindow?: LabelWindow;
  onlyProfitable?: boolean;
  agentId?: string;
  limit?: number;
  includeEnrichedOnly?: boolean;
}

// ─── Managed Hosting Tiers ──────────────────────────────────

export const hostingTierSchema = z.object({
  id: z.enum(["starter", "pro", "enterprise"]),
  name: z.string(),
  priceUsd: z.number(),
  maxAgents: z.number(),
  maxTradesPerDay: z.number(),
  backtestingIncluded: z.boolean(),
  prioritySupport: z.boolean(),
  customModels: z.boolean(),
  dataExportAccess: z.boolean(),
});

export type HostingTier = z.infer<typeof hostingTierSchema>;

export const HOSTING_TIERS: HostingTier[] = [
  {
    id: "starter",
    name: "Starter",
    priceUsd: 29,
    maxAgents: 3,
    maxTradesPerDay: 50,
    backtestingIncluded: false,
    prioritySupport: false,
    customModels: false,
    dataExportAccess: false,
  },
  {
    id: "pro",
    name: "Pro",
    priceUsd: 59,
    maxAgents: 10,
    maxTradesPerDay: 200,
    backtestingIncluded: true,
    prioritySupport: false,
    customModels: false,
    dataExportAccess: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceUsd: 99,
    maxAgents: 50,
    maxTradesPerDay: 1000,
    backtestingIncluded: true,
    prioritySupport: true,
    customModels: true,
    dataExportAccess: true,
  },
];
