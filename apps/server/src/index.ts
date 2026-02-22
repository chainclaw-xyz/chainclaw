import {
  loadConfig,
  createLogger,
  getLogger,
  triggerHook,
  createHookEvent,
  installUnhandledRejectionHandler,
  acquireProcessLock,
  waitForDrain,
  DiagnosticCollector,
  type ProcessLockHandle,
} from "@chainclaw/core";
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
import { createLLMProvider, getDatabase, AgentRuntime, closeDatabase, createEmbeddingProvider } from "@chainclaw/agent";
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
  ChannelRegistry,
  TelegramAdapter,
  DiscordAdapter,
  WebAdapter,
  SlackAdapter,
  WhatsAppAdapter,
  ChannelHealthMonitor,
  SecurityGuard,
  DeliveryQueue,
  type GatewayDeps,
} from "@chainclaw/gateway";
import { CronService } from "@chainclaw/cron";
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

  // ─── Process safety ────────────────────────────────────────
  installUnhandledRejectionHandler();

  let processLock: ProcessLockHandle | undefined;
  try {
    processLock = acquireProcessLock(config.dataDir, { label: "chainclaw-server" });
  } catch (err) {
    logger.error({ err }, "Could not acquire process lock — another instance may be running");
    process.exit(1);
  }

  // ─── Diagnostics ───────────────────────────────────────────
  const diagnosticCollector = new DiagnosticCollector();

  // Ensure at least one channel is configured
  if (!config.telegramBotToken && !config.discordBotToken && !config.webChatEnabled && !config.slackBotToken && !config.whatsappEnabled) {
    throw new Error(
      "No channels configured. Set at least one of: TELEGRAM_BOT_TOKEN, DISCORD_BOT_TOKEN, WEB_CHAT_ENABLED=true, SLACK_BOT_TOKEN, WHATSAPP_ENABLED=true",
    );
  }

  // ─── Initialize components ────────────────────────────────
  const chainManager = new ChainManager(config);
  const walletManager = new WalletManager(config.walletDir, config.walletPassword);
  const db = getDatabase(config.dataDir);
  const deliveryQueue = new DeliveryQueue(db);

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
    const embeddingProvider = createEmbeddingProvider({
      openaiApiKey: config.embeddingApiKey,
      embeddingModel: config.embeddingModel,
    });
    agentRuntime = new AgentRuntime(llm, db, skillRegistry, embeddingProvider);
    logger.info({ provider: config.llmProvider, semanticMemory: !!embeddingProvider }, "Agent runtime initialized");
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

  // ─── Security guard ─────────────────────────────────────
  const securityGuard = new SecurityGuard({
    mode: config.securityMode,
    allowlist: config.securityAllowlist,
  });

  if (config.securityMode === "allowlist") {
    logger.info(
      { entries: config.securityAllowlist.length },
      "Security: allowlist mode enabled",
    );
  }

  // ─── Shared gateway deps ──────────────────────────────────
  const gatewayDeps: GatewayDeps = {
    walletManager,
    chainManager,
    skillRegistry,
    agentRuntime,
    securityGuard,
  };

  // ─── Cron scheduler ─────────────────────────────────────
  const cronService = new CronService(db, async (job) => {
    const skill = skillRegistry.get(job.skillName);
    if (!skill) {
      return { ok: false, error: `Skill not found: ${job.skillName}` };
    }
    try {
      const defaultAddr = walletManager.getDefaultAddress();
      await skill.execute(job.skillParams, {
        userId: job.userId,
        walletAddress: defaultAddr ?? null,
        chainIds: job.chainId ? [job.chainId] : chainManager.getSupportedChains(),
        sendReply: async () => { /* cron jobs don't have a reply channel */ },
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  });
  cronService.start();

  // Start background services
  dcaScheduler.start();

  // ─── Register and start channels ──────────────────────────
  const channelRegistry = new ChannelRegistry();

  if (config.telegramBotToken) {
    const telegram = new TelegramAdapter(config.telegramBotToken);
    // Wire alert notifications directly via the Telegram Bot API
    alertEngine.setNotifier(async (userId, message) => {
      await telegram.notify(userId, message);
    });
    channelRegistry.register(telegram);
  }

  if (config.discordBotToken && config.discordClientId) {
    channelRegistry.register(new DiscordAdapter(config.discordBotToken, config.discordClientId));
  }

  if (config.slackBotToken && config.slackAppToken) {
    channelRegistry.register(new SlackAdapter(config.slackBotToken, config.slackAppToken));
  }

  if (config.whatsappEnabled) {
    channelRegistry.register(new WhatsAppAdapter(config.whatsappAuthDir));
  }

  if (config.webChatEnabled) {
    channelRegistry.register(new WebAdapter({ port: config.webChatPort }));
  }

  const startedChannels = await channelRegistry.startAll(gatewayDeps);

  alertEngine.start();

  // ─── Channel health monitoring ─────────────────────────
  const healthMonitor = new ChannelHealthMonitor(channelRegistry);
  healthMonitor.start();

  // ─── Recover pending deliveries ──────────────────────────
  deliveryQueue.recoverPending(async (payload) => {
    logger.info({ channel: payload.channel, recipientId: payload.recipientId }, "Recovering delivery");
    // Best-effort recovery — actual channel delivery would go here
  }).catch((err) => {
    logger.warn({ err }, "Delivery queue recovery failed");
  });

  // ─── Health check server ────────────────────────────────
  const healthServer = createHealthServer(config.healthCheckPort, {
    skillRegistry,
    agentRuntime,
    channels: startedChannels,
    startedAt: Date.now(),
    healthMonitor,
    diagnosticCollector,
  }, "0.0.0.0");

  // ─── Graceful shutdown ────────────────────────────────────
  let isShuttingDown = false;
  const SHUTDOWN_TIMEOUT_MS = 30_000;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn("Shutdown already in progress, ignoring duplicate signal");
      return;
    }
    isShuttingDown = true;

    logger.info({ signal }, "Shutting down...");
    const shutdownStart = Date.now();

    // Force exit after timeout
    const forceTimer = setTimeout(() => {
      logger.error("Shutdown timed out — forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    // Emit lifecycle hook
    void triggerHook(createHookEvent("lifecycle", "shutdown", { signal }));

    // 1. Wait for active command queue tasks to drain
    const { drained } = await waitForDrain(10_000);
    if (!drained) {
      logger.warn("Command queue did not drain within 10s — proceeding with shutdown");
    }

    // 2. Stop background services
    agentRunner.stopAll();
    cronService.stop();
    alertEngine.stop();
    dcaScheduler.stop();
    for (const h of pluginHandles) h.stop();

    // 3. Stop channels
    await channelRegistry.stopAll();

    // 4. Stop monitoring + health
    healthMonitor.stop();
    healthServer.close();

    // 5. Release process lock + close DB
    processLock?.release();
    closeDatabase();

    const elapsed = Date.now() - shutdownStart;
    logger.info({ elapsedMs: elapsed }, "Shutdown complete");
    clearTimeout(forceTimer);
    process.exit(0);
  };

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  process.on("SIGINT", () => shutdown("SIGINT"));
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // ─── Log startup ──────────────────────────────────────────
  logger.info({ channels: startedChannels, nlEnabled: !!agentRuntime }, "ChainClaw is running!");
  console.log(`\n  ChainClaw is running!`);
  console.log(`  Channels: ${startedChannels.join(", ")}`);
  console.log(`  NL mode: ${agentRuntime ? "enabled" : "disabled (set LLM_PROVIDER)"}`);
  console.log(`  Skills: ${skillRegistry.list().map((s) => s.name).join(", ")}\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
