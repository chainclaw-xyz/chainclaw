import { Bot, InlineKeyboard } from "grammy";
import { getLogger } from "@chainclaw/core";
import type { GatewayDeps } from "./types.js";
import type { ChannelContext } from "./types.js";
import type { ChannelAdapter, ChannelStatus, AlertNotifier } from "./channel-adapter.js";
import { CommandRouter } from "./router.js";
import { RateLimiter } from "./rate-limiter.js";

const logger = getLogger("telegram");

// ─── Confirmation System ──────────────────────────────────────
interface PendingConfirmation {
  resolve: (confirmed: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const pendingConfirmations = new Map<string, PendingConfirmation>();
const CONFIRMATION_TIMEOUT_MS = 120_000; // 2 minutes

function createRequestConfirmation(
  bot: Bot,
  chatId: number,
): (prompt: string) => Promise<boolean> {
  return async (prompt: string): Promise<boolean> => {
    const confirmId = `${chatId}:${Date.now()}`;

    const keyboard = new InlineKeyboard()
      .text("Yes, proceed", `confirm:${confirmId}:yes`)
      .text("No, cancel", `confirm:${confirmId}:no`);

    await bot.api.sendMessage(chatId, prompt, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        pendingConfirmations.delete(confirmId);
        resolve(false);
      }, CONFIRMATION_TIMEOUT_MS);

      pendingConfirmations.set(confirmId, { resolve, timeout });
    });
  };
}

// ─── Telegram ↔ ChannelContext helper ────────────────────────

function makeTelegramContext(
  bot: Bot,
  ctx: { from?: { id: number }; chat?: { id: number }; reply: (text: string, opts?: object) => Promise<unknown> },
): ChannelContext {
  const userId = ctx.from?.id.toString() ?? "unknown";
  const chatId = ctx.chat?.id ?? 0;
  return {
    userId,
    channelId: String(chatId),
    platform: "telegram",
    sendReply: async (text: string) => {
      await ctx.reply(text, { parse_mode: "Markdown" });
    },
    requestConfirmation: createRequestConfirmation(bot, chatId),
  };
}

// ─── TelegramAdapter ─────────────────────────────────────────

export class TelegramAdapter implements ChannelAdapter {
  readonly id = "telegram";
  readonly label = "Telegram";

  private bot: Bot | null = null;
  private notifier: AlertNotifier | null = null;
  private status: ChannelStatus = {
    connected: false,
    lastMessageAt: null,
    lastError: null,
  };

  constructor(private token: string) {}

  async start(deps: GatewayDeps): Promise<void> {
    const bot = new Bot(this.token);
    this.bot = bot;
    const router = new CommandRouter(deps);
    const rateLimiter = new RateLimiter();

    // ─── Rate limiting middleware ─────────────────────────────
    bot.use(async (ctx, next) => {
      const userId = ctx.from?.id.toString();
      if (userId && rateLimiter.isLimited(userId)) {
        logger.warn({ userId }, "Rate limited");
        await ctx.reply("You're sending messages too fast. Please wait a moment.");
        return;
      }
      await next();
    });

    // ─── Confirmation callback handler ────────────────────────
    bot.callbackQuery(/^confirm:(.+):(yes|no)$/, async (ctx) => {
      const match = ctx.callbackQuery.data.match(/^confirm:(.+):(yes|no)$/);
      if (!match) return;

      const [, confirmId, answer] = match;
      const pending = pendingConfirmations.get(confirmId);

      if (!pending) {
        await ctx.answerCallbackQuery({ text: "This confirmation has expired." });
        return;
      }

      clearTimeout(pending.timeout);
      pendingConfirmations.delete(confirmId);
      pending.resolve(answer === "yes");

      await ctx.answerCallbackQuery({
        text: answer === "yes" ? "Confirmed" : "Cancelled",
      });

      await ctx.editMessageText(
        ctx.callbackQuery.message?.text + `\n\n_${answer === "yes" ? "Confirmed" : "Cancelled"} by user_`,
        { parse_mode: "Markdown" },
      );
    });

    // ─── Commands → Router ────────────────────────────────────

    bot.command("start", async (ctx) => {
      await router.handleStart(makeTelegramContext(bot, ctx));
    });

    bot.command("help", async (ctx) => {
      await router.handleHelp(makeTelegramContext(bot, ctx));
    });

    bot.command("wallet", async (ctx) => {
      const args = ctx.match?.split(/\s+/) ?? [];
      await router.handleWallet(makeTelegramContext(bot, ctx), args, {
        onImportMessage: async () => {
          try {
            await ctx.deleteMessage();
          } catch {
            logger.debug("Could not delete message with private key (bot may lack permissions)");
          }
        },
      });
    });

    bot.command("balance", async (ctx) => {
      await ctx.replyWithChatAction("typing");
      await router.handleBalance(makeTelegramContext(bot, ctx));
    });

    bot.command("clear", async (ctx) => {
      await router.handleClear(makeTelegramContext(bot, ctx));
    });

    // ─── Natural language handler (catch-all) ─────────────────
    bot.on("message:text", async (ctx) => {
      this.status.lastMessageAt = Date.now();
      await ctx.replyWithChatAction("typing");

      // Keep sending typing indicator for long operations
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      const typingInterval = setInterval(async () => {
        try {
          await ctx.replyWithChatAction("typing");
        } catch {
          // Ignore errors from typing indicator
        }
      }, 4000);

      try {
        await router.handleMessage(makeTelegramContext(bot, ctx), ctx.message.text);
      } finally {
        clearInterval(typingInterval);
      }
    });

    // ─── Error handler ────────────────────────────────────────
    bot.catch((err) => {
      this.status.lastError = String(err.error);
      logger.error({ err: err.error, ctx: err.ctx?.update }, "Bot error");
    });

    // Start polling (non-blocking — we don't await bot.start() here)
    void bot.start({
      onStart: (botInfo) => {
        this.status.connected = true;
        logger.info({ username: botInfo.username }, "Telegram bot started");
      },
    });
  }

  async stop(): Promise<void> {
    if (this.bot) {
      void this.bot.stop();
      this.bot = null;
      this.status.connected = false;
    }
  }

  getStatus(): ChannelStatus {
    return { ...this.status };
  }

  setNotifier(fn: AlertNotifier): void {
    this.notifier = fn;
  }

  /** Send an alert notification to a user. Used by AlertEngine. */
  async notify(userId: string, message: string): Promise<void> {
    if (this.notifier) {
      await this.notifier(userId, message);
    } else if (this.bot) {
      await this.bot.api.sendMessage(Number(userId), message, { parse_mode: "Markdown" });
    }
  }

  /** Get the underlying Bot instance (for alert wiring). */
  getBot(): Bot | null {
    return this.bot;
  }
}

// ─── Legacy factory (backward compat) ────────────────────────

/** @deprecated Use TelegramAdapter instead */
export type TelegramBotDeps = GatewayDeps;

/** @deprecated Use TelegramAdapter instead */
export function createTelegramBot(token: string, deps: GatewayDeps): Bot {
  const adapter = new TelegramAdapter(token);
  // Sync start — the legacy API expected the bot returned immediately
  void adapter.start(deps);
  return adapter.getBot()!;
}
