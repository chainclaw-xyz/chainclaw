import { registerHook, type HookEvent } from "./hooks.js";

// ─── Types ──────────────────────────────────────────────────

export interface DiagnosticSnapshot {
  uptime: number;
  counters: Record<string, number>;
  lastEventAt: number | null;
}

// ─── Diagnostic Collector ───────────────────────────────────

/**
 * Subscribes to hook events and maintains operational counters.
 * Exposes a snapshot for the /health endpoint.
 */
export class DiagnosticCollector {
  private startedAt: number;
  private counters: Map<string, number>;
  private lastEventAt: number | null = null;

  constructor() {
    this.startedAt = Date.now();
    this.counters = new Map();
    this.subscribe();
  }

  private subscribe(): void {
    // Transaction events
    registerHook("tx", this.handler);
    // Cron events
    registerHook("cron", this.handler);
    // Channel events
    registerHook("channel", this.handler);
    // Lifecycle events
    registerHook("lifecycle", this.handler);
    // Diagnostic-specific events
    registerHook("diag", this.handler);
  }

  private handler = (event: HookEvent): void => {
    this.increment(event.key);
    this.lastEventAt = Date.now();
  };

  /**
   * Increment a named counter.
   */
  increment(key: string, amount = 1): void {
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + amount);
  }

  /**
   * Get the current value of a counter.
   */
  get(key: string): number {
    return this.counters.get(key) ?? 0;
  }

  /**
   * Get a snapshot of all diagnostic data.
   */
  getSnapshot(): DiagnosticSnapshot {
    const counters: Record<string, number> = {};
    for (const [key, value] of this.counters) {
      counters[key] = value;
    }
    return {
      uptime: Date.now() - this.startedAt,
      counters,
      lastEventAt: this.lastEventAt,
    };
  }

  /**
   * Reset all counters. For testing.
   */
  reset(): void {
    this.counters.clear();
    this.lastEventAt = null;
    this.startedAt = Date.now();
  }
}
