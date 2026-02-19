import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ReasoningEnricher } from "../reasoning-enricher.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function seedTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reasoning_traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      context_json TEXT NOT NULL,
      decisions_json TEXT NOT NULL,
      reasoning TEXT NOT NULL
    );
  `);
}

function insertTrace(
  db: Database.Database,
  agentId: string,
  timestamp: number,
  context: Record<string, unknown>,
  decisions: unknown[],
  reasoning: string,
): void {
  db.prepare(
    "INSERT INTO reasoning_traces (agent_id, timestamp, context_json, decisions_json, reasoning) VALUES (?, ?, ?, ?, ?)",
  ).run(agentId, timestamp, JSON.stringify(context), JSON.stringify(decisions), reasoning);
}

function createMockLLM() {
  return {
    name: "mock",
    chat: vi.fn().mockResolvedValue({
      content: "1. MARKET CONTEXT: ETH consolidating at $2500.\n2. PORTFOLIO STATE: Moderate ETH exposure.\n3. SIGNAL ANALYSIS: Bullish momentum.\n4. RISK ASSESSMENT: Low downside risk.\n5. DECISION RATIONALE: Accumulation opportunity.\n6. EXPECTED OUTCOME: 5-10% upside within 24h.",
      toolCalls: [],
      usage: { inputTokens: 200, outputTokens: 100 },
    }),
  };
}

describe("ReasoningEnricher", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    seedTables(db);
  });

  afterEach(() => {
    db.close();
  });

  it("initializes enriched_reasoning table", () => {
    const llm = createMockLLM();
    new ReasoningEnricher(db, llm);
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='enriched_reasoning'",
    ).get();
    expect(table).toBeDefined();
  });

  it("enriches a single trace", async () => {
    const llm = createMockLLM();
    const enricher = new ReasoningEnricher(db, llm);

    insertTrace(db, "agent-1", 1700000000, {
      prices: { ETH: 2500, BTC: 43000 },
      portfolio: { ETH: 0.5 },
      totalValueUsd: 1250,
    }, [
      { action: "buy", token: "ETH", amountUsd: 100, chainId: 1, reasoning: "bullish momentum" },
    ], "bullish momentum");

    const traces = enricher.getUnenrichedTraces();
    expect(traces).toHaveLength(1);

    const result = await enricher.enrichSingle(traces[0]!);
    expect(result.enrichedReasoning).toContain("MARKET CONTEXT");
    expect(result.tokensUsed).toBe(300);
  });

  it("stores enriched text in database", async () => {
    const llm = createMockLLM();
    const enricher = new ReasoningEnricher(db, llm);

    insertTrace(db, "agent-1", 1700000000, { prices: { ETH: 2500 } }, [], "test");

    const traces = enricher.getUnenrichedTraces();
    await enricher.enrichSingle(traces[0]!);

    const enriched = enricher.getEnrichedReasoning(traces[0]!.id);
    expect(enriched).toBeDefined();
    expect(enriched!.enriched_text).toContain("MARKET CONTEXT");
    expect(enriched!.tokens_used).toBe(300);
  });

  it("skips already-enriched traces", async () => {
    const llm = createMockLLM();
    const enricher = new ReasoningEnricher(db, llm);

    insertTrace(db, "agent-1", 1700000000, { prices: {} }, [], "test");

    // Enrich once
    await enricher.enrichBatch();
    expect(llm.chat).toHaveBeenCalledTimes(1);

    // Second batch — no unenriched traces
    const traces = enricher.getUnenrichedTraces();
    expect(traces).toHaveLength(0);
  });

  it("handles LLM errors gracefully", async () => {
    const llm = createMockLLM();
    llm.chat.mockRejectedValueOnce(new Error("API rate limited"));
    const enricher = new ReasoningEnricher(db, llm);

    insertTrace(db, "agent-1", 1700000000, { prices: {} }, [], "test");

    const results = await enricher.enrichBatch();
    expect(results).toHaveLength(0); // Failed, not included
  });

  it("batch enriches multiple traces", async () => {
    const llm = createMockLLM();
    const enricher = new ReasoningEnricher(db, llm);

    insertTrace(db, "agent-1", 1700000000, { prices: { ETH: 2500 } }, [
      { action: "buy", token: "ETH", amountUsd: 50, chainId: 1 },
    ], "trace 1");
    insertTrace(db, "agent-1", 1700001000, { prices: { ETH: 2510 } }, [
      { action: "hold", token: "ETH", amountUsd: 0, chainId: 1 },
    ], "trace 2");
    insertTrace(db, "agent-1", 1700002000, { prices: { ETH: 2480 } }, [
      { action: "sell", token: "ETH", amountUsd: 50, chainId: 1 },
    ], "trace 3");

    const results = await enricher.enrichBatch(10);
    expect(results).toHaveLength(3);
    expect(llm.chat).toHaveBeenCalledTimes(3);
  });

  it("passes correct context to LLM", async () => {
    const llm = createMockLLM();
    const enricher = new ReasoningEnricher(db, llm);

    insertTrace(db, "agent-1", 1700000000, {
      prices: { ETH: 2500 },
      portfolio: { ETH: 1.5 },
      totalValueUsd: 3750,
    }, [
      { action: "buy", token: "ETH", amountUsd: 200, chainId: 8453, reasoning: "base chain opportunity" },
    ], "base chain opportunity");

    await enricher.enrichBatch();

    const call = llm.chat.mock.calls[0]!;
    const userMessage = call[0][1].content;
    expect(userMessage).toContain("ETH: $2500");
    expect(userMessage).toContain("ETH: 1.5");
    expect(userMessage).toContain("$3750");
    expect(userMessage).toContain("BUY ETH $200 on chain 8453");
  });

  it("records token usage", async () => {
    const llm = createMockLLM();
    const enricher = new ReasoningEnricher(db, llm);

    insertTrace(db, "agent-1", 1700000000, { prices: {} }, [], "test");
    await enricher.enrichBatch();

    const traces = db.prepare("SELECT * FROM reasoning_traces").all() as Array<{ id: number }>;
    const enriched = enricher.getEnrichedReasoning(traces[0]!.id);
    expect(enriched!.tokens_used).toBe(300);
  });
});
