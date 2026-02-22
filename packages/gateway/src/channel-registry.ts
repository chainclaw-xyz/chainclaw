import { getLogger } from "@chainclaw/core";
import type { GatewayDeps } from "./types.js";
import type { ChannelAdapter, ChannelStatus, AlertNotifier } from "./channel-adapter.js";

const logger = getLogger("channel-registry");

/**
 * Manages the lifecycle of all registered channel adapters.
 * Provides uniform start/stop, status, and alert wiring.
 */
export class ChannelRegistry {
  private adapters = new Map<string, ChannelAdapter>();

  /** Register a channel adapter. Must be called before start(). */
  register(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Channel adapter already registered: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  /** Start all registered adapters. Logs errors but doesn't throw. */
  async startAll(deps: GatewayDeps): Promise<string[]> {
    const started: string[] = [];

    for (const adapter of this.adapters.values()) {
      try {
        await adapter.start(deps);
        started.push(adapter.id);
        logger.info({ channel: adapter.id }, `${adapter.label} started`);
      } catch (err) {
        logger.error({ err, channel: adapter.id }, `Failed to start ${adapter.label}`);
      }
    }

    return started;
  }

  /** Stop all adapters gracefully. */
  async stopAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      try {
        await adapter.stop();
        logger.info({ channel: adapter.id }, `${adapter.label} stopped`);
      } catch (err) {
        logger.error({ err, channel: adapter.id }, `Error stopping ${adapter.label}`);
      }
    }
  }

  /** Wire an alert notifier to all adapters that support it. */
  setNotifier(fn: AlertNotifier): void {
    for (const adapter of this.adapters.values()) {
      if (adapter.setNotifier) {
        adapter.setNotifier(fn);
      }
    }
  }

  /** Get status of all registered adapters. */
  getAllStatus(): Record<string, ChannelStatus> {
    const result: Record<string, ChannelStatus> = {};
    for (const [id, adapter] of this.adapters) {
      result[id] = adapter.getStatus();
    }
    return result;
  }

  /** Get a single adapter by id. */
  get(id: string): ChannelAdapter | undefined {
    return this.adapters.get(id);
  }

  /** List all registered adapter ids. */
  list(): string[] {
    return Array.from(this.adapters.keys());
  }
}
