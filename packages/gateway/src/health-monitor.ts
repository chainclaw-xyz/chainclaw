import { getLogger, triggerHook, createHookEvent } from "@chainclaw/core";
import type { ChannelRegistry } from "./channel-registry.js";
import type { ChannelStatus } from "./channel-adapter.js";

const logger = getLogger("health-monitor");

export interface ChannelHealthSnapshot {
  channelId: string;
  status: ChannelStatus;
  checkedAt: number;
}

/**
 * Periodically polls channel adapters for status and emits hooks on changes.
 * Ported from OpenClaw's ChannelAccountSnapshot pattern.
 */
export class ChannelHealthMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastStatus = new Map<string, boolean>();
  private snapshots = new Map<string, ChannelHealthSnapshot>();

  constructor(
    private registry: ChannelRegistry,
    private checkIntervalMs: number = 30_000,
  ) {}

  start(): void {
    // Take initial snapshot
    this.check();

    this.interval = setInterval(() => {
      this.check();
    }, this.checkIntervalMs);

    logger.info({ intervalMs: this.checkIntervalMs }, "Health monitor started");
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private check(): void {
    const allStatus = this.registry.getAllStatus();

    for (const [channelId, status] of Object.entries(allStatus)) {
      const snapshot: ChannelHealthSnapshot = {
        channelId,
        status,
        checkedAt: Date.now(),
      };
      this.snapshots.set(channelId, snapshot);

      // Detect status changes
      const wasConnected = this.lastStatus.get(channelId);

      if (wasConnected !== undefined && wasConnected !== status.connected) {
        const event = status.connected ? "connected" : "disconnected";
        logger.warn({ channelId, event }, `Channel ${event}`);
        void triggerHook(createHookEvent("channel", event, {
          channelId,
          lastError: status.lastError,
        }));
      }

      this.lastStatus.set(channelId, status.connected);
    }
  }

  /** Get the latest snapshot for all channels. */
  getAllSnapshots(): ChannelHealthSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  /** Get a single channel's latest snapshot. */
  getSnapshot(channelId: string): ChannelHealthSnapshot | undefined {
    return this.snapshots.get(channelId);
  }
}
