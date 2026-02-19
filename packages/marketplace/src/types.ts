import type { AgentCategory, AgentDefinition, BacktestMetrics } from "@chainclaw/agent-sdk";

// ─── Agent Factory ──────────────────────────────────────────

/** A factory function that creates an AgentDefinition with optional config overrides. */
export type AgentFactory = (options?: Record<string, unknown>) => AgentDefinition;

// ─── Pricing Models ─────────────────────────────────────────

export type PricingModel =
  | { type: "free" }
  | { type: "monthly"; priceUsd: number }
  | { type: "performance_fee"; feePercent: number };

// ─── Marketplace Agent ──────────────────────────────────────

export interface MarketplaceAgent {
  name: string;
  version: string;
  description: string;
  author: string;
  category: AgentCategory;
  pricingModel: PricingModel;
  chainSupport: number[];
  publishedAt: string;
  status: "active" | "paused" | "deprecated";
  subscriberCount: number;
  backtestMetrics?: BacktestMetrics;
}

// ─── Publish Metadata ───────────────────────────────────────

export interface PublishMetadata {
  version: string;
  description: string;
  author: string;
  category: AgentCategory;
  pricingModel?: PricingModel;
  chainSupport?: number[];
  backtestMetrics?: BacktestMetrics;
}

// ─── Subscription ───────────────────────────────────────────

export interface Subscription {
  id: string;
  userId: string;
  agentName: string;
  subscribedAt: string;
  cancelledAt: string | null;
  status: "active" | "cancelled";
  instanceId: string | null;
}

// ─── Leaderboard ────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  agentName: string;
  category: AgentCategory;
  totalReturnPercent: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdownPercent: number;
  totalTrades: number;
  subscriberCount: number;
}

export type LeaderboardTimeWindow = "7d" | "30d" | "90d" | "all";

export interface LeaderboardOptions {
  category?: AgentCategory;
  timeWindow?: LeaderboardTimeWindow;
  limit?: number;
}
