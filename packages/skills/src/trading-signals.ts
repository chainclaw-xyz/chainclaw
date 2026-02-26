import { z } from "zod";
import type Database from "better-sqlite3";
import { getLogger, fetchWithRetry, type SkillResult } from "@chainclaw/core";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";

const logger = getLogger("skill-trading-signals");

const tradingSignalsParams = z.object({
  action: z.enum([
    "publish",
    "close",
    "feed",
    "subscribe",
    "unsubscribe",
    "leaderboard",
    "my-signals",
    "my-subscriptions",
    "providers",
  ]),
  // Publish params
  token: z.string().optional(),
  chainId: z.number().optional().default(1),
  entryPrice: z.number().positive("Entry price must be greater than zero").optional(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Must be a valid tx hash").optional(),
  collateralUsd: z.number().optional(),
  leverage: z.number().min(1).max(100).optional().default(1),
  confidence: z.number().min(0).max(1).optional(),
  reasoning: z.string().max(500).optional(),
  signalAction: z.enum(["buy", "sell"]).optional(),
  // Close params
  signalId: z.number().optional(),
  exitPrice: z.number().optional(),
  exitTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Must be a valid tx hash").optional(),
  // Subscribe params
  providerId: z.string().optional(),
  autoCopy: z.boolean().optional().default(false),
  copyAmountUsd: z.number().optional(),
  maxDailyTrades: z.number().min(1).max(50).optional().default(5),
  // Feed/leaderboard params
  limit: z.number().min(1).max(100).optional().default(20),
  offset: z.number().min(0).optional().default(0),
  filterToken: z.string().optional(),
  filterProvider: z.string().optional(),
  // Providers search
  query: z.string().optional(),
});

// ─── DB Row Interfaces ────────────────────────────────────────

interface ProviderRow {
  user_id: string;
  display_name: string;
  total_signals: number;
  wins: number;
  losses: number;
  avg_return_pct: number;
  created_at: string;
}

interface SignalRow {
  id: number;
  provider_id: string;
  action: string;
  token: string;
  chain_id: number;
  entry_price: number;
  exit_price: number | null;
  tx_hash: string;
  exit_tx_hash: string | null;
  collateral_usd: number;
  leverage: number;
  confidence: number | null;
  reasoning: string | null;
  status: string;
  pnl_pct: number | null;
  verified_onchain: number;
  created_at: string;
  closed_at: string | null;
}

interface SubscriptionRow {
  id: number;
  user_id: string;
  provider_id: string;
  auto_copy: number;
  copy_amount_usd: number | null;
  max_daily_trades: number;
  status: string;
  created_at: string;
}

// ─── Blockscout API Types ─────────────────────────────────────

interface BlockscoutTokenTransfer {
  from: { hash: string };
  to: { hash: string };
  token: { address: string; symbol: string; decimals: string; type: string };
  total: { value: string; decimals: string };
}

// Known stablecoins for USD price extraction
const QUOTE_TOKENS = new Set([
  "usdc", "usdt", "dai", "usdbc", "busd", "tusd", "frax",
]);

// Blockscout API base URLs per chain
const BLOCKSCOUT_URLS: Record<number, string> = {
  1: "https://eth.blockscout.com",
  8453: "https://base.blockscout.com",
  42161: "https://arbitrum.blockscout.com",
  10: "https://optimism.blockscout.com",
};

// ─── Trading Signals Engine ───────────────────────────────────

export type SignalNotifier = (userId: string, message: string) => Promise<void>;

export class TradingSignalsEngine {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private initialTimeout: ReturnType<typeof setTimeout> | null = null;
  private notifier: SignalNotifier | null = null;
  private lastNotifiedSignalId = 0;
  private lastNotifiedCloseTime: string | null = null;

  constructor(
    private db: Database.Database,
    private rpcOverrides: Record<number, string>,
  ) {
    this.initTable();
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS signal_providers (
        user_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        total_signals INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        avg_return_pct REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('buy', 'sell')),
        token TEXT NOT NULL,
        chain_id INTEGER NOT NULL DEFAULT 1,
        entry_price REAL NOT NULL,
        exit_price REAL,
        tx_hash TEXT NOT NULL,
        exit_tx_hash TEXT,
        collateral_usd REAL NOT NULL,
        leverage REAL NOT NULL DEFAULT 1,
        confidence REAL,
        reasoning TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed', 'expired')),
        pnl_pct REAL,
        verified_onchain INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        closed_at TEXT,
        FOREIGN KEY (provider_id) REFERENCES signal_providers(user_id),
        UNIQUE(provider_id, tx_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_signals_provider ON signals(provider_id);
      CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
      CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);
      CREATE INDEX IF NOT EXISTS idx_signals_token ON signals(token);

      CREATE TABLE IF NOT EXISTS signal_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        auto_copy INTEGER NOT NULL DEFAULT 0,
        copy_amount_usd REAL,
        max_daily_trades INTEGER NOT NULL DEFAULT 5,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'cancelled')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, provider_id)
      );

      CREATE INDEX IF NOT EXISTS idx_signal_subs_user ON signal_subscriptions(user_id);
      CREATE INDEX IF NOT EXISTS idx_signal_subs_provider ON signal_subscriptions(provider_id);
    `);

    // Track the last signal ID for notification polling
    const last = this.db.prepare("SELECT MAX(id) as max_id FROM signals").get() as { max_id: number | null } | undefined;
    this.lastNotifiedSignalId = last?.max_id ?? 0;

    // Track the last close time for close notifications
    const lastClose = this.db.prepare(
      "SELECT MAX(closed_at) as last_closed FROM signals WHERE status = 'closed'",
    ).get() as { last_closed: string | null } | undefined;
    this.lastNotifiedCloseTime = lastClose?.last_closed ?? null;

    logger.debug("Trading signals tables initialized");
  }

  // ─── Provider Management ──────────────────────────────────────

  upsertProvider(userId: string, displayName: string): void {
    this.db.prepare(`
      INSERT INTO signal_providers (user_id, display_name)
      VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name
    `).run(userId, displayName);
  }

  getProvider(userId: string): ProviderRow | null {
    return this.db.prepare(
      "SELECT * FROM signal_providers WHERE user_id = ?",
    ).get(userId) as ProviderRow | null;
  }

  searchProviders(query?: string, limit = 20, offset = 0): ProviderRow[] {
    if (query) {
      return this.db.prepare(
        "SELECT * FROM signal_providers WHERE display_name LIKE ? ORDER BY total_signals DESC LIMIT ? OFFSET ?",
      ).all(`%${query}%`, limit, offset) as ProviderRow[];
    }
    return this.db.prepare(
      "SELECT * FROM signal_providers ORDER BY total_signals DESC LIMIT ? OFFSET ?",
    ).all(limit, offset) as ProviderRow[];
  }

  getLeaderboard(limit = 20, offset = 0): ProviderRow[] {
    return this.db.prepare(`
      SELECT * FROM signal_providers
      WHERE total_signals >= 5
      ORDER BY avg_return_pct DESC, wins DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as ProviderRow[];
  }

  private updateProviderStats(providerId: string): void {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN pnl_pct <= 0 THEN 1 ELSE 0 END) as losses,
        AVG(pnl_pct) as avg_return
      FROM signals
      WHERE provider_id = ? AND status = 'closed'
    `).get(providerId) as { total: number; wins: number; losses: number; avg_return: number | null };

    this.db.prepare(`
      UPDATE signal_providers
      SET total_signals = ?, wins = ?, losses = ?, avg_return_pct = ?
      WHERE user_id = ?
    `).run(stats.total, stats.wins, stats.losses, stats.avg_return ?? 0, providerId);
  }

  // ─── Signal CRUD ──────────────────────────────────────────────

  publishSignal(
    providerId: string,
    action: string,
    token: string,
    chainId: number,
    entryPrice: number,
    txHash: string,
    collateralUsd: number,
    leverage: number,
    confidence: number | null,
    reasoning: string | null,
    verifiedOnchain: boolean,
  ): number {
    const result = this.db.prepare(`
      INSERT INTO signals (provider_id, action, token, chain_id, entry_price, tx_hash, collateral_usd, leverage, confidence, reasoning, verified_onchain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      providerId,
      action,
      token.toUpperCase(),
      chainId,
      entryPrice,
      txHash,
      collateralUsd,
      leverage,
      confidence,
      reasoning,
      verifiedOnchain ? 1 : 0,
    );
    return Number(result.lastInsertRowid);
  }

  closeSignal(
    signalId: number,
    providerId: string,
    exitPrice: number,
    exitTxHash: string | null,
  ): { success: boolean; pnlPct: number | null } {
    const signal = this.db.prepare(
      "SELECT * FROM signals WHERE id = ? AND provider_id = ? AND status = 'open'",
    ).get(signalId, providerId) as SignalRow | null;

    if (!signal) return { success: false, pnlPct: null };

    // Calculate PnL based on action direction
    let pnlPct: number;
    if (signal.action === "buy") {
      pnlPct = ((exitPrice - signal.entry_price) / signal.entry_price) * 100 * signal.leverage;
    } else {
      pnlPct = ((signal.entry_price - exitPrice) / signal.entry_price) * 100 * signal.leverage;
    }

    this.db.prepare(`
      UPDATE signals
      SET status = 'closed', exit_price = ?, exit_tx_hash = ?, pnl_pct = ?, closed_at = datetime('now')
      WHERE id = ?
    `).run(exitPrice, exitTxHash, pnlPct, signalId);

    this.updateProviderStats(providerId);

    return { success: true, pnlPct };
  }

  getSignal(signalId: number): SignalRow | null {
    return this.db.prepare("SELECT * FROM signals WHERE id = ?").get(signalId) as SignalRow | null;
  }

  getUserSignals(userId: string, limit = 20, offset = 0): SignalRow[] {
    return this.db.prepare(
      "SELECT * FROM signals WHERE provider_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    ).all(userId, limit, offset) as SignalRow[];
  }

  getSignalFeed(
    limit = 20,
    offset = 0,
    filterToken?: string,
    filterProvider?: string,
  ): SignalRow[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filterToken) {
      conditions.push("token = ?");
      params.push(filterToken.toUpperCase());
    }
    if (filterProvider) {
      conditions.push("provider_id = ?");
      params.push(filterProvider);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit, offset);

    return this.db.prepare(
      `SELECT * FROM signals ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ).all(...params) as SignalRow[];
  }

  // ─── Subscriptions ────────────────────────────────────────────

  subscribe(
    userId: string,
    providerId: string,
    autoCopy: boolean,
    copyAmountUsd: number | null,
    maxDailyTrades: number,
  ): number {
    // Ensure provider exists
    const provider = this.getProvider(providerId);
    if (!provider) throw new Error("Provider not found");

    // Can't subscribe to yourself
    if (userId === providerId) throw new Error("Cannot subscribe to yourself");

    const result = this.db.prepare(`
      INSERT INTO signal_subscriptions (user_id, provider_id, auto_copy, copy_amount_usd, max_daily_trades)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, provider_id) DO UPDATE SET
        auto_copy = excluded.auto_copy,
        copy_amount_usd = excluded.copy_amount_usd,
        max_daily_trades = excluded.max_daily_trades,
        status = 'active'
    `).run(userId, providerId, autoCopy ? 1 : 0, copyAmountUsd, maxDailyTrades);
    return Number(result.lastInsertRowid);
  }

  unsubscribe(userId: string, providerId: string): boolean {
    const result = this.db.prepare(
      "UPDATE signal_subscriptions SET status = 'cancelled' WHERE user_id = ? AND provider_id = ? AND status = 'active'",
    ).run(userId, providerId);
    return result.changes > 0;
  }

  getUserSubscriptions(userId: string): SubscriptionRow[] {
    return this.db.prepare(
      "SELECT * FROM signal_subscriptions WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC",
    ).all(userId) as SubscriptionRow[];
  }

  getProviderSubscribers(providerId: string): SubscriptionRow[] {
    return this.db.prepare(
      "SELECT * FROM signal_subscriptions WHERE provider_id = ? AND status = 'active'",
    ).all(providerId) as SubscriptionRow[];
  }

  // ─── TX Verification ──────────────────────────────────────────

  async verifyTxOnChain(
    txHash: string,
    chainId: number,
    walletAddress: string,
  ): Promise<{ verified: boolean; extractedPrice: number | null }> {
    const rpcUrl = this.rpcOverrides[chainId];
    if (!rpcUrl) {
      logger.warn({ chainId }, "No RPC URL configured for chain");
      return { verified: false, extractedPrice: null };
    }

    try {
      // Step 1: Fetch transaction receipt
      const receiptRes = await fetchWithRetry(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getTransactionReceipt",
          params: [txHash],
        }),
      });

      if (!receiptRes.ok) {
        logger.warn({ status: receiptRes.status }, "RPC receipt request failed");
        return { verified: false, extractedPrice: null };
      }

      const receiptData = (await receiptRes.json()) as {
        result: { status: string; from: string; to: string; logs: Array<{ topics: string[]; data: string }> } | null;
      };

      if (!receiptData.result) {
        logger.warn({ txHash }, "Transaction not found");
        return { verified: false, extractedPrice: null };
      }

      const receipt = receiptData.result;

      // Step 2: Verify TX was successful
      if (receipt.status !== "0x1") {
        logger.warn({ txHash }, "Transaction failed on-chain");
        return { verified: false, extractedPrice: null };
      }

      // Step 3: Verify wallet association
      const walletLower = walletAddress.toLowerCase();
      const txFrom = receipt.from.toLowerCase();

      let walletLinked = txFrom === walletLower;

      if (!walletLinked) {
        // Check event logs for wallet address
        for (const log of receipt.logs) {
          for (const topic of log.topics) {
            if (topic.toLowerCase().includes(walletLower.slice(2))) {
              walletLinked = true;
              break;
            }
          }
          if (!walletLinked && log.data.toLowerCase().includes(walletLower.slice(2))) {
            walletLinked = true;
          }
          if (walletLinked) break;
        }
      }

      if (!walletLinked) {
        logger.warn({ txHash, walletAddress }, "Wallet not found in transaction");
        return { verified: false, extractedPrice: null };
      }

      // Step 4: Try to extract entry price via Blockscout
      const extractedPrice = await this.extractPriceFromTx(txHash, chainId);

      return { verified: true, extractedPrice };
    } catch (err) {
      logger.error({ err, txHash }, "TX verification error");
      return { verified: false, extractedPrice: null };
    }
  }

  private async extractPriceFromTx(txHash: string, chainId: number): Promise<number | null> {
    const blockscoutBase = BLOCKSCOUT_URLS[chainId];
    if (!blockscoutBase) return null;

    try {
      const res = await fetchWithRetry(
        `${blockscoutBase}/api/v2/transactions/${txHash}/token-transfers`,
      );

      if (!res.ok) return null;

      const data = (await res.json()) as { items: BlockscoutTokenTransfer[] };
      if (!data.items || data.items.length === 0) return null;

      // Find quote token transfer (stablecoin sent)
      let quoteAmount = 0;
      let targetAmount = 0;

      for (const transfer of data.items) {
        const symbol = transfer.token.symbol.toLowerCase();
        const decimals = parseInt(transfer.total.decimals || transfer.token.decimals, 10);
        const amount = Number(transfer.total.value) / 10 ** decimals;

        if (QUOTE_TOKENS.has(symbol)) {
          quoteAmount += amount;
        } else {
          targetAmount += amount;
        }
      }

      if (quoteAmount > 0 && targetAmount > 0) {
        return quoteAmount / targetAmount;
      }

      return null;
    } catch (err) {
      logger.debug({ err, txHash }, "Price extraction failed");
      return null;
    }
  }

  // ─── Background Polling ───────────────────────────────────────

  setNotifier(notifier: SignalNotifier): void {
    this.notifier = notifier;
  }

  start(pollIntervalMs = 60_000): void {
    if (this.pollInterval) return;
    logger.info({ pollIntervalMs }, "Trading signals engine started");

    this.initialTimeout = setTimeout(() => {
      this.initialTimeout = null;
      this.pollNewSignals().catch((err) => logger.error({ err }, "Signal poll error"));
    }, 10_000);

    this.pollInterval = setInterval(() => {
      this.pollNewSignals().catch((err) => logger.error({ err }, "Signal poll error"));
      this.expireOldSignals();
    }, pollIntervalMs);
  }

  stop(): void {
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    logger.info("Trading signals engine stopped");
  }

  private async pollNewSignals(): Promise<void> {
    if (!this.notifier) return;

    // 1. Notify about new signals
    const newSignals = this.db.prepare(
      "SELECT * FROM signals WHERE id > ? ORDER BY id ASC",
    ).all(this.lastNotifiedSignalId) as SignalRow[];

    for (const signal of newSignals) {
      this.lastNotifiedSignalId = signal.id;

      const subscribers = this.getProviderSubscribers(signal.provider_id);
      if (subscribers.length === 0) continue;

      const provider = this.getProvider(signal.provider_id);
      const providerName = provider?.display_name ?? signal.provider_id.slice(0, 8);
      const verifiedTag = signal.verified_onchain ? " [Verified]" : "";
      const confidenceTag = signal.confidence ? ` (${Math.round(signal.confidence * 100)}% conf)` : "";

      const message =
        `*New Signal${verifiedTag}*\n` +
        `Provider: ${providerName}\n` +
        `${signal.action.toUpperCase()} ${signal.token} on chain ${signal.chain_id}\n` +
        `Entry: $${signal.entry_price.toFixed(6)}${confidenceTag}\n` +
        `Collateral: $${signal.collateral_usd.toFixed(2)}` +
        (signal.leverage > 1 ? ` (${signal.leverage}x leverage)` : "") +
        (signal.reasoning ? `\n_${signal.reasoning}_` : "");

      for (const sub of subscribers) {
        try {
          await this.notifier(sub.user_id, message);
        } catch (err) {
          logger.warn({ err, userId: sub.user_id, signalId: signal.id }, "Failed to notify subscriber");
        }
      }
    }

    // 2. Notify about recently closed signals
    await this.pollClosedSignals();
  }

  private async pollClosedSignals(): Promise<void> {
    if (!this.notifier) return;

    const closedSignals = this.lastNotifiedCloseTime
      ? this.db.prepare(
          "SELECT * FROM signals WHERE status = 'closed' AND closed_at > ? ORDER BY closed_at ASC",
        ).all(this.lastNotifiedCloseTime) as SignalRow[]
      : this.db.prepare(
          "SELECT * FROM signals WHERE status = 'closed' ORDER BY closed_at ASC",
        ).all() as SignalRow[];

    for (const signal of closedSignals) {
      this.lastNotifiedCloseTime = signal.closed_at;

      const subscribers = this.getProviderSubscribers(signal.provider_id);
      if (subscribers.length === 0) continue;

      const provider = this.getProvider(signal.provider_id);
      const providerName = provider?.display_name ?? signal.provider_id.slice(0, 8);
      const pnlStr = signal.pnl_pct !== null
        ? (signal.pnl_pct >= 0 ? `+${signal.pnl_pct.toFixed(2)}%` : `${signal.pnl_pct.toFixed(2)}%`)
        : "N/A";

      const message =
        `*Signal Closed*\n` +
        `Provider: ${providerName}\n` +
        `${signal.action.toUpperCase()} ${signal.token} #${signal.id}\n` +
        `Entry: $${signal.entry_price.toFixed(6)} → Exit: $${signal.exit_price?.toFixed(6) ?? "N/A"}\n` +
        `PnL: ${pnlStr}`;

      for (const sub of subscribers) {
        try {
          await this.notifier(sub.user_id, message);
        } catch (err) {
          logger.warn({ err, userId: sub.user_id, signalId: signal.id }, "Failed to notify subscriber of close");
        }
      }
    }
  }

  private expireOldSignals(): void {
    const result = this.db.prepare(
      "UPDATE signals SET status = 'expired' WHERE status = 'open' AND created_at < datetime('now', '-7 days')",
    ).run();

    if (result.changes > 0) {
      logger.info({ expired: result.changes }, "Expired old signals");
    }
  }
}

// ─── Action Handlers ──────────────────────────────────────────

function handlePublish(
  engine: TradingSignalsEngine,
  parsed: z.infer<typeof tradingSignalsParams>,
  context: SkillExecutionContext,
  verifyResult: { verified: boolean; extractedPrice: number | null },
): SkillResult {
  const token = parsed.token!;
  const txHash = parsed.txHash!;
  const action = parsed.signalAction!;
  const entryPrice = verifyResult.extractedPrice ?? parsed.entryPrice!;
  const collateralUsd = parsed.collateralUsd!;

  // Auto-register provider
  const displayName = context.userId.slice(0, 12);
  engine.upsertProvider(context.userId, displayName);

  const signalId = engine.publishSignal(
    context.userId,
    action,
    token,
    parsed.chainId,
    entryPrice,
    txHash,
    collateralUsd,
    parsed.leverage,
    parsed.confidence ?? null,
    parsed.reasoning ?? null,
    verifyResult.verified,
  );

  const verifiedTag = verifyResult.verified ? " (verified on-chain)" : " (unverified)";
  const priceNote = verifyResult.extractedPrice
    ? `\nOn-chain price: $${verifyResult.extractedPrice.toFixed(6)}`
    : "";

  return {
    success: true,
    message:
      `*Signal Published*${verifiedTag}\n` +
      `ID: #${signalId}\n` +
      `${action.toUpperCase()} ${token.toUpperCase()} at $${entryPrice.toFixed(6)}\n` +
      `Collateral: $${collateralUsd.toFixed(2)} (${parsed.leverage}x)` +
      priceNote,
    data: { signalId, verified: verifyResult.verified },
  };
}

function handleClose(
  engine: TradingSignalsEngine,
  parsed: z.infer<typeof tradingSignalsParams>,
  context: SkillExecutionContext,
): SkillResult {
  if (!parsed.signalId) {
    return { success: false, message: "Missing signalId. Usage: close signal <id> at <exitPrice>" };
  }
  if (parsed.exitPrice === undefined) {
    return { success: false, message: "Missing exitPrice." };
  }

  const { success, pnlPct } = engine.closeSignal(
    parsed.signalId,
    context.userId,
    parsed.exitPrice,
    parsed.exitTxHash ?? null,
  );

  if (!success) {
    return { success: false, message: `Signal #${parsed.signalId} not found or already closed.` };
  }

  const pnlStr = pnlPct !== null ? (pnlPct >= 0 ? `+${pnlPct.toFixed(2)}%` : `${pnlPct.toFixed(2)}%`) : "N/A";

  return {
    success: true,
    message:
      `*Signal Closed*\n` +
      `ID: #${parsed.signalId}\n` +
      `Exit Price: $${parsed.exitPrice.toFixed(6)}\n` +
      `PnL: ${pnlStr}`,
    data: { signalId: parsed.signalId, pnlPct },
  };
}

function handleFeed(
  engine: TradingSignalsEngine,
  parsed: z.infer<typeof tradingSignalsParams>,
): SkillResult {
  const signals = engine.getSignalFeed(
    parsed.limit,
    parsed.offset,
    parsed.filterToken,
    parsed.filterProvider,
  );

  if (signals.length === 0) {
    return { success: true, message: "No signals found." };
  }

  const lines = signals.map((s) => {
    const verifiedTag = s.verified_onchain ? " ✓" : "";
    const pnl = s.pnl_pct !== null ? ` | PnL: ${s.pnl_pct >= 0 ? "+" : ""}${s.pnl_pct.toFixed(2)}%` : "";
    return `#${s.id} ${s.action.toUpperCase()} ${s.token}${verifiedTag} at $${s.entry_price.toFixed(6)}${pnl} [${s.status}]`;
  });

  return {
    success: true,
    message: `*Signal Feed* (${signals.length} results)\n${lines.join("\n")}`,
    data: signals,
  };
}

function handleSubscribe(
  engine: TradingSignalsEngine,
  parsed: z.infer<typeof tradingSignalsParams>,
  context: SkillExecutionContext,
): SkillResult {
  if (!parsed.providerId) {
    return { success: false, message: "Missing providerId." };
  }

  try {
    engine.subscribe(
      context.userId,
      parsed.providerId,
      parsed.autoCopy,
      parsed.copyAmountUsd ?? null,
      parsed.maxDailyTrades,
    );

    const copyNote = parsed.autoCopy
      ? `\nAuto-copy: ON ($${parsed.copyAmountUsd ?? "default"}/trade, max ${parsed.maxDailyTrades}/day)`
      : "";

    return {
      success: true,
      message: `Subscribed to provider: ${parsed.providerId}${copyNote}`,
    };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Subscription failed" };
  }
}

function handleUnsubscribe(
  engine: TradingSignalsEngine,
  parsed: z.infer<typeof tradingSignalsParams>,
  context: SkillExecutionContext,
): SkillResult {
  if (!parsed.providerId) {
    return { success: false, message: "Missing providerId." };
  }

  const ok = engine.unsubscribe(context.userId, parsed.providerId);
  if (!ok) {
    return { success: false, message: "No active subscription found for this provider." };
  }
  return { success: true, message: `Unsubscribed from provider: ${parsed.providerId}` };
}

function handleLeaderboard(
  engine: TradingSignalsEngine,
  parsed: z.infer<typeof tradingSignalsParams>,
): SkillResult {
  const providers = engine.getLeaderboard(parsed.limit, parsed.offset);

  if (providers.length === 0) {
    return { success: true, message: "No providers with 5+ closed signals yet." };
  }

  const lines = providers.map((p, i) => {
    const rank = parsed.offset + i + 1;
    const winRate = p.total_signals > 0 ? ((p.wins / p.total_signals) * 100).toFixed(1) : "0";
    const avgReturn = p.avg_return_pct >= 0 ? `+${p.avg_return_pct.toFixed(2)}%` : `${p.avg_return_pct.toFixed(2)}%`;
    return `${rank}. ${p.display_name} | ${winRate}% win rate | ${avgReturn} avg | ${p.total_signals} signals`;
  });

  return {
    success: true,
    message: `*Leaderboard* (min 5 signals)\n${lines.join("\n")}`,
    data: providers,
  };
}

function handleMySignals(
  engine: TradingSignalsEngine,
  parsed: z.infer<typeof tradingSignalsParams>,
  context: SkillExecutionContext,
): SkillResult {
  const signals = engine.getUserSignals(context.userId, parsed.limit, parsed.offset);

  if (signals.length === 0) {
    return { success: true, message: "You haven't published any signals yet." };
  }

  const lines = signals.map((s) => {
    const pnl = s.pnl_pct !== null ? ` | PnL: ${s.pnl_pct >= 0 ? "+" : ""}${s.pnl_pct.toFixed(2)}%` : "";
    return `#${s.id} ${s.action.toUpperCase()} ${s.token} at $${s.entry_price.toFixed(6)}${pnl} [${s.status}]`;
  });

  return {
    success: true,
    message: `*Your Signals* (${signals.length})\n${lines.join("\n")}`,
    data: signals,
  };
}

function handleMySubscriptions(
  engine: TradingSignalsEngine,
  context: SkillExecutionContext,
): SkillResult {
  const subs = engine.getUserSubscriptions(context.userId);

  if (subs.length === 0) {
    return { success: true, message: "No active subscriptions." };
  }

  const lines = subs.map((s) => {
    const copyTag = s.auto_copy ? ` | Auto-copy: $${s.copy_amount_usd ?? "default"}` : "";
    return `${s.provider_id}${copyTag} (since ${s.created_at.slice(0, 10)})`;
  });

  return {
    success: true,
    message: `*Your Subscriptions* (${subs.length})\n${lines.join("\n")}`,
    data: subs,
  };
}

function handleProviders(
  engine: TradingSignalsEngine,
  parsed: z.infer<typeof tradingSignalsParams>,
): SkillResult {
  const providers = engine.searchProviders(parsed.query, parsed.limit, parsed.offset);

  if (providers.length === 0) {
    return { success: true, message: "No providers found." };
  }

  const lines = providers.map((p) => {
    const winRate = p.total_signals > 0 ? ((p.wins / p.total_signals) * 100).toFixed(1) : "0";
    return `${p.display_name} (${p.user_id.slice(0, 8)}...) | ${p.total_signals} signals | ${winRate}% win rate`;
  });

  return {
    success: true,
    message: `*Signal Providers* (${providers.length})\n${lines.join("\n")}`,
    data: providers,
  };
}

// ─── Skill Factory ──────────────────────────────────────────────

export function createTradingSignalsSkill(engine: TradingSignalsEngine): SkillDefinition {
  return {
    name: "trading-signals",
    description: "Publish and subscribe to TX-verified trading signals with leaderboard and copy-trading",
    parameters: tradingSignalsParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = tradingSignalsParams.parse(params);

      switch (parsed.action) {
        case "publish": {
          if (!context.walletAddress) {
            return { success: false, message: "No wallet configured. Use /wallet create first." };
          }
          if (!parsed.token || !parsed.txHash || !parsed.signalAction || !parsed.collateralUsd) {
            return {
              success: false,
              message: "Missing required fields: token, txHash, signalAction (buy/sell), collateralUsd",
            };
          }
          if (parsed.entryPrice === undefined) {
            return { success: false, message: "Missing entryPrice. Will be overridden if on-chain extraction succeeds." };
          }

          await context.sendReply("Verifying transaction on-chain...");
          const verifyResult = await engine.verifyTxOnChain(parsed.txHash, parsed.chainId, context.walletAddress);
          return handlePublish(engine, parsed, context, verifyResult);
        }

        case "close":
          return handleClose(engine, parsed, context);

        case "feed":
          return handleFeed(engine, parsed);

        case "subscribe":
          return handleSubscribe(engine, parsed, context);

        case "unsubscribe":
          return handleUnsubscribe(engine, parsed, context);

        case "leaderboard":
          return handleLeaderboard(engine, parsed);

        case "my-signals":
          return handleMySignals(engine, parsed, context);

        case "my-subscriptions":
          return handleMySubscriptions(engine, context);

        case "providers":
          return handleProviders(engine, parsed);

        default:
          return { success: false, message: `Unknown action: ${parsed.action as string}` };
      }
    },
  };
}
