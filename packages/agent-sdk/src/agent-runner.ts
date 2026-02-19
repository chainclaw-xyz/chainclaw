import { getLogger } from "@chainclaw/core";
import type {
  AgentDefinition,
  StrategyContext,
  StrategyDecision,
  TradeRecord,
} from "./types.js";
import type { PerformanceTracker } from "./performance-tracker.js";

const logger = getLogger("agent-runner");

export type PriceFetcher = (symbol: string) => Promise<number | null>;

interface RunningAgent {
  id: string;
  definition: AgentDefinition;
  userId: string;
  mode: "dry_run" | "live";
  interval: ReturnType<typeof setInterval>;
}

export class AgentRunner {
  private agents = new Map<string, RunningAgent>();

  constructor(
    private tracker: PerformanceTracker,
    private fetchPrice: PriceFetcher,
  ) {}

  /**
   * Start a new agent instance. Returns the agent instance ID.
   */
  startAgent(
    definition: AgentDefinition,
    userId: string,
    mode: "dry_run" | "live" = "dry_run",
  ): string {
    const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Persist to DB
    this.tracker.createInstance(
      id,
      definition.name,
      definition.version,
      userId,
      mode,
      {
        category: definition.category,
        watchlist: definition.strategy.watchlist,
        evaluationIntervalMs: definition.strategy.evaluationIntervalMs,
        riskParams: definition.riskParams,
      },
    );

    // Start polling loop
    const interval = setInterval(() => {
      this.evaluateAgent(id).catch((err) =>
        logger.error({ err, agentId: id }, "Agent evaluation error"),
      );
    }, definition.strategy.evaluationIntervalMs);

    const agent: RunningAgent = { id, definition, userId, mode, interval };
    this.agents.set(id, agent);

    logger.info(
      { agentId: id, name: definition.name, mode, intervalMs: definition.strategy.evaluationIntervalMs },
      "Agent started",
    );

    return id;
  }

  /**
   * Stop a running agent.
   */
  stopAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    clearInterval(agent.interval);
    this.agents.delete(agentId);
    this.tracker.updateInstanceStatus(agentId, "stopped");

    logger.info({ agentId }, "Agent stopped");
    return true;
  }

  /**
   * Pause a running agent (keeps instance but stops evaluation).
   */
  pauseAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    clearInterval(agent.interval);
    this.tracker.updateInstanceStatus(agentId, "paused");

    logger.info({ agentId }, "Agent paused");
    return true;
  }

  /**
   * Resume a paused agent.
   */
  resumeAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    const instance = this.tracker.getInstance(agentId);
    if (!instance || instance.status !== "paused") return false;

    // Restart polling
    agent.interval = setInterval(() => {
      this.evaluateAgent(agentId).catch((err) =>
        logger.error({ err, agentId }, "Agent evaluation error"),
      );
    }, agent.definition.strategy.evaluationIntervalMs);

    this.tracker.updateInstanceStatus(agentId, "running");
    logger.info({ agentId }, "Agent resumed");
    return true;
  }

  /**
   * Stop all running agents (called on server shutdown).
   */
  stopAll(): void {
    for (const [agentId] of this.agents) {
      this.stopAgent(agentId);
    }
    logger.info("All agents stopped");
  }

  /**
   * Get a running agent's info.
   */
  getAgent(agentId: string): RunningAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * List all in-memory running agent IDs.
   */
  getRunningAgentIds(): string[] {
    return Array.from(this.agents.keys());
  }

  // ─── Evaluation loop ─────────────────────────────────────────

  private async evaluateAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const definition = agent.definition;
    const timestamp = Math.floor(Date.now() / 1000);

    // Fetch current prices for watchlist
    const prices: Record<string, number> = {};
    for (const token of definition.strategy.watchlist) {
      const price = await this.fetchPrice(token);
      if (price != null) {
        prices[token.toUpperCase()] = price;
      }
    }

    // Fetch knowledge sources
    const knowledge: Record<string, unknown> = {};
    for (const source of definition.knowledgeSources) {
      try {
        knowledge[source.name] = await source.fetch();
      } catch (err) {
        logger.warn({ err, source: source.name }, "Knowledge source fetch failed");
      }
    }

    // Get recent trades for this agent
    const recentTrades = this.tracker.getAgentTrades(agentId, 20);

    // Build context
    // Note: in dry_run mode, portfolio is simulated from trade history
    const portfolio = this.buildPortfolioFromTrades(recentTrades, prices);
    const totalValueUsd = Object.entries(portfolio).reduce(
      (sum, [token, qty]) => sum + qty * (prices[token] ?? 0),
      0,
    );

    const context: StrategyContext = {
      portfolio,
      totalValueUsd,
      prices,
      recentTrades,
      knowledge,
      timestamp,
    };

    // Evaluate strategy
    let decisions: StrategyDecision[] = [];
    try {
      decisions = await definition.strategy.evaluate(context);
    } catch (err) {
      logger.error({ err, agentId }, "Strategy evaluation failed");
      return;
    }

    // Log reasoning trace
    this.tracker.logReasoning(
      agentId,
      timestamp,
      { prices, portfolio, totalValueUsd },
      decisions,
      decisions.map((d) => d.reasoning).join("; "),
    );

    // Process decisions
    let tradeCount = 0;
    for (const decision of decisions) {
      if (decision.action === "hold") continue;

      // Enforce risk limits
      if (decision.amountUsd > definition.riskParams.maxPositionSizeUsd) {
        logger.warn({ agentId, decision }, "Position size exceeds limit, skipping");
        continue;
      }

      const token = decision.token.toUpperCase();
      const price = prices[token];
      if (!price) {
        logger.warn({ agentId, token }, "No price available, skipping trade");
        continue;
      }

      const tradeId = `${agentId}-${timestamp}-${tradeCount}`;
      const trade: TradeRecord = {
        id: tradeId,
        agentId,
        timestamp,
        action: decision.action,
        token,
        amountUsd: decision.amountUsd,
        priceAtExecution: price,
        chainId: decision.chainId,
        reasoning: decision.reasoning,
        signals: decision.signals,
        status: agent.mode === "dry_run" ? "executed" : "pending",
      };

      this.tracker.logTrade(trade);
      tradeCount++;

      logger.info(
        { agentId, action: decision.action, token, amountUsd: decision.amountUsd, mode: agent.mode },
        "Trade logged",
      );
    }
  }

  private buildPortfolioFromTrades(
    trades: TradeRecord[],
    prices: Record<string, number>,
  ): Record<string, number> {
    const portfolio: Record<string, number> = {};

    // Process trades oldest-first
    const sorted = [...trades].reverse();
    for (const trade of sorted) {
      const token = trade.token;
      if (trade.action === "buy" && trade.priceAtExecution > 0) {
        const qty = trade.amountUsd / trade.priceAtExecution;
        portfolio[token] = (portfolio[token] ?? 0) + qty;
      } else if (trade.action === "sell" && trade.priceAtExecution > 0) {
        const qty = trade.amountUsd / trade.priceAtExecution;
        portfolio[token] = (portfolio[token] ?? 0) - qty;
      }
    }

    // Remove zero/negative positions
    for (const [token, qty] of Object.entries(portfolio)) {
      if (qty <= 0.00001) {
        delete portfolio[token];
      }
    }

    return portfolio;
  }
}
