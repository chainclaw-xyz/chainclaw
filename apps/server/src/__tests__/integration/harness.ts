/**
 * Integration test harness.
 * Mirrors the production boot sequence (index.ts lines 48-141)
 * with real internal components and mocked external boundaries.
 */
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Must be imported after vi.mock() calls in test files
import { CommandRouter } from "@chainclaw/gateway";
import { WalletManager } from "@chainclaw/wallet";
import { ChainManager } from "@chainclaw/chains";
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
import { AgentRuntime } from "@chainclaw/agent";
import { TransactionExecutor } from "@chainclaw/pipeline";
import {
  HistoricalDataProvider,
  PerformanceTracker,
  BacktestEngine,
  AgentRunner,
  createSampleDcaAgent,
  type AgentDefinition,
} from "@chainclaw/agent-sdk";

import type { GatewayDeps } from "@chainclaw/gateway";
import { FetchRouter } from "./mocks/fetch-router.js";
import { MockLLMProvider } from "./mocks/mock-llm.js";
import { type MockAdapterControls } from "./mocks/mock-chain-adapter.js";

export interface TestHarness {
  // Core components
  db: Database.Database;
  router: CommandRouter;
  skillRegistry: SkillRegistry;
  walletManager: WalletManager;
  chainManager: ChainManager;
  executor: TransactionExecutor;

  // Background services (NOT started — call methods directly)
  dcaScheduler: DcaScheduler;
  alertEngine: AlertEngine;

  // Agent components
  agentRuntime: AgentRuntime | undefined;
  agentRunner: AgentRunner;
  performanceTracker: PerformanceTracker;
  backtestEngine: BacktestEngine;

  // Mock controls
  fetchRouter: FetchRouter;
  mockLLM: MockLLMProvider;
  adapterControls: MockAdapterControls;

  // Lifecycle
  cleanup(): void;
}

/**
 * Run the database migrations that would normally happen across
 * multiple constructors during the production boot sequence.
 */
function runCoreMigrations(db: Database.Database): void {
  // From packages/agent/src/memory/database.ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(user_id, created_at);

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      default_chain_id INTEGER DEFAULT 1,
      slippage_tolerance REAL DEFAULT 1.0,
      confirmation_threshold REAL DEFAULT 100.0,
      max_tx_per_day INTEGER DEFAULT 50,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export interface HarnessOptions {
  /** Whether to create an AgentRuntime with MockLLM (default: true) */
  withAgentRuntime?: boolean;
  /** Custom adapter controls (if you need to set up before harness creation) */
  adapterControls?: MockAdapterControls;
}

export function createTestHarness(options: HarnessOptions = {}): TestHarness {
  const { withAgentRuntime = true } = options;

  // ─── 1. In-memory SQLite with core migrations ──────────────
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runCoreMigrations(db);

  // ─── 2. Wallet manager with temp directory ──────────────────
  const tmpDir = mkdtempSync(join(tmpdir(), "chainclaw-test-"));
  const walletManager = new WalletManager(tmpDir, "test-password-12345");

  // ─── 3. Fetch router ─────────────────────────────────────────
  const fetchRouter = new FetchRouter();

  // ─── 4. Chain manager (uses mocked adapters via vi.mock) ────
  const fakeConfig = {
    ethRpcUrl: "https://eth.test.local",
    baseRpcUrl: "https://base.test.local",
    arbitrumRpcUrl: "https://arb.test.local",
    optimismRpcUrl: "https://op.test.local",
    polygonRpcUrl: "https://polygon.test.local",
    bscRpcUrl: "https://bsc.test.local",
    avalancheRpcUrl: "https://avax.test.local",
    zkSyncRpcUrl: "https://zksync.test.local",
    scrollRpcUrl: "https://scroll.test.local",
    blastRpcUrl: "https://blast.test.local",
    gnosisRpcUrl: "https://gnosis.test.local",
    lineaRpcUrl: "https://linea.test.local",
    fantomRpcUrl: "https://fantom.test.local",
    mantleRpcUrl: "https://mantle.test.local",
    solanaRpcUrl: undefined,
  } as any;
  const chainManager = new ChainManager(fakeConfig);

  // ─── 5. Transaction executor (no Tenderly — uses estimateOnly) ──
  const rpcOverrides: Record<number, string> = {
    1: "https://eth.test.local",
    8453: "https://base.test.local",
    42161: "https://arb.test.local",
    10: "https://op.test.local",
    137: "https://polygon.test.local",
    56: "https://bsc.test.local",
    43114: "https://avax.test.local",
    324: "https://zksync.test.local",
    534352: "https://scroll.test.local",
    81457: "https://blast.test.local",
    100: "https://gnosis.test.local",
    59144: "https://linea.test.local",
    250: "https://fantom.test.local",
    5000: "https://mantle.test.local",
  };
  const executor = new TransactionExecutor(
    db,
    { tenderlyApiKey: undefined, tenderlyAccount: undefined, tenderlyProject: undefined },
    rpcOverrides,
  );

  // ─── 6. Register all 12 core skills ─────────────────────────
  const skillRegistry = new SkillRegistry();
  skillRegistry.register(createBalanceSkill(chainManager));
  skillRegistry.register(createSwapSkill(executor, walletManager));
  skillRegistry.register(createBridgeSkill(executor, walletManager));
  skillRegistry.register(createLendSkill(executor, walletManager, rpcOverrides));

  const dcaScheduler = new DcaScheduler(db, executor, walletManager);
  skillRegistry.register(createDcaSkill(dcaScheduler));

  const alertEngine = new AlertEngine(db);
  skillRegistry.register(createAlertSkill(alertEngine));

  skillRegistry.register(createWorkflowSkill(skillRegistry));
  skillRegistry.register(createPortfolioSkill(chainManager));
  skillRegistry.register(createRiskCheckSkill(executor.getRiskEngine()));
  skillRegistry.register(createHistorySkill(executor.getTransactionLog()));

  // ─── 7. Agent SDK ─────────────────────────────────────────────
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

  // ─── 8. Agent runtime (optional) ───────────────────────────────
  const mockLLM = new MockLLMProvider();
  let agentRuntime: AgentRuntime | undefined;

  if (withAgentRuntime) {
    agentRuntime = new AgentRuntime(mockLLM, db, skillRegistry);
  }

  // ─── 9. Command router ───────────────────────────────────────
  const gatewayDeps: GatewayDeps = {
    walletManager,
    chainManager,
    skillRegistry,
    agentRuntime,
  };
  const router = new CommandRouter(gatewayDeps);

  // ─── Adapter controls placeholder ────────────────────────────
  // The actual adapter controls are set up via vi.mock() in the test file.
  // We pass them through options if needed.
  const adapterControls = options.adapterControls ?? ({} as MockAdapterControls);

  return {
    db,
    router,
    skillRegistry,
    walletManager,
    chainManager,
    executor,
    dcaScheduler,
    alertEngine,
    agentRuntime,
    agentRunner,
    performanceTracker,
    backtestEngine,
    fetchRouter,
    mockLLM,
    adapterControls,
    cleanup() {
      agentRunner.stopAll();
      alertEngine.stop();
      dcaScheduler.stop();
      db.close();
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}
