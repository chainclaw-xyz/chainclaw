// Types
export type {
  AgentCategory,
  KnowledgeSource,
  RiskParameters,
  SignalStrength,
  Signal,
  StrategyDecision,
  StrategyContext,
  StrategyConfig,
  AgentDefinition,
  TradeRecord,
  BacktestConfig,
  BacktestMetrics,
  BacktestResult,
  AgentManifest,
} from "./types.js";

// Validation
export {
  riskParametersSchema,
  agentDefinitionSchema,
  backtestConfigSchema,
  validateAgentDefinition,
} from "./validation.js";

// Engines
export { HistoricalDataProvider } from "./historical-data.js";
export { PerformanceTracker } from "./performance-tracker.js";
export { BacktestEngine } from "./backtest-engine.js";
export { AgentRunner, type PriceFetcher } from "./agent-runner.js";

// Samples
export { createSampleDcaAgent } from "./samples/dca-agent.js";
