import type Database from "better-sqlite3";
import { getLogger } from "@chainclaw/core";
import type { AgentRunner } from "@chainclaw/agent-sdk";
import type { AgentRegistry } from "./agent-registry.js";
import type { Subscription } from "./types.js";

const logger = getLogger("subscription-manager");

interface SubscriptionRow {
  id: string;
  user_id: string;
  agent_name: string;
  subscribed_at: string;
  cancelled_at: string | null;
  status: string;
  instance_id: string | null;
}

export class SubscriptionManager {
  constructor(
    private db: Database.Database,
    private registry: AgentRegistry,
    private runner: AgentRunner,
  ) {
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS marketplace_subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
        cancelled_at TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'cancelled')),
        instance_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sub_user ON marketplace_subscriptions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sub_agent ON marketplace_subscriptions(agent_name);
      CREATE INDEX IF NOT EXISTS idx_sub_status ON marketplace_subscriptions(status);
    `);
    logger.debug("Marketplace subscriptions table initialized");
  }

  // ─── Subscribe ──────────────────────────────────────────────

  subscribe(
    userId: string,
    agentName: string,
    options?: Record<string, unknown>,
  ): Subscription {
    // Check agent exists and is active
    const agent = this.registry.getAgent(agentName);
    if (!agent) {
      throw new Error(`Agent "${agentName}" not found in marketplace.`);
    }
    if (agent.status !== "active") {
      throw new Error(`Agent "${agentName}" is ${agent.status}, cannot subscribe.`);
    }

    // Check not already subscribed
    const existing = this.getActiveSubscription(userId, agentName);
    if (existing) {
      throw new Error(`Already subscribed to "${agentName}".`);
    }

    // Create agent instance via factory
    const definition = this.registry.createAgent(agentName, options);
    if (!definition) {
      throw new Error(`Failed to create agent "${agentName}" — factory not available.`);
    }

    // Start agent
    const instanceId = this.runner.startAgent(definition, userId, "dry_run");

    // Record subscription
    const id = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.db.prepare(
      "INSERT INTO marketplace_subscriptions (id, user_id, agent_name, instance_id) VALUES (?, ?, ?, ?)",
    ).run(id, userId, agentName, instanceId);

    logger.info({ userId, agentName, instanceId, subscriptionId: id }, "User subscribed to agent");

    return {
      id,
      userId,
      agentName,
      subscribedAt: new Date().toISOString(),
      cancelledAt: null,
      status: "active",
      instanceId,
    };
  }

  // ─── Unsubscribe ────────────────────────────────────────────

  unsubscribe(subscriptionId: string): boolean {
    const row = this.db.prepare(
      "SELECT * FROM marketplace_subscriptions WHERE id = ? AND status = 'active'",
    ).get(subscriptionId) as SubscriptionRow | undefined;

    if (!row) return false;

    // Stop agent instance
    if (row.instance_id) {
      this.runner.stopAgent(row.instance_id);
    }

    // Update subscription
    this.db.prepare(
      "UPDATE marketplace_subscriptions SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?",
    ).run(subscriptionId);

    logger.info({ subscriptionId, agentName: row.agent_name, userId: row.user_id }, "Subscription cancelled");
    return true;
  }

  // ─── Queries ────────────────────────────────────────────────

  getUserSubscriptions(userId: string, activeOnly = true): Subscription[] {
    const query = activeOnly
      ? "SELECT * FROM marketplace_subscriptions WHERE user_id = ? AND status = 'active' ORDER BY subscribed_at DESC"
      : "SELECT * FROM marketplace_subscriptions WHERE user_id = ? ORDER BY subscribed_at DESC";
    const rows = this.db.prepare(query).all(userId) as SubscriptionRow[];
    return rows.map((r) => this.rowToSubscription(r));
  }

  getAgentSubscribers(agentName: string): Subscription[] {
    const rows = this.db.prepare(
      "SELECT * FROM marketplace_subscriptions WHERE agent_name = ? AND status = 'active' ORDER BY subscribed_at DESC",
    ).all(agentName) as SubscriptionRow[];
    return rows.map((r) => this.rowToSubscription(r));
  }

  isSubscribed(userId: string, agentName: string): boolean {
    return this.getActiveSubscription(userId, agentName) !== null;
  }

  getSubscription(id: string): Subscription | null {
    const row = this.db.prepare(
      "SELECT * FROM marketplace_subscriptions WHERE id = ?",
    ).get(id) as SubscriptionRow | undefined;
    return row ? this.rowToSubscription(row) : null;
  }

  // ─── Helpers ────────────────────────────────────────────────

  private getActiveSubscription(userId: string, agentName: string): SubscriptionRow | null {
    const row = this.db.prepare(
      "SELECT * FROM marketplace_subscriptions WHERE user_id = ? AND agent_name = ? AND status = 'active'",
    ).get(userId, agentName) as SubscriptionRow | undefined;
    return row ?? null;
  }

  private rowToSubscription(row: SubscriptionRow): Subscription {
    return {
      id: row.id,
      userId: row.user_id,
      agentName: row.agent_name,
      subscribedAt: row.subscribed_at,
      cancelledAt: row.cancelled_at,
      status: row.status as "active" | "cancelled",
      instanceId: row.instance_id,
    };
  }
}
