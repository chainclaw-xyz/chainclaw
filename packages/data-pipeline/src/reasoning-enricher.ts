import type Database from "better-sqlite3";
import { getLogger } from "@chainclaw/core";
import type { LLMProvider } from "@chainclaw/agent";
import type { EnrichmentResult } from "./types.js";

const logger = getLogger("reasoning-enricher");

interface ReasoningTraceRow {
  id: number;
  agent_id: string;
  timestamp: number;
  context_json: string;
  decisions_json: string;
  reasoning: string;
}

interface EnrichedRow {
  id: number;
  trace_id: number;
  agent_id: string;
  enriched_text: string;
  tokens_used: number;
  enriched_at: number;
}

const ENRICHMENT_SYSTEM_PROMPT = `You are a DeFi trading analyst. Given a trading context and decision, produce a detailed chain-of-thought reasoning that explains WHY this decision was made.

Structure your response as:
1. MARKET CONTEXT: What were the relevant market conditions?
2. PORTFOLIO STATE: What was the current portfolio situation?
3. SIGNAL ANALYSIS: What signals supported this decision?
4. RISK ASSESSMENT: What risks were considered?
5. DECISION RATIONALE: Why was this specific action taken?
6. EXPECTED OUTCOME: What outcome was anticipated?

Keep each section to 1-3 sentences. Be specific with numbers and percentages.`;

export class ReasoningEnricher {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: Database.Database,
    private llm: LLMProvider,
  ) {
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS enriched_reasoning (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id INTEGER NOT NULL UNIQUE,
        agent_id TEXT NOT NULL,
        enriched_text TEXT NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        enriched_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_enriched_trace ON enriched_reasoning(trace_id);
      CREATE INDEX IF NOT EXISTS idx_enriched_agent ON enriched_reasoning(agent_id);
    `);
    logger.debug("Reasoning enricher tables initialized");
  }

  start(intervalMs: number): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      this.enrichBatch().catch((err) =>
        logger.error({ err }, "Reasoning enrichment error"),
      );
    }, intervalMs);
    logger.info({ intervalMs }, "Reasoning enricher started");
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async enrichBatch(limit = 10): Promise<EnrichmentResult[]> {
    const traces = this.getUnenrichedTraces(limit);
    const results: EnrichmentResult[] = [];

    for (const trace of traces) {
      try {
        const result = await this.enrichSingle(trace);
        results.push(result);
      } catch (err) {
        logger.warn({ err, traceId: trace.id }, "Failed to enrich trace");
      }
    }

    if (results.length > 0) {
      logger.info({ enriched: results.length }, "Enrichment batch complete");
    }

    return results;
  }

  async enrichSingle(trace: ReasoningTraceRow): Promise<EnrichmentResult> {
    const context = JSON.parse(trace.context_json);
    const decisions = JSON.parse(trace.decisions_json);

    const userMessage = this.buildUserMessage(context, decisions, trace.reasoning);

    const response = await this.llm.chat([
      { role: "system", content: ENRICHMENT_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ]);

    const tokensUsed = (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0);

    this.db.prepare(
      `INSERT OR IGNORE INTO enriched_reasoning (trace_id, agent_id, enriched_text, tokens_used, enriched_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(trace.id, trace.agent_id, response.content, tokensUsed, Date.now());

    return {
      traceId: trace.id,
      enrichedReasoning: response.content,
      tokensUsed,
    };
  }

  getEnrichedReasoning(traceId: number): EnrichedRow | undefined {
    return this.db.prepare(
      "SELECT * FROM enriched_reasoning WHERE trace_id = ?",
    ).get(traceId) as EnrichedRow | undefined;
  }

  getUnenrichedTraces(limit = 10): ReasoningTraceRow[] {
    return this.db.prepare(
      `SELECT rt.* FROM reasoning_traces rt
       WHERE NOT EXISTS (
         SELECT 1 FROM enriched_reasoning er WHERE er.trace_id = rt.id
       )
       ORDER BY rt.timestamp ASC
       LIMIT ?`,
    ).all(limit) as ReasoningTraceRow[];
  }

  private buildUserMessage(
    context: { prices?: Record<string, number>; portfolio?: Record<string, number>; totalValueUsd?: number },
    decisions: Array<{ action?: string; token?: string; amountUsd?: number; chainId?: number; reasoning?: string }>,
    rawReasoning: string,
  ): string {
    const lines: string[] = [];

    if (context.prices) {
      const priceEntries = Object.entries(context.prices)
        .map(([token, price]) => `${token}: $${price}`)
        .join(", ");
      lines.push(`Current Prices: ${priceEntries}`);
    }

    if (context.portfolio) {
      const portfolioEntries = Object.entries(context.portfolio)
        .map(([token, qty]) => `${token}: ${qty}`)
        .join(", ");
      lines.push(`Portfolio: ${portfolioEntries}`);
    }

    if (context.totalValueUsd != null) {
      lines.push(`Total Value: $${context.totalValueUsd}`);
    }

    lines.push("");
    lines.push("Decisions made:");
    for (const d of decisions) {
      lines.push(`- ${d.action?.toUpperCase()} ${d.token} $${d.amountUsd} on chain ${d.chainId}`);
      if (d.reasoning) lines.push(`  Reasoning: ${d.reasoning}`);
    }

    lines.push("");
    lines.push(`Raw reasoning: ${rawReasoning}`);

    return lines.join("\n");
  }
}
