/**
 * Plugin contract for extending the ChainClaw server.
 * Cloud and third-party plugins implement ServerPlugin to register
 * additional skills, background services, or marketplace features.
 */
import type Database from "better-sqlite3";
import type { SkillRegistry } from "@chainclaw/skills";
import type { AgentRunner, PerformanceTracker, AgentDefinition } from "@chainclaw/agent-sdk";
import type { LLMProvider } from "@chainclaw/agent";

export interface PluginContext {
  db: Database.Database;
  skillRegistry: SkillRegistry;
  agentRunner: AgentRunner;
  performanceTracker: PerformanceTracker;
  llm?: LLMProvider;
  config: Record<string, unknown>;
  getTokenPrice: (symbol: string) => Promise<number | null>;
  createSampleDcaAgent: (opts: { targetToken: string; amountPerBuy?: number; chainId?: number }) => AgentDefinition;
}

export interface ServerPlugin {
  name: string;
  init(ctx: PluginContext): Promise<PluginHandle>;
}

export interface PluginHandle {
  stop(): void;
}
