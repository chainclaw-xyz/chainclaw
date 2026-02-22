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

// ─── Bot Factory ──────────────────────────────────────────────

export async function createDiscordBot(
  token: string,
  clientId: string,
  deps: GatewayDeps,
): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const router = new CommandRouter(deps);
  const rateLimiter = new RateLimiter();

  // ─── Register slash commands ──────────────────────────────
  const rest = new REST({ version: "10" }).setToken(token);

  try {
    logger.info("Registering Discord slash commands...");
    await rest.put(Routes.applicationCommands(clientId), {
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

    // Defer reply for potentially slow operations
    await interaction.deferReply();

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
          await router.handleWallet(ctx, args);
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

    // Show typing
    const channel = message.channel as TextChannel;
    try {
      await channel.sendTyping();
    } catch {
      // Ignore typing errors
    }

    const ctx = makeMessageContext(message);
    await router.handleMessage(ctx, text);
  });

  // ─── Ready ────────────────────────────────────────────────
  client.on("ready", () => {
    logger.info({ tag: client.user?.tag }, "Discord bot ready");
  });

  // ─── Login ────────────────────────────────────────────────
  await client.login(token);

  return client;
}
