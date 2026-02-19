import { z } from "zod";
import type Database from "better-sqlite3";
import { getLogger, type SkillResult } from "@chainclaw/core";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";
import { getTokenPrice } from "./prices.js";

const logger = getLogger("skill-alert");

const alertParams = z.object({
  action: z.enum(["create", "list", "delete"]),
  // For create
  type: z.enum(["price_above", "price_below"]).optional(),
  token: z.string().optional(),
  threshold: z.number().optional(),
  // For delete
  alertId: z.number().optional(),
});

interface Alert {
  id: number;
  user_id: string;
  type: string;
  token: string;
  threshold: number;
  status: string;
  triggered_at: string | null;
  created_at: string;
}

// ─── Alert Engine ───────────────────────────────────────────────

export type AlertNotifier = (userId: string, message: string) => Promise<void>;

export class AlertEngine {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private notifier: AlertNotifier | null = null;

  constructor(private db: Database.Database) {
    this.initTable();
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('price_above', 'price_below')),
        token TEXT NOT NULL,
        threshold REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'triggered', 'deleted')),
        triggered_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(status);
    `);
    logger.debug("Alerts table initialized");
  }

  setNotifier(notifier: AlertNotifier): void {
    this.notifier = notifier;
  }

  createAlert(userId: string, type: string, token: string, threshold: number): number {
    const result = this.db.prepare(
      "INSERT INTO alerts (user_id, type, token, threshold) VALUES (?, ?, ?, ?)",
    ).run(userId, type, token.toUpperCase(), threshold);
    return Number(result.lastInsertRowid);
  }

  getUserAlerts(userId: string): Alert[] {
    return this.db.prepare(
      "SELECT * FROM alerts WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC",
    ).all(userId) as Alert[];
  }

  deleteAlert(id: number, userId: string): boolean {
    const result = this.db.prepare(
      "UPDATE alerts SET status = 'deleted' WHERE id = ? AND user_id = ? AND status = 'active'",
    ).run(id, userId);
    return result.changes > 0;
  }

  start(pollIntervalMs = 60_000): void {
    if (this.pollInterval) return;
    logger.info({ pollIntervalMs }, "Alert engine started");

    // Initial check after 5 seconds, then every pollIntervalMs
    setTimeout(() => {
      this.checkAlerts().catch((err) => logger.error({ err }, "Alert check error"));
    }, 5000);

    this.pollInterval = setInterval(() => {
      this.checkAlerts().catch((err) => logger.error({ err }, "Alert check error"));
    }, pollIntervalMs);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    logger.info("Alert engine stopped");
  }

  private async checkAlerts(): Promise<void> {
    const activeAlerts = this.db.prepare(
      "SELECT * FROM alerts WHERE status = 'active'",
    ).all() as Alert[];

    if (activeAlerts.length === 0) return;

    // Group by token to minimize API calls
    const tokenAlerts = new Map<string, Alert[]>();
    for (const alert of activeAlerts) {
      const list = tokenAlerts.get(alert.token) ?? [];
      list.push(alert);
      tokenAlerts.set(alert.token, list);
    }

    for (const [token, alerts] of tokenAlerts) {
      const price = await getTokenPrice(token);
      if (price == null) continue;

      for (const alert of alerts) {
        let triggered = false;

        if (alert.type === "price_above" && price >= alert.threshold) {
          triggered = true;
        } else if (alert.type === "price_below" && price <= alert.threshold) {
          triggered = true;
        }

        if (triggered) {
          this.db.prepare(
            "UPDATE alerts SET status = 'triggered', triggered_at = datetime('now') WHERE id = ?",
          ).run(alert.id);

          const direction = alert.type === "price_above" ? "above" : "below";
          const message =
            `*Alert Triggered*\n\n` +
            `${alert.token} is now $${price.toLocaleString("en-US", { maximumFractionDigits: 2 })} ` +
            `(${direction} $${alert.threshold.toLocaleString("en-US", { maximumFractionDigits: 2 })})`;

          logger.info({ alertId: alert.id, token, price, threshold: alert.threshold }, "Alert triggered");

          if (this.notifier) {
            try {
              await this.notifier(alert.user_id, message);
            } catch (err) {
              logger.error({ err, alertId: alert.id }, "Failed to send alert notification");
            }
          }
        }
      }
    }
  }
}

// ─── Alert Skill Definition ─────────────────────────────────────

export function createAlertSkill(engine: AlertEngine): SkillDefinition {
  return {
    name: "alert",
    description:
      "Set price alerts. Get notified when a token price crosses a threshold. " +
      "Example: 'Alert me when ETH drops below $2000'.",
    parameters: alertParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = alertParams.parse(params);

      switch (parsed.action) {
        case "create":
          return handleCreate(engine, parsed, context);
        case "list":
          return handleList(engine, context);
        case "delete":
          return handleDelete(engine, parsed, context);
      }
    },
  };
}

function handleCreate(
  engine: AlertEngine,
  parsed: z.infer<typeof alertParams>,
  context: SkillExecutionContext,
): SkillResult {
  const type = parsed.type;
  const token = parsed.token?.toUpperCase();
  const threshold = parsed.threshold;

  if (!type || !token || threshold == null) {
    return { success: false, message: "Missing required fields: type, token, and threshold." };
  }

  const alertId = engine.createAlert(context.userId, type, token, threshold);
  const direction = type === "price_above" ? "rises above" : "drops below";

  return {
    success: true,
    message: `*Alert #${alertId} Created*\n\nYou'll be notified when ${token} ${direction} $${threshold.toLocaleString("en-US", { maximumFractionDigits: 2 })}.`,
  };
}

function handleList(engine: AlertEngine, context: SkillExecutionContext): SkillResult {
  const alerts = engine.getUserAlerts(context.userId);

  if (alerts.length === 0) {
    return { success: true, message: "No active alerts. Use `create` to set one." };
  }

  const lines = ["*Your Alerts*\n"];
  for (const alert of alerts) {
    const direction = alert.type === "price_above" ? ">" : "<";
    lines.push(
      `*#${alert.id}* ${alert.token} ${direction} $${alert.threshold.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    );
  }

  return { success: true, message: lines.join("\n") };
}

function handleDelete(
  engine: AlertEngine,
  parsed: z.infer<typeof alertParams>,
  context: SkillExecutionContext,
): SkillResult {
  if (!parsed.alertId) {
    return { success: false, message: "Please specify an alert ID to delete." };
  }

  const deleted = engine.deleteAlert(parsed.alertId, context.userId);
  if (!deleted) {
    return { success: false, message: `Alert #${parsed.alertId} not found or not yours.` };
  }

  return { success: true, message: `Alert #${parsed.alertId} deleted.` };
}
