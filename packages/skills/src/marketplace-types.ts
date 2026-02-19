/**
 * Structural interfaces for the marketplace skill.
 * These decouple the skill from the concrete @chainclaw/marketplace package,
 * allowing it to work with any implementation that satisfies these contracts.
 */

// ─── Pricing Models ─────────────────────────────────────────

export type PricingModel =
  | { type: "free" }
  | { type: "monthly"; priceUsd: number }
  | { type: "performance_fee"; feePercent: number };

// ─── Marketplace Agent View ─────────────────────────────────

export interface MarketplaceAgentView {
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  pricingModel: PricingModel;
  chainSupport: number[];
  publishedAt: string;
  status: "active" | "paused" | "deprecated";
  subscriberCount: number;
  backtestMetrics?: {
    totalReturnPercent: number;
    winRate: number;
    maxDrawdownPercent: number;
    totalTrades: number;
    sharpeRatio: number;
  };
}

// ─── Subscription View ──────────────────────────────────────

export interface SubscriptionView {
  id: string;
  userId: string;
  agentName: string;
  subscribedAt: string;
  cancelledAt: string | null;
  status: "active" | "cancelled";
  instanceId: string | null;
}

// ─── Service Interfaces ─────────────────────────────────────

/** What the marketplace skill needs from AgentRegistry. */
export interface AgentRegistryLike {
  listAgents(): MarketplaceAgentView[];
  search(query: string): MarketplaceAgentView[];
  getAgent(name: string): MarketplaceAgentView | null;
  getByCategory(category: string): MarketplaceAgentView[];
}

/** What the marketplace skill needs from SubscriptionManager. */
export interface SubscriptionManagerLike {
  subscribe(userId: string, agentName: string, options?: Record<string, unknown>): SubscriptionView;
  unsubscribe(subscriptionId: string): boolean;
  getUserSubscriptions(userId: string): SubscriptionView[];
}

/** What the marketplace skill needs from LeaderboardService. */
export interface LeaderboardServiceLike {
  formatLeaderboard(options: { category?: string }): string;
}
