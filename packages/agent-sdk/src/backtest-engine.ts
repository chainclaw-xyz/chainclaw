import { getLogger } from "@chainclaw/core";
import type {
  AgentDefinition,
  BacktestConfig,
  BacktestResult,
  BacktestMetrics,
  StrategyContext,
  StrategyDecision,
  TradeRecord,
} from "./types.js";
import type { HistoricalDataProvider } from "./historical-data.js";

const logger = getLogger("backtest-engine");

const DAY_MS = 24 * 60 * 60 * 1000;

export class BacktestEngine {
  constructor(private dataProvider: HistoricalDataProvider) {}

  /**
   * Run a backtest for the given agent definition and config.
   * Replays historical data day-by-day, calling the agent's evaluate() function
   * at each tick and simulating trades with fees and slippage.
   */
  async run(config: BacktestConfig): Promise<BacktestResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const agent = config.agentDefinition;

    logger.info(
      { agent: agent.name, start: config.startDate.toISOString(), end: config.endDate.toISOString() },
      "Starting backtest",
    );

    // Fetch historical data for all watchlist tokens + benchmark
    const allTokens = [...new Set([
      ...agent.strategy.watchlist,
      ...(config.benchmarkToken ? [config.benchmarkToken] : []),
    ])];

    const priceData = new Map<string, Array<{ timestamp: number; price: number }>>();
    for (const token of allTokens) {
      const data = await this.dataProvider.fetchRange(token, config.startDate, config.endDate);
      priceData.set(token.toUpperCase(), data);
    }

    // Initialize simulation state
    let cashUsd = config.startingCapitalUsd;
    const portfolio: Record<string, number> = {}; // token → quantity
    const trades: TradeRecord[] = [];
    const equityCurve: Array<{ timestamp: number; valueUsd: number }> = [];

    // Get all unique timestamps (daily ticks)
    const timestamps = this.getTickTimestamps(config.startDate, config.endDate);

    // Record initial equity
    equityCurve.push({ timestamp: timestamps[0] ?? Math.floor(config.startDate.getTime() / 1000), valueUsd: cashUsd });

    // Record benchmark starting price
    let benchmarkStartPrice: number | null = null;
    if (config.benchmarkToken) {
      const benchData = priceData.get(config.benchmarkToken.toUpperCase());
      benchmarkStartPrice = benchData?.[0]?.price ?? null;
    }

    // Day-by-day replay
    for (const ts of timestamps) {
      // Build price snapshot for this tick
      const prices: Record<string, number> = {};
      for (const [token, data] of priceData) {
        const point = this.findClosestPrice(data, ts);
        if (point != null) {
          prices[token] = point;
        }
      }

      // Compute current portfolio value
      const totalValueUsd = this.computePortfolioValue(cashUsd, portfolio, prices);

      // Build strategy context
      const context: StrategyContext = {
        portfolio: { ...portfolio },
        totalValueUsd,
        prices,
        recentTrades: trades.slice(-20),
        knowledge: {},
        timestamp: ts,
      };

      // Evaluate strategy
      let decisions: StrategyDecision[] = [];
      try {
        decisions = await agent.strategy.evaluate(context);
      } catch (err) {
        logger.warn({ err, timestamp: ts }, "Strategy evaluation error during backtest");
        continue;
      }

      // Execute decisions (with risk enforcement)
      for (const decision of decisions) {
        if (decision.action === "hold") continue;

        const token = decision.token.toUpperCase();
        const price = prices[token];
        if (!price) continue;

        // Enforce risk limits
        if (decision.amountUsd > agent.riskParams.maxPositionSizeUsd) continue;
        if (trades.length >= agent.riskParams.maxDailyTradesCount) continue;

        const trade = this.simulateTrade(
          decision, price, cashUsd, portfolio,
          config.feePercent, config.slippagePercent,
          trades.length, ts,
        );

        if (trade) {
          // Apply trade to simulation state
          if (trade.action === "buy") {
            cashUsd -= trade.amountUsd;
            portfolio[token] = (portfolio[token] ?? 0) + (trade.amountUsd / trade.priceAtExecution);
          } else {
            const quantity = trade.amountUsd / trade.priceAtExecution;
            portfolio[token] = (portfolio[token] ?? 0) - quantity;
            cashUsd += trade.amountUsd;

            // Clean up zero/tiny positions
            if (portfolio[token] != null && portfolio[token] < 0.00001) {
              delete portfolio[token];
            }
          }
          trades.push(trade);
        }
      }

      // Record equity at this tick
      const equityValue = this.computePortfolioValue(cashUsd, portfolio, prices);
      equityCurve.push({ timestamp: ts, valueUsd: equityValue });
    }

    // Compute final metrics
    const finalValue = equityCurve[equityCurve.length - 1]?.valueUsd ?? config.startingCapitalUsd;
    const metrics = this.computeMetrics(
      config.startingCapitalUsd, finalValue, equityCurve, trades,
      config.benchmarkToken, benchmarkStartPrice, priceData,
    );

    const completedAt = new Date().toISOString();

    logger.info(
      { agent: agent.name, trades: trades.length, returnPct: metrics.totalReturnPercent.toFixed(2) },
      "Backtest complete",
    );

    return {
      config: {
        startDate: config.startDate,
        endDate: config.endDate,
        startingCapitalUsd: config.startingCapitalUsd,
        feePercent: config.feePercent,
        slippagePercent: config.slippagePercent,
        benchmarkToken: config.benchmarkToken,
        agentName: agent.name,
      },
      metrics,
      trades,
      equityCurve,
      startedAt,
      completedAt,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Format backtest results as a human-readable report.
   */
  formatReport(result: BacktestResult): string {
    const m = result.metrics;
    const lines = [
      `*Backtest Report: ${result.config.agentName}*`,
      "",
      `Period: ${result.config.startDate.toISOString().split("T")[0]} → ${result.config.endDate.toISOString().split("T")[0]}`,
      `Starting capital: $${result.config.startingCapitalUsd.toLocaleString()}`,
      `Fees: ${result.config.feePercent}% | Slippage: ${result.config.slippagePercent}%`,
      "",
      "*Performance*",
      `Total return: ${m.totalReturnPercent >= 0 ? "+" : ""}${m.totalReturnPercent.toFixed(2)}%`,
      `Max drawdown: ${m.maxDrawdownPercent.toFixed(2)}%`,
      `Sharpe ratio: ${m.sharpeRatio.toFixed(2)}`,
      "",
      "*Trades*",
      `Total: ${m.totalTrades}`,
      `Win rate: ${m.winRate.toFixed(1)}%`,
      `Profitable: ${m.profitableTrades}/${m.totalTrades}`,
      `Avg return/trade: ${m.avgTradeReturnPercent >= 0 ? "+" : ""}${m.avgTradeReturnPercent.toFixed(2)}%`,
    ];

    if (result.config.benchmarkToken) {
      lines.push(
        "",
        "*Benchmark*",
        `${result.config.benchmarkToken} return: ${m.benchmarkReturnPercent >= 0 ? "+" : ""}${m.benchmarkReturnPercent.toFixed(2)}%`,
        `Alpha: ${m.alpha >= 0 ? "+" : ""}${m.alpha.toFixed(2)}%`,
      );
    }

    lines.push("", `_Completed in ${(result.durationMs / 1000).toFixed(1)}s_`);

    return lines.join("\n");
  }

  // ─── Private helpers ─────────────────────────────────────────

  private getTickTimestamps(startDate: Date, endDate: Date): number[] {
    const timestamps: number[] = [];
    const current = new Date(startDate);
    current.setUTCHours(0, 0, 0, 0);

    while (current <= endDate) {
      timestamps.push(Math.floor(current.getTime() / 1000));
      current.setTime(current.getTime() + DAY_MS);
    }
    return timestamps;
  }

  private findClosestPrice(
    data: Array<{ timestamp: number; price: number }>,
    targetTs: number,
  ): number | null {
    if (data.length === 0) return null;

    // Binary search for closest timestamp
    let lo = 0;
    let hi = data.length - 1;

    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (data[mid]!.timestamp < targetTs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    // Check neighbors for closest match
    const idx = lo;
    if (idx === 0) return data[0]!.price;
    const prev = data[idx - 1]!;
    const curr = data[idx]!;
    return Math.abs(prev.timestamp - targetTs) <= Math.abs(curr.timestamp - targetTs)
      ? prev.price
      : curr.price;
  }

  private computePortfolioValue(
    cashUsd: number,
    portfolio: Record<string, number>,
    prices: Record<string, number>,
  ): number {
    let total = cashUsd;
    for (const [token, quantity] of Object.entries(portfolio)) {
      const price = prices[token];
      if (price != null) {
        total += quantity * price;
      }
    }
    return total;
  }

  private simulateTrade(
    decision: StrategyDecision,
    marketPrice: number,
    cashUsd: number,
    portfolio: Record<string, number>,
    feePercent: number,
    slippagePercent: number,
    tradeIndex: number,
    timestamp: number,
  ): TradeRecord | null {
    const token = decision.token.toUpperCase();

    if (decision.action === "buy") {
      if (cashUsd < decision.amountUsd) return null;

      // Apply slippage (buy at slightly higher price)
      const slippageMultiplier = 1 + (slippagePercent / 100);
      const executionPrice = marketPrice * slippageMultiplier;
      const feeUsd = decision.amountUsd * (feePercent / 100);
      const netAmountUsd = decision.amountUsd - feeUsd;

      return {
        id: `bt-${tradeIndex}`,
        agentId: "backtest",
        timestamp,
        action: "buy",
        token,
        amountUsd: decision.amountUsd,
        priceAtExecution: executionPrice,
        chainId: decision.chainId,
        reasoning: decision.reasoning,
        signals: decision.signals,
        status: "executed",
        pnlUsd: -feeUsd, // Initial PnL is just the fee cost
      };
    } else {
      // Sell
      const held = portfolio[token] ?? 0;
      const heldValueUsd = held * marketPrice;
      if (heldValueUsd < 1) return null; // nothing to sell

      const sellAmountUsd = Math.min(decision.amountUsd, heldValueUsd);

      // Apply slippage (sell at slightly lower price)
      const slippageMultiplier = 1 - (slippagePercent / 100);
      const executionPrice = marketPrice * slippageMultiplier;
      const feeUsd = sellAmountUsd * (feePercent / 100);

      return {
        id: `bt-${tradeIndex}`,
        agentId: "backtest",
        timestamp,
        action: "sell",
        token,
        amountUsd: sellAmountUsd - feeUsd,
        priceAtExecution: executionPrice,
        chainId: decision.chainId,
        reasoning: decision.reasoning,
        signals: decision.signals,
        status: "executed",
      };
    }
  }

  private computeMetrics(
    startingCapital: number,
    finalValue: number,
    equityCurve: Array<{ timestamp: number; valueUsd: number }>,
    trades: TradeRecord[],
    benchmarkToken: string | undefined,
    benchmarkStartPrice: number | null,
    priceData: Map<string, Array<{ timestamp: number; price: number }>>,
  ): BacktestMetrics {
    const totalReturnPercent = ((finalValue - startingCapital) / startingCapital) * 100;

    // Max drawdown from equity curve
    let peak = 0;
    let maxDrawdownPercent = 0;
    for (const point of equityCurve) {
      if (point.valueUsd > peak) peak = point.valueUsd;
      const drawdown = peak > 0 ? ((peak - point.valueUsd) / peak) * 100 : 0;
      if (drawdown > maxDrawdownPercent) maxDrawdownPercent = drawdown;
    }

    // Sharpe ratio (annualized, using daily returns)
    const dailyReturns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1]!.valueUsd;
      const curr = equityCurve[i]!.valueUsd;
      if (prev > 0) {
        dailyReturns.push((curr - prev) / prev);
      }
    }

    let sharpeRatio = 0;
    if (dailyReturns.length > 1) {
      const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (dailyReturns.length - 1);
      const stdDev = Math.sqrt(variance);
      if (stdDev > 0) {
        sharpeRatio = (avgReturn / stdDev) * Math.sqrt(365); // annualize
      }
    }

    // Trade metrics
    const executedTrades = trades.filter((t) => t.status === "executed");
    const profitableTrades = executedTrades.filter((t) => (t.pnlUsd ?? 0) > 0);
    const winRate = executedTrades.length > 0
      ? (profitableTrades.length / executedTrades.length) * 100
      : 0;

    const avgTradeReturnPercent = executedTrades.length > 0
      ? executedTrades.reduce((sum, t) => sum + ((t.pnlUsd ?? 0) / startingCapital) * 100, 0) / executedTrades.length
      : 0;

    // Average trade duration (difference between consecutive buy/sell on same token)
    let avgTradeDurationMs = 0;
    const openPositions = new Map<string, number>(); // token → buy timestamp
    const durations: number[] = [];
    for (const trade of executedTrades) {
      if (trade.action === "buy") {
        openPositions.set(trade.token, trade.timestamp);
      } else if (trade.action === "sell") {
        const buyTs = openPositions.get(trade.token);
        if (buyTs != null) {
          durations.push((trade.timestamp - buyTs) * 1000);
          openPositions.delete(trade.token);
        }
      }
    }
    if (durations.length > 0) {
      avgTradeDurationMs = durations.reduce((a, b) => a + b, 0) / durations.length;
    }

    // Benchmark return
    let benchmarkReturnPercent = 0;
    if (benchmarkToken && benchmarkStartPrice) {
      const benchData = priceData.get(benchmarkToken.toUpperCase());
      const benchEndPrice = benchData?.[benchData.length - 1]?.price;
      if (benchEndPrice) {
        benchmarkReturnPercent = ((benchEndPrice - benchmarkStartPrice) / benchmarkStartPrice) * 100;
      }
    }

    const alpha = totalReturnPercent - benchmarkReturnPercent;

    return {
      totalReturnPercent,
      maxDrawdownPercent,
      sharpeRatio,
      winRate,
      totalTrades: executedTrades.length,
      profitableTrades: profitableTrades.length,
      avgTradeReturnPercent,
      avgTradeDurationMs,
      benchmarkReturnPercent,
      alpha,
    };
  }
}
