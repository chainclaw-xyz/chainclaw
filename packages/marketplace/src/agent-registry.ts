import type Database from "better-sqlite3";
import { getLogger } from "@chainclaw/core";
import type { AgentCategory, AgentDefinition, BacktestMetrics } from "@chainclaw/agent-sdk";
import type { AgentFactory, MarketplaceAgent, PricingModel, PublishMetadata } from "./types.js";

const logger = getLogger("agent-registry");

interface MarketplaceAgentRow {
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  pricing_json: string;
  chain_support_json: string;
  published_at: string;
  status: string;
  backtest_metrics_json: string | null;
}

export class AgentRegistry {
  private factories = new Map<string, AgentFactory>();

  constructor(private db: Database.Database) {
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS marketplace_agents (
        name TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        description TEXT NOT NULL,
        author TEXT NOT NULL,
        category TEXT NOT NULL,
        pricing_json TEXT NOT NULL DEFAULT '{"type":"free"}',
        chain_support_json TEXT NOT NULL DEFAULT '[1]',
        published_at TEXT NOT NULL DEFAULT (datetime('now')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'deprecated')),
        backtest_metrics_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_marketplace_category ON marketplace_agents(category);
      CREATE INDEX IF NOT EXISTS idx_marketplace_status ON marketplace_agents(status);
    `);
    logger.debug("Marketplace agents table initialized");
  }

  // ─── Factory Registration ───────────────────────────────────

  registerFactory(name: string, factory: AgentFactory): void {
    this.factories.set(name, factory);
    logger.info({ name }, "Agent factory registered");
  }

  hasFactory(name: string): boolean {
    return this.factories.has(name);
  }

  createAgent(name: string, options?: Record<string, unknown>): AgentDefinition | null {
    const factory = this.factories.get(name);
    if (!factory) return null;
    return factory(options);
  }

  // ─── Publishing ─────────────────────────────────────────────

  publish(name: string, metadata: PublishMetadata): void {
    if (!this.factories.has(name)) {
      throw new Error(`Cannot publish "${name}": no factory registered. Call registerFactory() first.`);
    }

    const existing = this.getAgentRow(name);
    const pricingJson = JSON.stringify(metadata.pricingModel ?? { type: "free" });
    const chainJson = JSON.stringify(metadata.chainSupport ?? [1]);
    const metricsJson = metadata.backtestMetrics ? JSON.stringify(metadata.backtestMetrics) : null;

    if (existing) {
      this.db.prepare(
        `UPDATE marketplace_agents
         SET version = ?, description = ?, author = ?, category = ?, pricing_json = ?,
             chain_support_json = ?, status = 'active', backtest_metrics_json = ?
         WHERE name = ?`,
      ).run(
        metadata.version, metadata.description, metadata.author, metadata.category,
        pricingJson, chainJson, metricsJson, name,
      );
      logger.info({ name, version: metadata.version }, "Agent updated in marketplace");
    } else {
      this.db.prepare(
        `INSERT INTO marketplace_agents (name, version, description, author, category, pricing_json, chain_support_json, backtest_metrics_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        name, metadata.version, metadata.description, metadata.author, metadata.category,
        pricingJson, chainJson, metricsJson,
      );
      logger.info({ name, version: metadata.version }, "Agent published to marketplace");
    }
  }

  unpublish(name: string): boolean {
    const result = this.db.prepare(
      "UPDATE marketplace_agents SET status = 'deprecated' WHERE name = ? AND status != 'deprecated'",
    ).run(name);
    return result.changes > 0;
  }

  // ─── Queries ────────────────────────────────────────────────

  getAgent(name: string): MarketplaceAgent | null {
    const row = this.getAgentRow(name);
    if (!row) return null;
    return this.rowToAgent(row);
  }

  listAgents(includeInactive = false): MarketplaceAgent[] {
    const query = includeInactive
      ? "SELECT * FROM marketplace_agents ORDER BY published_at DESC"
      : "SELECT * FROM marketplace_agents WHERE status = 'active' ORDER BY published_at DESC";
    const rows = this.db.prepare(query).all() as MarketplaceAgentRow[];
    return rows.map((r) => this.rowToAgent(r));
  }

  search(query: string): MarketplaceAgent[] {
    const pattern = `%${query}%`;
    const rows = this.db.prepare(
      `SELECT * FROM marketplace_agents
       WHERE status = 'active' AND (name LIKE ? OR description LIKE ? OR author LIKE ?)
       ORDER BY published_at DESC`,
    ).all(pattern, pattern, pattern) as MarketplaceAgentRow[];
    return rows.map((r) => this.rowToAgent(r));
  }

  getByCategory(category: AgentCategory): MarketplaceAgent[] {
    const rows = this.db.prepare(
      "SELECT * FROM marketplace_agents WHERE status = 'active' AND category = ? ORDER BY published_at DESC",
    ).all(category) as MarketplaceAgentRow[];
    return rows.map((r) => this.rowToAgent(r));
  }

  // ─── Subscriber Count ───────────────────────────────────────

  getSubscriberCount(name: string): number {
    try {
      const row = this.db.prepare(
        "SELECT COUNT(*) as count FROM marketplace_subscriptions WHERE agent_name = ? AND status = 'active'",
      ).get(name) as { count: number } | undefined;
      return row?.count ?? 0;
    } catch {
      // Table may not exist if SubscriptionManager hasn't been initialized yet
      return 0;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────

  private getAgentRow(name: string): MarketplaceAgentRow | null {
    return this.db.prepare(
      "SELECT * FROM marketplace_agents WHERE name = ?",
    ).get(name) as MarketplaceAgentRow | null;
  }

  private rowToAgent(row: MarketplaceAgentRow): MarketplaceAgent {
    return {
      name: row.name,
      version: row.version,
      description: row.description,
      author: row.author,
      category: row.category as AgentCategory,
      pricingModel: JSON.parse(row.pricing_json) as PricingModel,
      chainSupport: JSON.parse(row.chain_support_json) as number[],
      publishedAt: row.published_at,
      status: row.status as "active" | "paused" | "deprecated",
      subscriberCount: this.getSubscriberCount(row.name),
      backtestMetrics: row.backtest_metrics_json
        ? (JSON.parse(row.backtest_metrics_json) as BacktestMetrics)
        : undefined,
    };
  }
}
