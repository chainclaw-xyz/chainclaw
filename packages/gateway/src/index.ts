// Channel adapter system
export type { ChannelAdapter, ChannelStatus, AlertNotifier } from "./channel-adapter.js";
export { ChannelRegistry } from "./channel-registry.js";

// Adapters
export { TelegramAdapter, createTelegramBot, type TelegramBotDeps } from "./telegram.js";
export { DiscordAdapter, createDiscordBot } from "./discord.js";
export { WebAdapter, createWebChat, type WebChatOptions } from "./web.js";
export { SlackAdapter } from "./slack.js";
export { WhatsAppAdapter } from "./whatsapp.js";

// Health
export { ChannelHealthMonitor, type ChannelHealthSnapshot } from "./health-monitor.js";

// Security
export {
  SecurityGuard,
  resolveAllowlistMatch,
  formatAllowlistMatchMeta,
  type SecurityMode,
  type SecurityConfig,
  type AllowlistMatch,
  type AllowlistMatchSource,
} from "./security.js";

// Shared
export { CommandRouter } from "./router.js";
export { RateLimiter } from "./rate-limiter.js";
export { formatMessage, type Platform } from "./formatter.js";
export type { ChannelContext, GatewayDeps } from "./types.js";
