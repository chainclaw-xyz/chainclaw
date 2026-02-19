import { loadConfig, createLogger, getLogger } from "@chainclaw/core";
import { ChainManager } from "@chainclaw/chains";
import { WalletManager } from "@chainclaw/wallet";
import {
  SkillRegistry,
  createBalanceSkill,
  createSwapSkill,
  createBridgeSkill,
  createLendSkill,
  DcaScheduler,
  createDcaSkill,
  AlertEngine,
  createAlertSkill,
  createWorkflowSkill,
  createPortfolioSkill,
  createRiskCheckSkill,
  createHistorySkill,
  createBacktestSkill,
  createAgentSkill,
  getTokenPrice,
} from "@chainclaw/skills";
import { createLLMProvider, getDatabase, AgentRuntime, closeDatabase } from "@chainclaw/agent";
import { TransactionExecutor } from "@chainclaw/pipeline";
import {
  HistoricalDataProvider,
  PerformanceTracker,
  BacktestEngine,
  AgentRunner,
  createSampleDcaAgent,
  type AgentDefinition,
} from "@chainclaw/agent-sdk";
import {
  createTelegramBot,
  createDiscordBot,
  createWebChat,
  type GatewayDeps,
} from "@chainclaw/gateway";
import { SkillLoader } from "@chainclaw/skills-sdk";
import { loadPlugins } from "./plugin-loader.js";
import type { PluginHandle } from "./plugin.js";
import { createHealthServer } from "./health.js";

async function main(): Promise<void> {
  // ─── Load config ──────────────────────────────────────────
  const config = loadConfig();
  createLogger(config.logLevel);
  const logger = getLogger("server");

  logger.info("Starting ChainClaw...");

  // Ensure at least one channel is configured
  if (!config.telegramBotToken && !config.discordBotToken && !config.webChatEnabled) {
    throw new Error(
      "No channels configured. Set at least one of: TELEGRAM_BOT_TOKEN, DISCORD_BOT_TOKEN, WEB_CHAT_ENABLED=true",
    );
  }

  // ─── Initialize components ────────────────────────────────
  const chainManager = new ChainManager(config);
  const walletManager = new WalletManager(config.walletDir, config.walletPassword);
  const db = getDatabase(config.dataDir);

  // ─── Initialize pipeline ─────────────────────────────────
  const rpcOverrides: Record<number, string> = {
    1: config.ethRpcUrl,
    8453: config.baseRpcUrl,
    42161: config.arbitrumRpcUrl,
    10: config.optimismRpcUrl,
  };

  const executor = new TransactionExecutor(
    db,
    {
      tenderlyApiKey: config.tenderlyApiKey,
      tenderlyAccount: config.tenderlyAccount,
      tenderlyProject: config.tenderlyProject,
    },
    rpcOverrides,
  );

  logger.info(
    { tenderly: !!config.tenderlyApiKey, oneInchSwaps: !!config.oneInchApiKey },
    "Transaction pipeline initialized",
  );

  // ─── Register core skills ─────────────────────────────────
  const skillRegistry = new SkillRegistry();
  skillRegistry.register(createBalanceSkill(chainManager));
  skillRegistry.register(createSwapSkill(executor, walletManager, config.oneInchApiKey));
  skillRegistry.register(createBridgeSkill(executor, walletManager));
  skillRegistry.register(createLendSkill(executor, walletManager, rpcOverrides));
  const dcaScheduler = new DcaScheduler(db, executor, walletManager, config.oneInchApiKey);
  skillRegistry.register(createDcaSkill(dcaScheduler));
  const alertEngine = new AlertEngine(db);
  skillRegistry.register(createAlertSkill(alertEngine));
  skillRegistry.register(createWorkflowSkill(skillRegistry));
  skillRegistry.register(createPortfolioSkill(chainManager));
  skillRegistry.register(createRiskCheckSkill(executor.getRiskEngine()));
  skillRegistry.register(createHistorySkill(executor.getTransactionLog()));

  // ─── Agent SDK (backtest + live agents) ─────────────────────
  const historicalData = new HistoricalDataProvider(db);
  const performanceTracker = new PerformanceTracker(db);
  const backtestEngine = new BacktestEngine(historicalData);
  const agentRunner = new AgentRunner(performanceTracker, getTokenPrice);

  const resolveAgent = (strategy: string, token: string): AgentDefinition | null => {
    if (strategy === "dca") return createSampleDcaAgent({ targetToken: token.toUpperCase() });
    return null;
  };

  skillRegistry.register(createBacktestSkill(backtestEngine, resolveAgent));
  skillRegistry.register(createAgentSkill(agentRunner, performanceTracker, resolveAgent));

  // ─── Load community skills ────────────────────────────────
  if (config.skillsDir) {
    const skillLoader = new SkillLoader();
    const { loaded, errors } = await skillLoader.loadFromDirectory(config.skillsDir, skillRegistry);
    if (loaded.length > 0) {
      logger.info({ skills: loaded }, "Community skills loaded");
    }
    if (errors.length > 0) {
      logger.warn({ errors }, "Some community skills failed to load");
    }
  }

  // ─── Initialize agent (LLM + memory) ─────────────────────
  let agentRuntime: AgentRuntime | undefined;

  try {
    const llm = createLLMProvider(config);
    agentRuntime = new AgentRuntime(llm, db, skillRegistry);
    logger.info({ provider: config.llmProvider }, "Agent runtime initialized");
  } catch (err) {
    logger.warn(
      { err },
      "Agent runtime not available — running in command-only mode. Set LLM_PROVIDER and API key to enable NL.",
    );
  }

  // ─── Load plugins (marketplace, data-pipeline, etc.) ──────
  let pluginLlm;
  if (agentRuntime) {
    try { pluginLlm = createLLMProvider(config); } catch { /* ok */ }
  }

  const pluginHandles: PluginHandle[] = await loadPlugins({
    db,
    skillRegistry,
    agentRunner,
    performanceTracker,
    llm: pluginLlm,
    config: config as unknown as Record<string, unknown>,
    getTokenPrice,
    createSampleDcaAgent,
  });

  logger.info({ skills: skillRegistry.list().map((s) => s.name) }, "Skills registered");

  // ─── Shared gateway deps ──────────────────────────────────
  const gatewayDeps: GatewayDeps = {
    walletManager,
    chainManager,
    skillRegistry,
    agentRuntime,
  };

  // Start background services
  dcaScheduler.start();

  // ─── Start channels ───────────────────────────────────────
  const channels: string[] = [];
  let telegramBot: ReturnType<typeof createTelegramBot> | undefined;
  let discordClient: Awaited<ReturnType<typeof createDiscordBot>> | undefined;
  let webChatServer: ReturnType<typeof createWebChat> | undefined;

  // Telegram
  if (config.telegramBotToken) {
    telegramBot = createTelegramBot(config.telegramBotToken, gatewayDeps);

    // Wire alert notifications to Telegram
    alertEngine.setNotifier(async (userId, message) => {
      await telegramBot!.api.sendMessage(Number(userId), message, { parse_mode: "Markdown" });
    });

    channels.push("telegram");
  }

  // Discord
  if (config.discordBotToken && config.discordClientId) {
    try {
      discordClient = await createDiscordBot(
        config.discordBotToken,
        config.discordClientId,
        gatewayDeps,
      );
      channels.push("discord");
    } catch (err) {
      logger.error({ err }, "Failed to start Discord bot");
    }
  }

  // Web Chat
  if (config.webChatEnabled) {
    webChatServer = createWebChat(gatewayDeps, { port: config.webChatPort });
    channels.push(`web (port ${config.webChatPort})`);
  }

  alertEngine.start();

  // ─── Health check server ────────────────────────────────
  const healthServer = createHealthServer(config.healthCheckPort, {
    skillRegistry,
    agentRuntime,
    channels,
    startedAt: Date.now(),
  });

  // ─── Graceful shutdown ────────────────────────────────────
  const shutdown = async () => {
    logger.info("Shutting down...");
    agentRunner.stopAll();
    alertEngine.stop();
    dcaScheduler.stop();
    for (const h of pluginHandles) h.stop();

    if (telegramBot) telegramBot.stop();
    if (discordClient) discordClient.destroy();
    if (webChatServer) {
      webChatServer.wss.close();
      webChatServer.httpServer.close();
    }

    healthServer.close();
    closeDatabase();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // ─── Start Telegram (polling — blocks) ────────────────────
  if (telegramBot) {
    logger.info("Starting Telegram bot (polling mode)...");
    await telegramBot.start({
      onStart: (botInfo) => {
        logger.info(
          { username: botInfo.username, nlEnabled: !!agentRuntime, channels },
          "ChainClaw is running!",
        );
        console.log(`\n  ChainClaw is running!`);
        console.log(`  Channels: ${channels.join(", ")}`);
        console.log(`  Telegram: @${botInfo.username}`);
        console.log(`  NL mode: ${agentRuntime ? "enabled" : "disabled (set LLM_PROVIDER)"}`);
        console.log(`  Skills: ${skillRegistry.list().map((s) => s.name).join(", ")}\n`);
      },
    });
  } else {
    // No Telegram — just log and keep the process alive
    logger.info({ channels, nlEnabled: !!agentRuntime }, "ChainClaw is running!");
    console.log(`\n  ChainClaw is running!`);
    console.log(`  Channels: ${channels.join(", ")}`);
    console.log(`  NL mode: ${agentRuntime ? "enabled" : "disabled (set LLM_PROVIDER)"}`);
    console.log(`  Skills: ${skillRegistry.list().map((s) => s.name).join(", ")}\n`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
