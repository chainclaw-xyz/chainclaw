import type { GatewayDeps } from "./types.js";

/**
 * Status snapshot for a running channel adapter.
 */
export interface ChannelStatus {
  connected: boolean;
  lastMessageAt: number | null;
  lastError: string | null;
}

/**
 * Alert notifier callback — channels that support push notifications
 * implement setNotifier to receive outbound alert messages.
 */
export type AlertNotifier = (userId: string, message: string) => Promise<void>;

/**
 * Pluggable channel adapter contract.
 * Each messaging platform (Telegram, Discord, Slack, etc.) implements this
 * interface so the server can manage channels uniformly.
 */
export interface ChannelAdapter {
  /** Unique identifier, e.g. "telegram", "discord", "web", "slack" */
  readonly id: string;

  /** Display label for logs and health endpoint */
  readonly label: string;

  /** Connect to the platform and start receiving messages */
  start(deps: GatewayDeps): Promise<void>;

  /** Graceful disconnect */
  stop(): Promise<void>;

  /** Current connection status */
  getStatus(): ChannelStatus;

  /** Optional: register an alert notifier for outbound push messages */
  setNotifier?(fn: AlertNotifier): void;
}
