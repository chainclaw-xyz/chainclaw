import { z } from "zod";
import { getLogger, type SkillResult } from "@chainclaw/core";
import type { AgentRunner, AgentDefinition, PerformanceTracker } from "@chainclaw/agent-sdk";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";

const logger = getLogger("skill-agent");

const agentParams = z.object({
  action: z.enum(["start", "stop", "pause", "resume", "status", "list", "trades", "reasoning"]),
  strategy: z.enum(["dca"]).optional(),
  token: z.string().optional(),
  mode: z.enum(["dry_run", "live"]).optional().default("dry_run"),
  agentId: z.string().optional(),
});

/**
 * Factory for the agent management chat skill.
 * Allows users to start, stop, pause, and monitor live agents via chat.
 */
export function createAgentSkill(
  runner: AgentRunner,
  tracker: PerformanceTracker,
  resolveAgent: (strategy: string, token: string) => AgentDefinition | null,
): SkillDefinition {
  return {
    name: "agent",
    description:
      "Manage live trading agents. Start, stop, pause, or monitor agents. " +
      "Example: 'Start a DCA agent for ETH' or 'List my agents'.",
    parameters: agentParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = agentParams.parse(params);

      switch (parsed.action) {
        case "start":
          return handleStart(runner, tracker, resolveAgent, parsed, context);
        case "stop":
          return handleStop(runner, parsed);
        case "pause":
          return handlePause(runner, parsed);
        case "resume":
          return handleResume(runner, parsed);
        case "status":
          return handleStatus(tracker, parsed);
        case "list":
          return handleList(tracker, runner, context);
        case "trades":
          return handleTrades(tracker, parsed);
        case "reasoning":
          return handleReasoning(tracker, parsed);
      }
    },
  };
}

function handleStart(
  runner: AgentRunner,
  tracker: PerformanceTracker,
  resolveAgent: (strategy: string, token: string) => AgentDefinition | null,
  parsed: z.infer<typeof agentParams>,
  context: SkillExecutionContext,
): SkillResult {
  const strategy = parsed.strategy ?? "dca";
  const token = parsed.token ?? "ETH";

  const agent = resolveAgent(strategy, token);
  if (!agent) {
    return { success: false, message: `Unknown strategy: "${strategy}". Available: dca.` };
  }

  const mode = parsed.mode ?? "dry_run";
  const agentId = runner.startAgent(agent, context.userId, mode);

  return {
    success: true,
    message:
      `*Agent Started*\n\n` +
      `ID: \`${agentId}\`\n` +
      `Strategy: ${agent.name}\n` +
      `Token: ${token}\n` +
      `Mode: ${mode === "dry_run" ? "Paper Trading" : "LIVE"}\n` +
      `Interval: ${Math.round(agent.strategy.evaluationIntervalMs / 60000)}min\n\n` +
      `_Use "agent status ${agentId}" to check progress._`,
  };
}

function handleStop(runner: AgentRunner, parsed: z.infer<typeof agentParams>): SkillResult {
  if (!parsed.agentId) {
    return { success: false, message: "Please specify an agent ID to stop." };
  }

  const stopped = runner.stopAgent(parsed.agentId);
  if (!stopped) {
    return { success: false, message: `Agent \`${parsed.agentId}\` not found or not running.` };
  }

  return { success: true, message: `Agent \`${parsed.agentId}\` stopped.` };
}

function handlePause(runner: AgentRunner, parsed: z.infer<typeof agentParams>): SkillResult {
  if (!parsed.agentId) {
    return { success: false, message: "Please specify an agent ID to pause." };
  }

  const paused = runner.pauseAgent(parsed.agentId);
  if (!paused) {
    return { success: false, message: `Agent \`${parsed.agentId}\` not found or not running.` };
  }

  return { success: true, message: `Agent \`${parsed.agentId}\` paused.` };
}

function handleResume(runner: AgentRunner, parsed: z.infer<typeof agentParams>): SkillResult {
  if (!parsed.agentId) {
    return { success: false, message: "Please specify an agent ID to resume." };
  }

  const resumed = runner.resumeAgent(parsed.agentId);
  if (!resumed) {
    return { success: false, message: `Agent \`${parsed.agentId}\` not found or not paused.` };
  }

  return { success: true, message: `Agent \`${parsed.agentId}\` resumed.` };
}

function handleStatus(tracker: PerformanceTracker, parsed: z.infer<typeof agentParams>): SkillResult {
  if (!parsed.agentId) {
    return { success: false, message: "Please specify an agent ID." };
  }

  const summary = tracker.formatPerformanceSummary(parsed.agentId);
  return { success: true, message: summary };
}

function handleList(
  tracker: PerformanceTracker,
  runner: AgentRunner,
  context: SkillExecutionContext,
): SkillResult {
  const instances = tracker.getActiveInstances(context.userId);

  if (instances.length === 0) {
    return { success: true, message: "No active agents. Use `agent start` to create one." };
  }

  const lines = ["*Your Agents*\n"];
  for (const inst of instances) {
    const isRunning = runner.getRunningAgentIds().includes(inst.id);
    const statusLabel = isRunning ? inst.status : "stopped (in-memory)";
    lines.push(
      `*${inst.name}* v${inst.version} — ${statusLabel}\n` +
      `  ID: \`${inst.id}\`\n` +
      `  Mode: ${inst.mode} | Started: ${inst.started_at}`,
    );
  }

  return { success: true, message: lines.join("\n") };
}

function handleTrades(tracker: PerformanceTracker, parsed: z.infer<typeof agentParams>): SkillResult {
  if (!parsed.agentId) {
    return { success: false, message: "Please specify an agent ID." };
  }

  const trades = tracker.getAgentTrades(parsed.agentId, 10);
  if (trades.length === 0) {
    return { success: true, message: "No trades recorded for this agent yet." };
  }

  const lines = [`*Recent Trades — ${parsed.agentId}*\n`];
  for (const t of trades) {
    const pnl = t.pnlUsd != null ? ` (${t.pnlUsd >= 0 ? "+" : ""}$${t.pnlUsd.toFixed(2)})` : "";
    const time = new Date(t.timestamp * 1000).toISOString().split("T")[0];
    lines.push(`${time} ${t.action.toUpperCase()} ${t.token} $${t.amountUsd.toFixed(2)}${pnl} [${t.status}]`);
  }

  return { success: true, message: lines.join("\n") };
}

function handleReasoning(tracker: PerformanceTracker, parsed: z.infer<typeof agentParams>): SkillResult {
  if (!parsed.agentId) {
    return { success: false, message: "Please specify an agent ID." };
  }

  const traces = tracker.getReasoningTraces(parsed.agentId, 5);
  if (traces.length === 0) {
    return { success: true, message: "No reasoning traces recorded for this agent yet." };
  }

  const lines = [`*Reasoning Traces — ${parsed.agentId}*\n`];
  for (const t of traces) {
    const time = new Date(t.timestamp * 1000).toISOString().split("T")[0];
    const decisions = JSON.parse(t.decisions_json) as Array<{ action: string; token: string }>;
    const decisionSummary = decisions.length > 0
      ? decisions.map((d) => `${d.action} ${d.token}`).join(", ")
      : "hold";
    lines.push(`${time}: ${decisionSummary}\n  _${t.reasoning}_`);
  }

  return { success: true, message: lines.join("\n") };
}
