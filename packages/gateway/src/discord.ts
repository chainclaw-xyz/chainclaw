import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Interaction,
  type Message,
  type TextChannel,
  ComponentType,
} from "discord.js";
import { getLogger } from "@chainclaw/core";
import type { GatewayDeps } from "./types.js";
import type { ChannelContext } from "./types.js";
import type { ChannelAdapter, ChannelStatus, AlertNotifier } from "./channel-adapter.js";
import { CommandRouter } from "./router.js";
import { RateLimiter } from "./rate-limiter.js";

const logger = getLogger("discord");

const CONFIRMATION_TIMEOUT_MS = 120_000; // 2 minutes

// ─── Slash command definitions ────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName("start")
    .setDescription("Get started with ChainClaw"),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show help and available skills"),
  new SlashCommandBuilder()
    .setName("wallet")
    .setDescription("Manage wallets")
    .addStringOption((opt) =>
      opt
        .setName("action")
        .setDescription("Wallet action")
        .setRequired(false)
        .addChoices(
          { name: "create", value: "create" },
          { name: "list", value: "list" },
          { name: "default", value: "default" },
        ),
    )
    .addStringOption((opt) =>
      opt
        .setName("value")
        .setDescription("Label (for create) or address (for default)")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check wallet balances across chains"),
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Clear conversation history"),
];

// ─── Discord ↔ ChannelContext ─────────────────────────────────

function makeDiscordContext(
  interaction: Interaction,
  sendFn: (text: string) => Promise<void>,
): ChannelContext {
  const userId = interaction.user.id;
  const channelId = interaction.channelId ?? "dm";

  return {
    userId,
    channelId,
    platform: "discord",
    sendReply: sendFn,
    requestConfirmation: async (prompt: string) => {
      const channel = interaction.channel;
      if (!channel || !("send" in channel)) return false;

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("confirm_yes")
          .setLabel("Yes, proceed")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("confirm_no")
          .setLabel("No, cancel")
          .setStyle(ButtonStyle.Danger),
      );

      const msg = await channel.send({ content: prompt, components: [row] });

      try {
        const response = await msg.awaitMessageComponent({
          componentType: ComponentType.Button,
          filter: (i) => i.user.id === userId,
          time: CONFIRMATION_TIMEOUT_MS,
        });

        await response.update({
          content: prompt + `\n\n_${response.customId === "confirm_yes" ? "Confirmed" : "Cancelled"} by user_`,
          components: [],
        });

        return response.customId === "confirm_yes";
      } catch {
        await msg.edit({ content: prompt + "\n\n_Confirmation timed out_", components: [] });
        return false;
      }
    },
  };
}

function makeMessageContext(
  message: Message,
): ChannelContext {
  const userId = message.author.id;
  const channelId = message.channelId;

  return {
    userId,
    channelId,
    platform: "discord",
    sendReply: async (text: string) => {
      await message.reply(text);
    },
    requestConfirmation: async (prompt: string) => {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("confirm_yes")
          .setLabel("Yes, proceed")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("confirm_no")
          .setLabel("No, cancel")
          .setStyle(ButtonStyle.Danger),
      );

      const msg = await message.reply({ content: prompt, components: [row] });

      try {
        const response = await msg.awaitMessageComponent({
          componentType: ComponentType.Button,
          filter: (i) => i.user.id === userId,
          time: CONFIRMATION_TIMEOUT_MS,
        });

        await response.update({
          content: prompt + `\n\n_${response.customId === "confirm_yes" ? "Confirmed" : "Cancelled"} by user_`,
          components: [],
        });

        return response.customId === "confirm_yes";
      } catch {
        await msg.edit({ content: prompt + "\n\n_Confirmation timed out_", components: [] });
        return false;
      }
    },
  };
}

// ─── DiscordAdapter ──────────────────────────────────────────

export class DiscordAdapter implements ChannelAdapter {
  readonly id = "discord";
  readonly label = "Discord";

  private client: Client | null = null;
  private notifier: AlertNotifier | null = null;
  private status: ChannelStatus = {
    connected: false,
    lastMessageAt: null,
    lastError: null,
  };

  constructor(
    private token: string,
    private clientId: string,
  ) {}

  async start(deps: GatewayDeps): Promise<void> {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    this.client = client;

    const router = new CommandRouter(deps);
    const rateLimiter = new RateLimiter();

    // ─── Register slash commands ──────────────────────────────
    const rest = new REST({ version: "10" }).setToken(this.token);

    try {
      logger.info("Registering Discord slash commands...");
      await rest.put(Routes.applicationCommands(this.clientId), {
        body: commands.map((c) => c.toJSON()),
      });
      logger.info("Discord slash commands registered");
    } catch (err) {
      logger.error({ err }, "Failed to register Discord commands");
    }

    // ─── Slash command handler ────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    client.on("interactionCreate", async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const userId = interaction.user.id;
      if (rateLimiter.isLimited(userId)) {
        await interaction.reply({
          content: "You're sending commands too fast. Please wait a moment.",
          ephemeral: true,
        });
        return;
      }

      // Wallet responses may contain sensitive data (mnemonics, addresses) — ephemeral
      const isWallet = interaction.commandName === "wallet";
      await interaction.deferReply({ ephemeral: isWallet });

      const sendFn = async (text: string) => {
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp(text);
          } else {
            await interaction.reply(text);
          }
        } catch (err) {
          logger.error({ err }, "Failed to send Discord reply");
        }
      };

      const ctx = makeDiscordContext(interaction, sendFn);

      try {
        switch (interaction.commandName) {
          case "start":
            await router.handleStart(ctx);
            break;

          case "help":
            await router.handleHelp(ctx);
            break;

          case "wallet": {
            const action = interaction.options.getString("action") ?? "";
            const value = interaction.options.getString("value") ?? "";
            const args = [action, value].filter(Boolean);
            await router.handleWallet(ctx, args, {
              onImportMessage: async () => {
                // Slash command params aren't shown in chat, and response is ephemeral
                logger.info({ userId }, "Wallet import via Discord (ephemeral)");
              },
            });
            break;
          }

          case "balance":
            await router.handleBalance(ctx);
            break;

          case "clear":
            await router.handleClear(ctx);
            break;

          default:
            await sendFn(`Unknown command: ${interaction.commandName}`);
        }
      } catch (err) {
        logger.error({ err, command: interaction.commandName }, "Discord command error");
        await sendFn("An error occurred processing your command.");
      }
    });

    // ─── DM / @mention natural language handler ───────────────
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    client.on("messageCreate", async (message) => {
      // Ignore bots
      if (message.author.bot) return;

      // Only respond in DMs or when @mentioned
      const isDM = !message.guild;
      const isMentioned = message.mentions.has(client.user!);
      if (!isDM && !isMentioned) return;

      const userId = message.author.id;
      if (rateLimiter.isLimited(userId)) {
        await message.reply("You're sending messages too fast. Please wait a moment.");
        return;
      }

      // Strip the mention from the text
      let text = message.content;
      if (isMentioned && client.user) {
        text = text.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
      }

      if (!text) return;

      this.status.lastMessageAt = Date.now();

      // Show typing indicator with refresh loop (Discord typing lasts ~10s)
      const channel = message.channel as TextChannel;
      try {
        await channel.sendTyping();
      } catch {
        // Ignore typing errors
      }

      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      const typingInterval = setInterval(async () => {
        try {
          await channel.sendTyping();
        } catch {
          // Ignore typing errors
        }
      }, 8_000);

      try {
        const ctx = makeMessageContext(message);
        await router.handleMessage(ctx, text);
      } finally {
        clearInterval(typingInterval);
      }
    });

    // ─── Ready ────────────────────────────────────────────────
    client.on("ready", () => {
      this.status.connected = true;
      logger.info({ tag: client.user?.tag }, "Discord bot ready");
    });

    // ─── Login ────────────────────────────────────────────────
    await client.login(this.token);
  }

  async stop(): Promise<void> {
    if (this.client) {
      void this.client.destroy();
      this.client = null;
      this.status.connected = false;
    }
  }

  getStatus(): ChannelStatus {
    return { ...this.status };
  }

  setNotifier(fn: AlertNotifier): void {
    this.notifier = fn;
  }

  /** Send an alert notification to a user via DM. Used by AlertEngine. */
  async notify(userId: string, message: string): Promise<void> {
    if (this.notifier) {
      await this.notifier(userId, message);
      return;
    }

    if (!this.client) {
      throw new Error("Discord client not initialized");
    }

    const user = await this.client.users.fetch(userId);
    await user.send(message);
  }
}

// ─── Legacy factory (backward compat) ────────────────────────

/** @deprecated Use DiscordAdapter instead */
export async function createDiscordBot(
  token: string,
  clientId: string,
  deps: GatewayDeps,
): Promise<Client> {
  const adapter = new DiscordAdapter(token, clientId);
  await adapter.start(deps);
  // Return a client placeholder for backward compat. The adapter owns the client now.
  // Callers that used client.destroy() should use the adapter instead.
  return new Client({ intents: [] });
}
