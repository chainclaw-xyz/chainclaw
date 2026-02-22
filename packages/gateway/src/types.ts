import type { WalletManager } from "@chainclaw/wallet";
import type { ChainManager } from "@chainclaw/chains";
import type { SkillRegistry } from "@chainclaw/skills";
import type { AgentRuntime } from "@chainclaw/agent";
import type { SecurityGuard } from "./security.js";

/**
 * Platform-agnostic context for a channel message.
 * Each adapter (Telegram, Discord, Web, Slack, etc.) maps its native context into this shape.
 */
export interface ChannelContext {
  userId: string;
  userName?: string;
  channelId: string;
  platform: string;
  sendReply: (text: string) => Promise<void>;
  requestConfirmation?: (prompt: string) => Promise<boolean>;
}

/**
 * Shared dependencies injected into every gateway adapter and the CommandRouter.
 */
export interface GatewayDeps {
  walletManager: WalletManager;
  chainManager: ChainManager;
  skillRegistry: SkillRegistry;
  agentRuntime?: AgentRuntime;
  securityGuard?: SecurityGuard;
}
