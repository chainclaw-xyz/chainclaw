import { App, LogLevel } from "@slack/bolt";
import { getLogger } from "@chainclaw/core";
import type { GatewayDeps } from "./types.js";
import type { ChannelContext } from "./types.js";
import type { ChannelAdapter, ChannelStatus } from "./channel-adapter.js";
import { CommandRouter } from "./router.js";
import { RateLimiter } from "./rate-limiter.js";

const logger = getLogger("slack");

// ─── Slack ↔ ChannelContext ──────────────────────────────────

function makeSlackContext(
  say: (text: string) => Promise<unknown>,
  userId: string,
  channelId: string,
): ChannelContext {
  return {
    userId,
    channelId,
    platform: "slack",
    sendReply: async (text: string) => {
      await say(text);
    },
    // Slack confirmations use interactive blocks, but for simplicity
    // we use a text-based yes/no prompt for now
    requestConfirmation: async (prompt: string) => {
      await say(prompt + "\n\nReply *yes* to confirm or *no* to cancel.");
      // Slack doesn't have a simple callback mechanism like Telegram inline keyboards
      // without building a full interactive message flow. For now, default to requiring
      // the user to send a follow-up message. In practice, DeFi txs go through the
      // existing guardrails confirmation gate.
      return false;
    },
  };
}

// ─── SlackAdapter ────────────────────────────────────────────

export class SlackAdapter implements ChannelAdapter {
  readonly id = "slack";
  readonly label = "Slack";

  private app: App | null = null;
  private status: ChannelStatus = {
    connected: false,
    lastMessageAt: null,
    lastError: null,
  };

  constructor(
    private botToken: string,
    private appToken: string,
  ) {}

  async start(deps: GatewayDeps): Promise<void> {
    const app = new App({
      token: this.botToken,
      appToken: this.appToken,
      socketMode: true,
      logLevel: LogLevel.WARN,
    });
    this.app = app;

    const router = new CommandRouter(deps);
    const rateLimiter = new RateLimiter();

    // ─── Slash commands ───────────────────────────────────────
    const slashHandler = (command: string) => {
      return async ({ ack, say, body }: { ack: () => Promise<void>; say: (text: string) => Promise<unknown>; body: { user_id: string; channel_id?: string } }) => {
        await ack();
        const userId = body.user_id;

        if (rateLimiter.isLimited(userId)) {
          await say("You're sending messages too fast. Please wait a moment.");
          return;
        }

        const ctx = makeSlackContext(say, userId, body.channel_id ?? "dm");

        switch (command) {
          case "start":
            await router.handleStart(ctx);
            break;
          case "help":
            await router.handleHelp(ctx);
            break;
          case "balance":
            await router.handleBalance(ctx);
            break;
          case "clear":
            await router.handleClear(ctx);
            break;
        }
      };
    };

    app.command("/chainclaw-start", slashHandler("start"));
    app.command("/chainclaw-help", slashHandler("help"));
    app.command("/chainclaw-balance", slashHandler("balance"));
    app.command("/chainclaw-clear", slashHandler("clear"));

    // ─── DM / @mention natural language handler ───────────────
    app.event("message", async ({ event, say }) => {
      // Only handle user messages (not bot messages, edits, etc.)
      if (!("text" in event) || !event.text) return;
      if ("bot_id" in event && event.bot_id) return;
      if ("subtype" in event && event.subtype) return;

      const userId = event.user ?? "unknown";
      if (rateLimiter.isLimited(userId)) {
        await say("You're sending messages too fast. Please wait a moment.");
        return;
      }

      this.status.lastMessageAt = Date.now();
      const text = event.text.trim();
      if (!text) return;

      const ctx = makeSlackContext(say, userId, event.channel);

      // Parse slash-style commands from message text
      if (text.startsWith("/")) {
        const parts = text.split(/\s+/);
        const command = parts[0].slice(1).toLowerCase();
        const args = parts.slice(1);

        switch (command) {
          case "start":
            await router.handleStart(ctx);
            return;
          case "help":
            await router.handleHelp(ctx);
            return;
          case "wallet":
            await router.handleWallet(ctx, args);
            return;
          case "balance":
            await router.handleBalance(ctx);
            return;
          case "clear":
            await router.handleClear(ctx);
            return;
        }
      }

      // Natural language fallback
      await router.handleMessage(ctx, text);
    });

    // ─── App mention handler (for channels) ───────────────────
    app.event("app_mention", async ({ event, say }) => {
      const userId = event.user ?? "unknown";
      if (rateLimiter.isLimited(userId)) {
        await say("You're sending messages too fast. Please wait a moment.");
        return;
      }

      this.status.lastMessageAt = Date.now();

      // Strip the mention from the text
      const text = (event.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim();
      if (!text) return;

      const ctx = makeSlackContext(say, userId, event.channel);
      await router.handleMessage(ctx, text);
    });

    // ─── Start in Socket Mode ─────────────────────────────────
    await app.start();
    this.status.connected = true;
    logger.info("Slack bot started (Socket Mode)");
  }

  async stop(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      this.app = null;
      this.status.connected = false;
    }
  }

  getStatus(): ChannelStatus {
    return { ...this.status };
  }
}
