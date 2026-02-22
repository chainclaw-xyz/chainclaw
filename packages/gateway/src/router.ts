import { getLogger } from "@chainclaw/core";
import type { ChannelContext, GatewayDeps } from "./types.js";

const logger = getLogger("router");

/**
 * Platform-agnostic command router.
 * Handles all shared command logic; channel adapters map native events into
 * ChannelContext and call these methods.
 */
export class CommandRouter {
  constructor(private deps: GatewayDeps) {}

  /**
   * Check if the sender is allowed by the security guard.
   * Returns true if blocked (caller should stop processing).
   */
  private async checkBlocked(ctx: ChannelContext): Promise<boolean> {
    const guard = this.deps.securityGuard;
    if (!guard) return false;

    if (!guard.isAllowed(ctx.userId, ctx.userName, ctx.platform)) {
      logger.info({ userId: ctx.userId, platform: ctx.platform }, "Blocked by security guard");
      await ctx.sendReply("Access denied. You are not on the allowlist for this bot.");
      return true;
    }
    return false;
  }

  // ─── /start ────────────────────────────────────────────────

  async handleStart(ctx: ChannelContext): Promise<void> {
    if (await this.checkBlocked(ctx)) return;
    const { walletManager, skillRegistry, agentRuntime } = this.deps;
    const hasWallet = walletManager.listWallets().length > 0;
    const hasLLM = !!agentRuntime;
    const skillCount = skillRegistry.list().length;

    // Fully configured — show normal welcome
    if (hasWallet && hasLLM) {
      await ctx.sendReply(
        [
          "*Welcome to ChainClaw*",
          "",
          "Your self-hosted DeFi operations agent.",
          "",
          `*Status:* ${skillCount} skills loaded, wallet configured, AI enabled`,
          "",
          "You can talk to me in natural language or use commands:",
          "",
          "*Commands:*",
          "/wallet - Manage wallets",
          "/balance - Check balances",
          "/clear - Clear conversation history",
          "/help - Show help",
          "",
          "Or just ask me anything:",
          '_"What\'s my ETH balance on Base?"_',
          '_"Is this token safe? 0x..."_',
        ].join("\n"),
      );
      return;
    }

    // Onboarding wizard for new/incomplete setups
    const steps: string[] = ["*Welcome to ChainClaw* — Setup Guide", ""];

    if (!hasWallet) {
      steps.push("1. *Create a wallet* (required)");
      steps.push("   /wallet create my-wallet");
      steps.push("");
    } else {
      steps.push("1. \\u2705 Wallet configured");
      steps.push("");
    }

    if (!hasLLM) {
      steps.push("2. *Configure AI* (recommended)");
      steps.push("   Set LLM\\_PROVIDER and API key in .env");
      steps.push("   Supports: Ollama (free), Anthropic, OpenAI");
      steps.push("");
    } else {
      steps.push("2. \\u2705 AI configured");
      steps.push("");
    }

    steps.push(`3. *${skillCount} skills ready* — /help to see all`);
    steps.push("");
    steps.push("_Complete the steps above, then send /start again._");

    await ctx.sendReply(steps.join("\n"));
  }

  // ─── /help ─────────────────────────────────────────────────

  async handleHelp(ctx: ChannelContext): Promise<void> {
    if (await this.checkBlocked(ctx)) return;
    const skills = this.deps.skillRegistry.list();
    const skillList = skills
      .map((s) => `  *${s.name}* - ${s.description}`)
      .join("\n");

    await ctx.sendReply(
      [
        "*ChainClaw Help*",
        "",
        "*Natural Language:*",
        "  Just send me a message in plain English!",
        '  _"Show my portfolio"_',
        '  _"Swap 1 ETH for USDC"_',
        "",
        "*Wallet Commands:*",
        "  /wallet create \\[label\\] - Create new wallet",
        "  /wallet import \\[key\\] \\[label\\] - Import wallet",
        "  /wallet list - List all wallets",
        "  /wallet default \\[address\\] - Set default wallet",
        "",
        "*Skills:*",
        skillList || "  No skills registered",
        "",
        "*Other:*",
        "  /balance - Check balances across chains",
        "  /clear - Clear conversation history",
        "  /help - Show this help message",
      ].join("\n"),
    );
  }

  // ─── /wallet ───────────────────────────────────────────────

  async handleWallet(
    ctx: ChannelContext,
    args: string[],
    platformHooks?: {
      /** Called after wallet import so the adapter can delete the original message */
      onImportMessage?: () => Promise<void>;
    },
  ): Promise<void> {
    if (await this.checkBlocked(ctx)) return;
    const { walletManager } = this.deps;
    const subcommand = args[0]?.toLowerCase();

    try {
      switch (subcommand) {
        case "create": {
          const label = args[1] || `wallet-${Date.now()}`;
          const { wallet, mnemonic } = walletManager.generateWalletFromMnemonic(label);
          await ctx.sendReply(
            [
              "*Wallet Created*",
              "",
              `*Label:* ${wallet.label}`,
              `*Address:* \`${wallet.address}\``,
              "",
              "*Recovery phrase (save this securely):*",
              `\`${mnemonic}\``,
              "",
              "_This message will NOT be shown again. Save your recovery phrase now._",
            ].join("\n"),
          );
          break;
        }

        case "import": {
          const privateKey = args[1];
          const label = args[2] || `imported-${Date.now()}`;
          if (!privateKey?.startsWith("0x")) {
            await ctx.sendReply("Usage: /wallet import 0xYourPrivateKey [label]");
            return;
          }

          // Let the adapter delete the message containing the key
          if (platformHooks?.onImportMessage) {
            await platformHooks.onImportMessage();
          }

          const wallet = walletManager.importFromPrivateKey(
            privateKey as `0x${string}`,
            label,
          );
          await ctx.sendReply(
            [
              "*Wallet Imported*",
              "",
              `*Label:* ${wallet.label}`,
              `*Address:* \`${wallet.address}\``,
              "",
              "_Your message with the private key has been deleted for security._",
            ].join("\n"),
          );
          break;
        }

        case "list": {
          const wallets = walletManager.listWallets();
          if (wallets.length === 0) {
            await ctx.sendReply("No wallets configured. Use /wallet create to get started.");
            return;
          }
          const lines = wallets.map(
            (w) =>
              `${w.isDefault ? "-> " : "   "}\`${w.address}\` (${w.label})`,
          );
          await ctx.sendReply(
            ["*Your Wallets*", "", ...lines].join("\n"),
          );
          break;
        }

        case "default": {
          const address = args[1];
          if (!address) {
            await ctx.sendReply("Usage: /wallet default 0xYourAddress");
            return;
          }
          walletManager.setDefault(address);
          await ctx.sendReply(`Default wallet set to \`${address}\``);
          break;
        }

        default:
          await ctx.sendReply(
            [
              "*Wallet Commands:*",
              "  /wallet create \\[label\\] - Create new wallet",
              "  /wallet import \\[key\\] \\[label\\] - Import wallet",
              "  /wallet list - List wallets",
              "  /wallet default \\[address\\] - Set default",
            ].join("\n"),
          );
      }
    } catch (err) {
      logger.error({ err, subcommand }, "Wallet command failed");
      await ctx.sendReply(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  // ─── /balance ──────────────────────────────────────────────

  async handleBalance(ctx: ChannelContext): Promise<void> {
    if (await this.checkBlocked(ctx)) return;
    const { walletManager, chainManager, skillRegistry } = this.deps;
    const defaultAddr = walletManager.getDefaultAddress();
    if (!defaultAddr) {
      await ctx.sendReply("No wallet configured. Use /wallet create to get started.");
      return;
    }

    const balanceSkill = skillRegistry.get("balance");
    if (!balanceSkill) {
      await ctx.sendReply("Balance skill not available.");
      return;
    }

    try {
      const result = await balanceSkill.execute(
        {},
        {
          userId: ctx.userId,
          walletAddress: defaultAddr,
          chainIds: chainManager.getSupportedChains(),
          sendReply: ctx.sendReply,
        },
      );
      await ctx.sendReply(result.message);
    } catch (err) {
      logger.error({ err }, "Balance command failed");
      await ctx.sendReply("Failed to fetch balances. Please try again.");
    }
  }

  // ─── /clear ────────────────────────────────────────────────

  async handleClear(ctx: ChannelContext): Promise<void> {
    if (await this.checkBlocked(ctx)) return;
    if (this.deps.agentRuntime) {
      this.deps.agentRuntime.clearHistory(ctx.userId);
      await ctx.sendReply("Conversation history cleared.");
    } else {
      await ctx.sendReply("Memory system not available.");
    }
  }

  // ─── Natural language (catch-all) ──────────────────────────

  async handleMessage(ctx: ChannelContext, text: string): Promise<void> {
    if (await this.checkBlocked(ctx)) return;
    const { agentRuntime, walletManager, chainManager } = this.deps;

    if (!agentRuntime) {
      await ctx.sendReply(
        "Natural language processing is not configured. Please set up an LLM provider in your .env file. Use /help for available commands.",
      );
      return;
    }

    try {
      const response = await agentRuntime.handleMessage(ctx.userId, text, {
        walletAddress: walletManager.getDefaultAddress(),
        chainIds: chainManager.getSupportedChains(),
        sendReply: ctx.sendReply,
        requestConfirmation: ctx.requestConfirmation,
      });

      await ctx.sendReply(response.text);
    } catch (err) {
      logger.error({ err }, "NL message handling failed");
      await ctx.sendReply("Something went wrong processing your message. Please try again.");
    }
  }
}
