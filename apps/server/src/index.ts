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
  DbMonitor,
  UpdateChecker,
  ConfigurationManager,
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
  createYieldFinderSkill,
  LimitOrderManager,
  createLimitOrderSkill,
  WhaleWatchEngine,
  createWhaleWatchSkill,
  SnipeManager,
  createSnipeSkill,
  createAirdropTrackerSkill,
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
import { shutdownStep } from "./shutdown.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

async function main(): Promise<void> {
  // ─── Load config ──────────────────────────────────────────
  const config = loadConfig();
  const configManager = new ConfigurationManager(config);
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
  const dbPath = `${config.dataDir}/chainclaw.sqlite`;
  const dbMonitor = new DbMonitor(dbPath, { maxSizeMb: config.dbMaxSizeMb, pruneEnabled: config.dbPruneEnabled });
  dbMonitor.start(db);

  // ─── Update checker ─────────────────────────────────────
  const pkgJson = JSON.parse(readFileSync(resolve("package.json"), "utf-8")) as { version?: string };
  const updateChecker = new UpdateChecker({ currentVersion: pkgJson.version ?? "0.0.0" });
  updateChecker.start();

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
  skillRegistry.configureLanes();
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

  // ─── Tier 1 skills ──────────────────────────────────────────
  skillRegistry.register(createYieldFinderSkill());
  const limitOrderManager = new LimitOrderManager(db);
  skillRegistry.register(createLimitOrderSkill(limitOrderManager, walletManager));
  const whaleWatchEngine = new WhaleWatchEngine(db, rpcOverrides);
  skillRegistry.register(createWhaleWatchSkill(whaleWatchEngine));
  const snipeManager = new SnipeManager(db);
  skillRegistry.register(createSnipeSkill(snipeManager, executor.getRiskEngine()));
  skillRegistry.register(createAirdropTrackerSkill(chainManager, rpcOverrides));

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

  // ─── Config admin skill ─────────────────────────────────
  skillRegistry.register({
    name: "config",
    description: "View or update bot configuration (admin only)",
    parameters: z.object({
      action: z.enum(["view", "set", "apply", "discard", "diff"]),
      key: z.string().optional(),
      value: z.string().optional(),
    }),
    async execute(params: unknown, context) {
      // Admin-only: config management requires allowlist mode with the user on the list
      if (config.securityMode !== "allowlist" || !securityGuard.isAllowed(context.userId)) {
        return { success: false, message: "Permission denied. Config management requires allowlist mode." };
      }

      const { action, key, value } = z.object({
        action: z.enum(["view", "set", "apply", "discard", "diff"]),
        key: z.string().optional(),
        value: z.string().optional(),
      }).parse(params);

      if (action === "view") {
        const view = configManager.getRedactedView();
        const lines = Object.entries(view)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join("\n");
        return { success: true, message: `Current config:\n${lines}` };
      }

      if (action === "set") {
        if (!key) return { success: false, message: "Missing key. Usage: config set <key> <value>" };
        if (value === undefined) return { success: false, message: "Missing value. Usage: config set <key> <value>" };
        try {
          // Parse value: try JSON first, fall back to string
          let parsed: unknown = value;
          try { parsed = JSON.parse(value); } catch { /* use raw string */ }
          configManager.edit(key as any, parsed as any);
          return { success: true, message: `Staged: ${key} = ${JSON.stringify(parsed)}\nRun 'config apply' to commit.` };
        } catch (err) {
          return { success: false, message: err instanceof Error ? err.message : "Unknown error" };
        }
      }

      if (action === "apply") {
        try {
          const result = configManager.apply();
          const parts: string[] = [];
          if (result.applied.length > 0) parts.push(`Applied (live): ${result.applied.join(", ")}`);
          if (result.needsRestart.length > 0) parts.push(`Needs restart: ${result.needsRestart.join(", ")}`);
          if (parts.length === 0) parts.push("No pending changes.");
          return { success: true, message: parts.join("\n") };
        } catch (err) {
          return { success: false, message: err instanceof Error ? err.message : "Validation failed" };
        }
      }

      if (action === "discard") {
        configManager.discard();
        return { success: true, message: "All pending changes discarded." };
      }

      if (action === "diff") {
        const diffs = configManager.diff();
        if (diffs.length === 0) return { success: true, message: "No changes from startup config." };
        const lines = diffs.map((d) => `${d.key}: ${JSON.stringify(d.from)} → ${JSON.stringify(d.to)}`).join("\n");
        return { success: true, message: `Changes from startup:\n${lines}` };
      }

      return { success: false, message: "Unknown action" };
    },
  });

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
    if (!skillRegistry.has(job.skillName)) {
      return { ok: false, error: `Skill not found: ${job.skillName}` };
    }
    try {
      const defaultAddr = walletManager.getDefaultAddress();
      const result = await skillRegistry.executeSkill(job.skillName, job.skillParams, {
        userId: job.userId,
        walletAddress: defaultAddr ?? null,
        chainIds: job.chainId ? [job.chainId] : chainManager.getSupportedChains(),
        sendReply: async () => { /* cron jobs don't have a reply channel */ },
      });
      return result.success ? { ok: true } : { ok: false, error: result.message };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  });
  cronService.start();

  // Start background services
  dcaScheduler.start();
  whaleWatchEngine.start();

  // ─── Register and start channels ──────────────────────────
  const channelRegistry = new ChannelRegistry();

  if (config.telegramBotToken) {
    const telegram = new TelegramAdapter(config.telegramBotToken);
    // Wire alert notifications through delivery queue for persistence
    alertEngine.setNotifier(async (userId, message) => {
      const id = deliveryQueue.enqueue({ channel: "telegram", recipientId: userId, message });
      try {
        await telegram.notify(userId, message);
        deliveryQueue.ack(id);
      } catch (err) {
        deliveryQueue.fail(id, err instanceof Error ? err.message : "Unknown error");
        logger.warn({ err, userId, deliveryId: id }, "Alert delivery failed, queued for retry");
      }
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
    const adapter = channelRegistry.get(payload.channel);
    if (!adapter) {
      throw new Error(`No adapter for channel: ${payload.channel}`);
    }
    const notifiable = adapter as unknown as { notify?: (userId: string, message: string) => Promise<void> };
    if (typeof notifiable.notify === "function") {
      await notifiable.notify(payload.recipientId, payload.message);
    } else {
      throw new Error(`Channel ${payload.channel} does not support push delivery`);
    }
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
    dbMonitor,
    updateChecker,
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

    // Force exit after global timeout
    const forceTimer = setTimeout(() => {
      logger.error("Shutdown timed out — forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    // Emit lifecycle hook (fire-and-forget)
    void triggerHook(createHookEvent("lifecycle", "shutdown", { signal }));

    const S = 5; // total shutdown steps

    // 1. Drain command queue
    await shutdownStep(1, S, "Draining command queue", async () => {
      const { drained } = await waitForDrain(10_000);
      if (!drained) logger.warn("Command queue did not drain in time");
    }, 10_000, shutdownStart);

    // 2. Stop background services
    await shutdownStep(2, S, "Stopping background services", () => {
      agentRunner.stopAll();
      cronService.stop();
      alertEngine.stop();
      dcaScheduler.stop();
      whaleWatchEngine.stop();
      dbMonitor.stop();
      updateChecker.stop();
      for (const h of pluginHandles) h.stop();
    }, 5_000, shutdownStart);

    // 3. Stop channel adapters
    await shutdownStep(3, S, "Stopping channels", () => channelRegistry.stopAll(), 5_000, shutdownStart);

    // 4. Stop monitoring + health
    await shutdownStep(4, S, "Stopping monitoring", () => {
      healthMonitor.stop();
      healthServer.close();
    }, 2_000, shutdownStart);

    // 5. Close DB + release lock
    await shutdownStep(5, S, "Closing database", () => {
      processLock?.release();
      closeDatabase();
    }, 2_000, shutdownStart);

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
