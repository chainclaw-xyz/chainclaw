import { z } from "zod";
import type { SkillResult } from "@chainclaw/core";
import type { AgentRegistryLike, SubscriptionManagerLike, LeaderboardServiceLike } from "./marketplace-types.js";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";

const marketplaceParams = z.object({
  action: z.enum(["browse", "search", "detail", "subscribe", "unsubscribe", "my-agents", "leaderboard"]),
  query: z.string().optional(),
  agentName: z.string().optional(),
  category: z.enum(["yield", "trading", "lp", "dca", "risk", "airdrop", "multi-strategy"]).optional(),
  subscriptionId: z.string().optional(),
  token: z.string().optional(),
});

type MarketplaceParams = z.infer<typeof marketplaceParams>;

/**
 * Factory for the marketplace chat skill.
 * Allows users to browse, search, subscribe to, and manage marketplace agents via chat.
 */
export function createMarketplaceSkill(
  registry: AgentRegistryLike,
  subscriptions: SubscriptionManagerLike,
  leaderboard: LeaderboardServiceLike,
): SkillDefinition {
  return {
    name: "marketplace",
    description:
      "Browse and manage the agent marketplace. Discover agents, subscribe, view leaderboards. " +
      "Example: 'Browse marketplace agents', 'Subscribe to dca agent', 'Show leaderboard'.",
    parameters: marketplaceParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = marketplaceParams.parse(params);

      switch (parsed.action) {
        case "browse":
          return handleBrowse(registry, parsed);
        case "search":
          return handleSearch(registry, parsed);
        case "detail":
          return handleDetail(registry, parsed);
        case "subscribe":
          return handleSubscribe(subscriptions, parsed, context);
        case "unsubscribe":
          return handleUnsubscribe(subscriptions, parsed);
        case "my-agents":
          return handleMyAgents(subscriptions, context);
        case "leaderboard":
          return handleLeaderboard(leaderboard, parsed);
      }
    },
  };
}

function handleBrowse(registry: AgentRegistryLike, parsed: MarketplaceParams): SkillResult {
  const agents = parsed.category
    ? registry.getByCategory(parsed.category)
    : registry.listAgents();

  if (agents.length === 0) {
    return { success: true, message: "_No agents available in the marketplace yet._" };
  }

  const categoryLabel = parsed.category ? ` (${parsed.category})` : "";
  const lines = [`*Marketplace Agents${categoryLabel}*\n`];

  for (const agent of agents) {
    const pricing = agent.pricingModel.type === "free"
      ? "Free"
      : agent.pricingModel.type === "monthly"
        ? `$${agent.pricingModel.priceUsd}/mo`
        : `${agent.pricingModel.feePercent}% perf fee`;
    lines.push(
      `*${agent.name}* v${agent.version} — ${agent.category}`,
      `  ${agent.description}`,
      `  ${pricing} | ${agent.subscriberCount} subscribers`,
      "",
    );
  }

  lines.push(`_Use "marketplace detail <name>" for more info._`);
  return { success: true, message: lines.join("\n") };
}

function handleSearch(registry: AgentRegistryLike, parsed: MarketplaceParams): SkillResult {
  if (!parsed.query) {
    return { success: false, message: "Please provide a search query." };
  }

  const agents = registry.search(parsed.query);

  if (agents.length === 0) {
    return { success: true, message: `_No agents matching "${parsed.query}"._` };
  }

  const lines = [`*Search Results: "${parsed.query}"*\n`];
  for (const agent of agents) {
    lines.push(`*${agent.name}* — ${agent.category}\n  ${agent.description}`);
  }

  return { success: true, message: lines.join("\n") };
}

function handleDetail(registry: AgentRegistryLike, parsed: MarketplaceParams): SkillResult {
  if (!parsed.agentName) {
    return { success: false, message: "Please specify an agent name." };
  }

  const agent = registry.getAgent(parsed.agentName);
  if (!agent) {
    return { success: false, message: `Agent "${parsed.agentName}" not found.` };
  }

  const pricing = agent.pricingModel.type === "free"
    ? "Free"
    : agent.pricingModel.type === "monthly"
      ? `$${agent.pricingModel.priceUsd}/month`
      : `${agent.pricingModel.feePercent}% performance fee`;

  const lines = [
    `*${agent.name}* v${agent.version}`,
    `Author: ${agent.author}`,
    `Category: ${agent.category}`,
    `Status: ${agent.status}`,
    `Pricing: ${pricing}`,
    `Chains: ${agent.chainSupport.join(", ")}`,
    `Subscribers: ${agent.subscriberCount}`,
    `Published: ${agent.publishedAt}`,
    "",
    agent.description,
  ];

  if (agent.backtestMetrics) {
    const m = agent.backtestMetrics;
    lines.push(
      "",
      "*Backtest Performance*",
      `Return: ${m.totalReturnPercent >= 0 ? "+" : ""}${m.totalReturnPercent.toFixed(1)}%`,
      `Win rate: ${m.winRate.toFixed(0)}%`,
      `Max drawdown: ${m.maxDrawdownPercent.toFixed(1)}%`,
      `Trades: ${m.totalTrades}`,
      `Sharpe: ${m.sharpeRatio.toFixed(2)}`,
    );
  }

  lines.push("", `_Use "subscribe to ${agent.name}" to start using this agent._`);
  return { success: true, message: lines.join("\n") };
}

function handleSubscribe(
  subscriptions: SubscriptionManagerLike,
  parsed: MarketplaceParams,
  context: SkillExecutionContext,
): SkillResult {
  if (!parsed.agentName) {
    return { success: false, message: "Please specify an agent name to subscribe to." };
  }

  try {
    const options = parsed.token ? { targetToken: parsed.token.toUpperCase() } : undefined;
    const sub = subscriptions.subscribe(context.userId, parsed.agentName, options);

    return {
      success: true,
      message:
        `*Subscribed to ${parsed.agentName}!*\n\n` +
        `Subscription ID: \`${sub.id}\`\n` +
        `Agent instance: \`${sub.instanceId}\`\n` +
        `Mode: Paper Trading (dry run)\n\n` +
        `_The agent is now running. Use "my subscriptions" to monitor._`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Subscription failed.";
    return { success: false, message };
  }
}

function handleUnsubscribe(
  subscriptions: SubscriptionManagerLike,
  parsed: MarketplaceParams,
): SkillResult {
  if (!parsed.subscriptionId) {
    return { success: false, message: "Please specify a subscription ID to cancel." };
  }

  const cancelled = subscriptions.unsubscribe(parsed.subscriptionId);
  if (!cancelled) {
    return { success: false, message: `Subscription \`${parsed.subscriptionId}\` not found or already cancelled.` };
  }

  return { success: true, message: `Subscription \`${parsed.subscriptionId}\` cancelled. Agent stopped.` };
}

function handleMyAgents(
  subscriptions: SubscriptionManagerLike,
  context: SkillExecutionContext,
): SkillResult {
  const subs = subscriptions.getUserSubscriptions(context.userId);

  if (subs.length === 0) {
    return { success: true, message: "_No active subscriptions. Browse the marketplace to get started!_" };
  }

  const lines = ["*Your Subscriptions*\n"];
  for (const sub of subs) {
    lines.push(
      `*${sub.agentName}* — ${sub.status}`,
      `  Sub ID: \`${sub.id}\``,
      `  Instance: \`${sub.instanceId ?? "none"}\``,
      `  Since: ${sub.subscribedAt}`,
      "",
    );
  }

  return { success: true, message: lines.join("\n") };
}

function handleLeaderboard(
  leaderboard: LeaderboardServiceLike,
  parsed: MarketplaceParams,
): SkillResult {
  const formatted = leaderboard.formatLeaderboard({
    category: parsed.category,
  });

  return { success: true, message: formatted };
}
