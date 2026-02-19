// ─── Agent Categories ───────────────────────────────────────

export type AgentCategory =
  | "yield" | "trading" | "lp" | "dca"
  | "risk" | "airdrop" | "multi-strategy";

// ─── Knowledge Sources ──────────────────────────────────────

export interface KnowledgeSource {
  type: "price_feed" | "on_chain" | "social" | "custom";
  name: string;
  description: string;
  /** Fetch latest signal data. Returns JSON-serializable value. */
  fetch: () => Promise<unknown>;
}

// ─── Risk Parameters ────────────────────────────────────────

export interface RiskParameters {
  maxPositionSizeUsd: number;
  maxDrawdownPercent: number;
  maxDailyTradesCount: number;
  maxDailyExposureUsd: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  allowedChainIds: number[];
  allowedTokens?: string[];
  blockedTokens?: string[];
}

// ─── Strategy ───────────────────────────────────────────────

export type SignalStrength = "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";

export interface Signal {
  token: string;
  strength: SignalStrength;
  confidence: number;
  reasoning: string;
  timestamp: number;
}

export interface StrategyDecision {
  action: "buy" | "sell" | "hold";
  token: string;
  amountUsd: number;
  chainId: number;
  reasoning: string;
  signals: Signal[];
}

export interface StrategyContext {
  portfolio: Record<string, number>;
  totalValueUsd: number;
  prices: Record<string, number>;
  recentTrades: TradeRecord[];
  knowledge: Record<string, unknown>;
  timestamp: number;
}

export interface StrategyConfig {
  evaluate: (context: StrategyContext) => Promise<StrategyDecision[]>;
  evaluationIntervalMs: number;
  watchlist: string[];
}

// ─── Agent Definition ───────────────────────────────────────

export interface AgentDefinition {
  name: string;
  version: string;
  description: string;
  author: string;
  category: AgentCategory;
  skills: string[];
  knowledgeSources: KnowledgeSource[];
  riskParams: RiskParameters;
  strategy: StrategyConfig;
}

// ─── Trade Records ──────────────────────────────────────────

export interface TradeRecord {
  id: string;
  agentId: string;
  timestamp: number;
  action: "buy" | "sell";
  token: string;
  amountUsd: number;
  priceAtExecution: number;
  chainId: number;
  reasoning: string;
  signals: Signal[];
  txHash?: string;
  status: "pending" | "executed" | "failed";
  pnlUsd?: number;
}

// ─── Backtest Types ─────────────────────────────────────────

export interface BacktestConfig {
  agentDefinition: AgentDefinition;
  startDate: Date;
  endDate: Date;
  startingCapitalUsd: number;
  feePercent: number;
  slippagePercent: number;
  benchmarkToken?: string;
}

export interface BacktestMetrics {
  totalReturnPercent: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  winRate: number;
  totalTrades: number;
  profitableTrades: number;
  avgTradeReturnPercent: number;
  avgTradeDurationMs: number;
  benchmarkReturnPercent: number;
  alpha: number;
}

export interface BacktestResult {
  config: Omit<BacktestConfig, "agentDefinition"> & { agentName: string };
  metrics: BacktestMetrics;
  trades: TradeRecord[];
  equityCurve: Array<{ timestamp: number; valueUsd: number }>;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

// ─── Agent Manifest (for packaging) ─────────────────────────

export interface AgentManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  category: AgentCategory;
  chainSupport: number[];
  riskProfile: { maxDrawdown: number; maxPositionSize: number };
  backtestResults?: BacktestMetrics;
  createdAt: string;
}
