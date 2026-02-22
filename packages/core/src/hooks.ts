import { getLogger } from "./logger.js";

const logger = getLogger("hooks");

/**
 * DeFi-specific hook event types for ChainClaw.
 * Ported from OpenClaw's internal-hooks pattern (Map-based pub-sub).
 */

// ─── Event Types ─────────────────────────────────────────────

export type HookEventType =
  | "tx"
  | "alert"
  | "channel"
  | "cron"
  | "lifecycle";

export interface HookEvent {
  /** Event category */
  type: HookEventType;
  /** Specific action within the category (e.g. "before_simulate") */
  action: string;
  /** Full event key: "type:action" */
  key: string;
  /** Unix timestamp (ms) */
  timestamp: number;
  /** Contextual data specific to the event */
  data: Record<string, unknown>;
}

export type HookHandler = (event: HookEvent) => Promise<void> | void;

// ─── Well-known Event Keys ───────────────────────────────────

export const HookEvents = {
  // Transaction pipeline
  TX_BEFORE_SIMULATE: "tx:before_simulate",
  TX_AFTER_SIMULATE: "tx:after_simulate",
  TX_BEFORE_BROADCAST: "tx:before_broadcast",
  TX_AFTER_BROADCAST: "tx:after_broadcast",
  TX_CONFIRMED: "tx:confirmed",
  TX_FAILED: "tx:failed",

  // Alerts
  ALERT_CREATED: "alert:created",
  ALERT_TRIGGERED: "alert:triggered",
  ALERT_DELETED: "alert:deleted",

  // Channel lifecycle
  CHANNEL_CONNECTED: "channel:connected",
  CHANNEL_DISCONNECTED: "channel:disconnected",
  CHANNEL_ERROR: "channel:error",

  // Cron
  CRON_JOB_STARTED: "cron:job_started",
  CRON_JOB_FINISHED: "cron:job_finished",
  CRON_JOB_FAILED: "cron:job_failed",

  // App lifecycle
  LIFECYCLE_STARTUP: "lifecycle:startup",
  LIFECYCLE_SHUTDOWN: "lifecycle:shutdown",
  LIFECYCLE_CONFIG_CHANGED: "lifecycle:config_changed",
} as const;

// ─── Hook Registry (singleton) ───────────────────────────────

const handlers = new Map<string, Set<HookHandler>>();

/**
 * Register a handler for a hook event.
 * Supports both category-level ("tx") and specific ("tx:before_simulate") keys.
 */
export function registerHook(eventKey: string, handler: HookHandler): void {
  let set = handlers.get(eventKey);
  if (!set) {
    set = new Set();
    handlers.set(eventKey, set);
  }
  set.add(handler);
  logger.debug({ eventKey }, "Hook registered");
}

/**
 * Remove a specific handler for an event key.
 */
export function unregisterHook(eventKey: string, handler: HookHandler): void {
  const set = handlers.get(eventKey);
  if (set) {
    set.delete(handler);
    if (set.size === 0) {
      handlers.delete(eventKey);
    }
  }
}

/**
 * Clear all registered hooks. Primarily for testing.
 */
export function clearHooks(): void {
  handlers.clear();
}

/**
 * Get all registered event keys. For debugging.
 */
export function getRegisteredHookKeys(): string[] {
  return Array.from(handlers.keys());
}

/**
 * Trigger a hook event. Dispatches to:
 * 1. Handlers registered for the exact "type:action" key
 * 2. Handlers registered for the category "type" key
 *
 * Handler errors are caught and logged but don't block other handlers.
 */
export async function triggerHook(event: HookEvent): Promise<void> {
  const keys = [event.key, event.type];

  for (const key of keys) {
    const set = handlers.get(key);
    if (!set) continue;

    for (const handler of set) {
      try {
        await handler(event);
      } catch (err) {
        logger.error({ err, eventKey: key }, "Hook handler error");
      }
    }
  }
}

/**
 * Create a properly initialized HookEvent.
 */
export function createHookEvent(
  type: HookEventType,
  action: string,
  data: Record<string, unknown> = {},
): HookEvent {
  return {
    type,
    action,
    key: `${type}:${action}`,
    timestamp: Date.now(),
    data,
  };
}
