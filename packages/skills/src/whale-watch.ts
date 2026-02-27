import { z } from "zod";
import type Database from "better-sqlite3";
import { getLogger, fetchWithRetry, type SkillResult } from "@chainclaw/core";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";
import { getEthPriceUsd } from "./prices.js";
import { createPublicClient, http, formatEther, parseEther, type PublicClient, type Address, type Hex } from "viem";
import { mainnet, base, arbitrum, optimism, polygon, bsc, avalanche, zkSync, scroll, blast, gnosis, linea, fantom, mantle } from "viem/chains";
import type { RiskEngine, TransactionExecutor } from "@chainclaw/pipeline";
import type { WalletManager } from "@chainclaw/wallet";

const logger = getLogger("skill-whale-watch");

const whaleWatchParams = z.object({
  action: z.enum(["watch", "list", "remove", "copy", "uncopy"]),
  address: z.string().optional(),
  label: z.string().optional(),
  minValueUsd: z.number().optional().default(10_000),
  chainId: z.number().optional().default(1),
  watchId: z.number().optional(),
  copyAmount: z.string().regex(/^\d+(\.\d+)?$/, "Must be a valid ETH amount").optional(),
  copyMaxDaily: z.number().min(1).max(100).optional().default(5),
});

interface WatchRow {
  id: number;
  user_id: string;
  watched_address: string;
  label: string | null;
  min_value_usd: number;
  chain_id: number;
  status: string;
  auto_copy: number;
  copy_amount: string | null;
  copy_max_daily: number;
  copy_today_count: number;
  copy_today_reset: string | null;
  created_at: string;
}

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum",
  10: "Optimism",
  137: "Polygon",
  56: "BNB Chain",
  43114: "Avalanche",
  324: "zkSync Era",
  534352: "Scroll",
  81457: "Blast",
  100: "Gnosis",
  59144: "Linea",
  250: "Fantom",
  5000: "Mantle",
  900: "Solana",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const VIEM_CHAINS: Record<number, any> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
  137: polygon,
  56: bsc,
  43114: avalanche,
  324: zkSync,
  534352: scroll,
  81457: blast,
  100: gnosis,
  59144: linea,
  250: fantom,
  5000: mantle,
};

// Known DEX routers (for detecting whale swaps)
const KNOWN_DEX_ROUTERS = new Set([
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", // Uniswap V2
  "0xe592427a0aece92de3edee1f18e0157c05861564", // Uniswap V3
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", // Uniswap Universal Router
  "0x1111111254eeb25477b68fb85ed929f73a960582", // 1inch v5
  "0x111111125421ca6dc452d289314280a0f8842a65", // 1inch v6
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff", // 0x Exchange Proxy
]);

/**
 * Extract target token from Uniswap V2 swap calldata.
 * Supports swapExactETHForTokens (0x7ff36ab5) and swapExactETHForTokensSupportingFeeOnTransferTokens (0xb6f9de95).
 */
function extractTokenFromSwapData(input: Hex): Address | null {
  if (!input || input.length < 10) return null;
  const selector = input.slice(0, 10).toLowerCase();

  if (selector === "0x7ff36ab5" || selector === "0xb6f9de95") {
    try {
      // ABI: (uint256 amountOutMin, address[] path, address to, uint256 deadline)
      const data = input.slice(10); // remove selector
      const pathOffset = parseInt(data.slice(64, 128), 16) * 2;
      const pathLen = parseInt(data.slice(pathOffset, pathOffset + 64), 16);
      if (pathLen >= 2 && pathLen <= 10) {
        const lastIdx = pathLen - 1;
        const tokenStart = pathOffset + 64 + lastIdx * 64;
        const tokenHex = data.slice(tokenStart + 24, tokenStart + 64);
        if (tokenHex.length === 40) {
          return `0x${tokenHex}`;
        }
      }
    } catch {
      // Malformed calldata
    }
  }

  return null;
}

// ─── Whale Watch Engine (Background Service) ──────────────────────────

export type WhaleNotifier = (userId: string, message: string) => Promise<void>;

export interface WhaleWatchDeps {
  executor?: TransactionExecutor;
  walletManager?: WalletManager;
  riskEngine?: RiskEngine;
  oneInchApiKey?: string;
}

export class WhaleWatchEngine {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private notifier: WhaleNotifier | null = null;
  private clients: Map<number, PublicClient> = new Map();
  private lastProcessedBlock: Map<number, bigint> = new Map();
  readonly flowTracker = new FlowTracker();

  constructor(
    private db: Database.Database,
    private rpcOverrides?: Record<number, string>,
    private deps: WhaleWatchDeps = {},
  ) {
    this.initTable();
    this.initClients();
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS whale_watches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        watched_address TEXT NOT NULL,
        label TEXT,
        min_value_usd REAL NOT NULL DEFAULT 10000,
        chain_id INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_whale_watches_user ON whale_watches(user_id);
      CREATE INDEX IF NOT EXISTS idx_whale_watches_status ON whale_watches(status);
    `);
    // Migration: add copy-trading columns
    this.safeAddColumn("whale_watches", "auto_copy", "INTEGER NOT NULL DEFAULT 0");
    this.safeAddColumn("whale_watches", "copy_amount", "TEXT");
    this.safeAddColumn("whale_watches", "copy_max_daily", "INTEGER NOT NULL DEFAULT 5");
    this.safeAddColumn("whale_watches", "copy_today_count", "INTEGER NOT NULL DEFAULT 0");
    this.safeAddColumn("whale_watches", "copy_today_reset", "TEXT");

    logger.debug("Whale watches table initialized");
  }

  private safeAddColumn(table: string, column: string, definition: string): void {
    try {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch {
      // Column already exists — ignore
    }
  }

  private initClients(): void {
    for (const [chainId, chain] of Object.entries(VIEM_CHAINS)) {
      const id = Number(chainId);
      const rpcUrl = this.rpcOverrides?.[id];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const client = createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient;
      this.clients.set(id, client);
    }
  }

  setNotifier(notifier: WhaleNotifier): void {
    this.notifier = notifier;
  }

  createWatch(
    userId: string,
    address: string,
    label: string | null,
    minValueUsd: number,
    chainId: number,
  ): number {
    const result = this.db.prepare(
      "INSERT INTO whale_watches (user_id, watched_address, label, min_value_usd, chain_id) VALUES (?, ?, ?, ?, ?)",
    ).run(userId, address.toLowerCase(), label, minValueUsd, chainId);
    return Number(result.lastInsertRowid);
  }

  getUserWatches(userId: string): WatchRow[] {
    return this.db.prepare(
      "SELECT * FROM whale_watches WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC",
    ).all(userId) as WatchRow[];
  }

  deleteWatch(id: number, userId: string): boolean {
    const result = this.db.prepare(
      "UPDATE whale_watches SET status = 'deleted' WHERE id = ? AND user_id = ? AND status = 'active'",
    ).run(id, userId);
    return result.changes > 0;
  }

  // ─── Copy-trading management ────────────────────────────────

  enableCopy(watchId: number, userId: string, copyAmount: string, maxDaily: number): boolean {
    const result = this.db.prepare(
      "UPDATE whale_watches SET auto_copy = 1, copy_amount = ?, copy_max_daily = ? WHERE id = ? AND user_id = ? AND status = 'active'",
    ).run(copyAmount, maxDaily, watchId, userId);
    return result.changes > 0;
  }

  disableCopy(watchId: number, userId: string): boolean {
    const result = this.db.prepare(
      "UPDATE whale_watches SET auto_copy = 0, copy_amount = NULL, copy_today_count = 0 WHERE id = ? AND user_id = ? AND status = 'active'",
    ).run(watchId, userId);
    return result.changes > 0;
  }

  private resetDailyCountIfNeeded(watchId: number): void {
    const row = this.db.prepare(
      "SELECT copy_today_reset FROM whale_watches WHERE id = ?",
    ).get(watchId) as { copy_today_reset: string | null } | undefined;

    if (!row) return;

    const today = new Date().toISOString().slice(0, 10);
    if (row.copy_today_reset !== today) {
      this.db.prepare(
        "UPDATE whale_watches SET copy_today_count = 0, copy_today_reset = ? WHERE id = ?",
      ).run(today, watchId);
    }
  }

  /**
   * Atomically claim a daily copy slot. Returns true if a slot was available and claimed.
   */
  private claimCopySlot(watchId: number): boolean {
    const result = this.db.prepare(
      "UPDATE whale_watches SET copy_today_count = copy_today_count + 1 WHERE id = ? AND copy_today_count < copy_max_daily",
    ).run(watchId);
    return result.changes > 0;
  }

  private async executeCopyTrade(
    watch: WatchRow,
    tokenAddress: Address,
    chainId: number,
  ): Promise<void> {
    const { executor, walletManager, riskEngine, oneInchApiKey } = this.deps;
    if (!executor || !walletManager || !riskEngine || !watch.copy_amount) return;

    // Require 1inch API key for executable swaps
    if (!oneInchApiKey) {
      logger.warn({ watchId: watch.id }, "Copy-trade skipped: 1inch API key not configured");
      try {
        if (this.notifier) {
          await this.notifier(watch.user_id, `*Copy-Trade Skipped*\n1inch API key not configured for automated swaps.`);
        }
      } catch { /* notification best-effort */ }
      return;
    }

    // 1. Risk check
    try {
      const risk = await riskEngine.analyzeToken(chainId, tokenAddress);
      if (risk?.isHoneypot || risk?.riskLevel === "critical") {
        logger.info({ tokenAddress, watchId: watch.id }, "Copy-trade blocked: unsafe token");
        try {
          if (this.notifier) {
            await this.notifier(watch.user_id,
              `*Copy-Trade Blocked*\nToken \`${shortenAddress(tokenAddress)}\` failed safety check (${risk?.isHoneypot ? "honeypot" : "critical risk"}).`,
            );
          }
        } catch { /* notification best-effort */ }
        return;
      }
    } catch (err) {
      logger.warn({ err, tokenAddress }, "Copy-trade risk check failed");
      return;
    }

    // 2. Get swap quote from 1inch
    const walletAddress = walletManager.getDefaultAddress();
    if (!walletAddress) return;

    try {
      const amountWei = parseEther(watch.copy_amount).toString();
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${oneInchApiKey}`,
      };

      const params = new URLSearchParams({
        src: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        dst: tokenAddress,
        amount: amountWei,
        from: walletAddress,
        slippage: "5",
        disableEstimate: "true",
      });

      const response = await fetchWithRetry(
        `https://api.1inch.dev/swap/v6.0/${chainId}/swap?${params.toString()}`,
        { headers },
      );

      if (!response.ok) {
        logger.warn({ status: response.status }, "Copy-trade 1inch swap failed");
        return;
      }

      const quote = (await response.json()) as { tx?: { to: string; data: string; value: string; gas: number } };
      if (!quote.tx) return;

      // 3. Execute swap
      const signer = walletManager.getSigner(walletAddress);
      const ethPrice = await getEthPriceUsd();

      const result = await executor.execute(
        {
          chainId,
          from: walletAddress as Address,
          to: quote.tx.to as Address,
          value: BigInt(quote.tx.value),
          data: quote.tx.data as Hex,
          gasLimit: BigInt(quote.tx.gas),
        },
        signer,
        {
          userId: watch.user_id,
          skillName: "whale-watch-copy",
          intentDescription: `Copy-trade: ${watch.copy_amount} ETH → ${shortenAddress(tokenAddress)}`,
          ethPriceUsd: ethPrice,
        },
      );

      try {
        if (this.notifier) {
          const msg = result.success
            ? `*Copy-Trade Executed*\nBought \`${shortenAddress(tokenAddress)}\` with ${watch.copy_amount} ETH\nTx: \`${result.hash ?? "pending"}\``
            : `*Copy-Trade Failed*\n${result.message}`;
          await this.notifier(watch.user_id, msg);
        }
      } catch { /* notification best-effort */ }
    } catch (err) {
      logger.error({ err, tokenAddress, watchId: watch.id }, "Copy-trade execution failed");
    }
  }

  start(pollIntervalMs = 30_000): void {
    if (this.pollInterval) return;
    logger.info({ pollIntervalMs }, "Whale watch engine started");

    setTimeout(() => {
      this.checkBlocks().catch((err) => logger.error({ err }, "Whale watch check error"));
    }, 10_000);

    this.pollInterval = setInterval(() => {
      this.checkBlocks().catch((err) => logger.error({ err }, "Whale watch check error"));
    }, pollIntervalMs);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    logger.info("Whale watch engine stopped");
  }

  private async checkBlocks(): Promise<void> {
    const activeWatches = this.db.prepare(
      "SELECT * FROM whale_watches WHERE status = 'active'",
    ).all() as WatchRow[];

    if (activeWatches.length === 0) return;

    // Group watches by chain
    const watchesByChain = new Map<number, WatchRow[]>();
    for (const watch of activeWatches) {
      const list = watchesByChain.get(watch.chain_id) ?? [];
      list.push(watch);
      watchesByChain.set(watch.chain_id, list);
    }

    const ethPrice = await getEthPriceUsd();

    for (const [chainId, watches] of watchesByChain) {
      const client = this.clients.get(chainId);
      if (!client) continue;

      try {
        const block = await client.getBlock({ blockTag: "latest", includeTransactions: true });
        const lastProcessed = this.lastProcessedBlock.get(chainId);

        // Skip if we already processed this block
        if (lastProcessed && block.number != null && block.number <= lastProcessed) continue;
        if (block.number != null) {
          this.lastProcessedBlock.set(chainId, block.number);
        }

        // Build a set of watched addresses for fast lookup
        const watchedAddresses = new Map<string, WatchRow[]>();
        for (const watch of watches) {
          const addr = watch.watched_address.toLowerCase();
          const list = watchedAddresses.get(addr) ?? [];
          list.push(watch);
          watchedAddresses.set(addr, list);
        }

        // Scan transactions
        for (const tx of block.transactions) {
          if (typeof tx === "string") continue; // skip hash-only transactions

          const from = tx.from?.toLowerCase();
          const to = tx.to?.toLowerCase();
          const valueEth = parseFloat(formatEther(tx.value));
          const valueUsd = valueEth * ethPrice;

          // Check if from or to is a watched address
          const matchedWatches: WatchRow[] = [];
          if (from && watchedAddresses.has(from)) {
            matchedWatches.push(...watchedAddresses.get(from)!);
          }
          if (to && watchedAddresses.has(to)) {
            for (const w of watchedAddresses.get(to)!) {
              if (!matchedWatches.includes(w)) matchedWatches.push(w);
            }
          }

          for (const watch of matchedWatches) {
            if (valueUsd < watch.min_value_usd) continue;

            const chainName = CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
            const direction = from === watch.watched_address.toLowerCase() ? "sent" : "received";
            const counterparty = direction === "sent" ? (tx.to ?? "unknown") : tx.from;
            const labelStr = watch.label ? `${watch.label} (${shortenAddress(watch.watched_address)})` : shortenAddress(watch.watched_address);

            // Record flow for tracking
            const flowDir = direction === "received" ? "in" as const : "out" as const;
            this.flowTracker.record(watch.watched_address, valueEth, flowDir);

            // Enrich alert with flow context
            const flowSummary = this.flowTracker.getSummary(watch.watched_address);
            const flowLine = flowSummary ? `\n_${flowSummary}_` : "";

            const message =
              `*Whale Alert*\n\n` +
              `${labelStr} ${direction} ${valueEth.toFixed(4)} ETH ($${formatUsd(valueUsd)})\n` +
              `→ ${direction === "sent" ? "To" : "From"}: \`${shortenAddress(counterparty)}\`\n` +
              `Chain: ${chainName} | Block: ${block.number?.toLocaleString("en-US")}\n` +
              `Tx: \`${shortenAddress(tx.hash)}\`` +
              flowLine;

            // Analyze flow patterns and send separate signal alert if detected
            const flowAlert = this.flowTracker.analyze(watch.watched_address, watch.label ?? null);
            const signalLine = flowAlert ? `\n*Signal: ${flowAlert.signal}* — ${flowAlert.context}` : "";

            if (this.notifier) {
              try {
                await this.notifier(watch.user_id, message + signalLine);
              } catch (err) {
                logger.error({ err, watchId: watch.id }, "Failed to send whale alert");
              }
            }

            // Copy-trade: auto-copy when whale sends to a known DEX router
            if (watch.auto_copy === 1 && from === watch.watched_address.toLowerCase() && to && KNOWN_DEX_ROUTERS.has(to)) {
              const tokenAddress = extractTokenFromSwapData(tx.input);
              if (tokenAddress) {
                this.resetDailyCountIfNeeded(watch.id);
                // Atomic claim: increment count and check limit in a single UPDATE
                if (this.claimCopySlot(watch.id)) {
                  this.executeCopyTrade(watch, tokenAddress, chainId).catch((err) => {
                    logger.error({ err, watchId: watch.id }, "Copy-trade failed");
                  });
                } else {
                  logger.info({ watchId: watch.id }, "Copy-trade: daily limit reached");
                }
              } else {
                logger.debug({ watchId: watch.id, to, selector: tx.input.slice(0, 10) }, "Copy-trade: could not extract token from swap calldata");
              }
            }
          }
        }
      } catch (err) {
        logger.warn({ err, chainId }, "Failed to fetch block for whale watch");
      }
    }
  }
}

// ─── Flow Tracker (Smart Money Flow Analysis) ─────────────────────────

interface FlowSnapshot {
  address: string;
  timestamp: number;
  netFlowEth: number;     // positive = accumulating, negative = distributing
  txCount: number;
}

type FlowSignal = "ACCUMULATION" | "DISTRIBUTION" | "FLOW_ACCELERATION" | "FLOW_REVERSAL";

interface FlowAlert {
  address: string;
  label: string | null;
  signal: FlowSignal;
  context: string;
}

class FlowTracker {
  // Rolling window of flow snapshots per address (last 24h)
  private snapshots = new Map<string, FlowSnapshot[]>();
  private readonly maxAgeMs = 24 * 60 * 60 * 1000; // 24h

  /**
   * Record a transaction flow for a watched address.
   */
  record(address: string, valueEth: number, direction: "in" | "out"): void {
    const addr = address.toLowerCase();
    const now = Date.now();

    let snaps = this.snapshots.get(addr);
    if (!snaps) {
      snaps = [];
      this.snapshots.set(addr, snaps);
    }

    // Prune old snapshots
    snaps = snaps.filter((s) => now - s.timestamp < this.maxAgeMs);
    this.snapshots.set(addr, snaps);

    // Add or update current snapshot (bucket by 15-min intervals)
    const bucketTime = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000);
    let current = snaps.find((s) => s.timestamp === bucketTime);
    if (!current) {
      current = { address: addr, timestamp: bucketTime, netFlowEth: 0, txCount: 0 };
      snaps.push(current);
    }

    current.netFlowEth += direction === "in" ? valueEth : -valueEth;
    current.txCount++;
  }

  /**
   * Analyze flow patterns for a watched address.
   * Returns signal if a pattern is detected, null otherwise.
   */
  analyze(address: string, label: string | null): FlowAlert | null {
    const addr = address.toLowerCase();
    const snaps = this.snapshots.get(addr);
    if (!snaps || snaps.length < 3) return null;

    // Sort chronologically
    const sorted = [...snaps].sort((a, b) => a.timestamp - b.timestamp);
    const recent = sorted.slice(-6); // Last ~90 min of 15-min buckets

    if (recent.length < 3) return null;

    // Check for consistent direction (3+ consecutive same-sign flows)
    const lastThree = recent.slice(-3);
    const allPositive = lastThree.every((s) => s.netFlowEth > 0);
    const allNegative = lastThree.every((s) => s.netFlowEth < 0);

    if (!allPositive && !allNegative) return null;

    const totalFlow = lastThree.reduce((s, snap) => s + snap.netFlowEth, 0);
    const totalTxs = lastThree.reduce((s, snap) => s + snap.txCount, 0);
    const flowDirection = totalFlow > 0 ? "accumulating" : "distributing";

    // Check for acceleration (increasing volume)
    const volumes = lastThree.map((s) => Math.abs(s.netFlowEth));
    const isAccelerating = volumes[2] > volumes[1] && volumes[1] > volumes[0];

    // Check for reversal (previous direction was opposite)
    let signal: FlowSignal;
    let context: string;

    if (recent.length >= 4) {
      const priorFlow = recent.slice(-4, -3)[0].netFlowEth;
      const currentDirection = totalFlow > 0;
      const priorDirection = priorFlow > 0;
      if (currentDirection !== priorDirection) {
        signal = "FLOW_REVERSAL";
        context = `Flow reversed to ${flowDirection}. Net: ${totalFlow > 0 ? "+" : ""}${totalFlow.toFixed(4)} ETH over ${totalTxs} txs`;
        return { address: addr, label, signal, context };
      }
    }

    if (isAccelerating) {
      signal = "FLOW_ACCELERATION";
      context = `${flowDirection} with increasing volume. Net: ${totalFlow > 0 ? "+" : ""}${totalFlow.toFixed(4)} ETH over ${totalTxs} txs`;
    } else if (allPositive) {
      signal = "ACCUMULATION";
      context = `Steady accumulation. Net: +${totalFlow.toFixed(4)} ETH over ${totalTxs} txs in last ~45min`;
    } else {
      signal = "DISTRIBUTION";
      context = `Steady distribution. Net: ${totalFlow.toFixed(4)} ETH over ${totalTxs} txs in last ~45min`;
    }

    return { address: addr, label, signal, context };
  }

  /**
   * Get summary for a watched address (for enriching alerts).
   */
  getSummary(address: string): string | null {
    const addr = address.toLowerCase();
    const snaps = this.snapshots.get(addr);
    if (!snaps || snaps.length === 0) return null;

    const totalFlow = snaps.reduce((s, snap) => s + snap.netFlowEth, 0);
    const totalTxs = snaps.reduce((s, snap) => s + snap.txCount, 0);
    const hours = snaps.length > 1
      ? ((snaps[snaps.length - 1].timestamp - snaps[0].timestamp) / (1000 * 60 * 60)).toFixed(1)
      : "0";

    const direction = totalFlow > 0 ? "accumulating" : totalFlow < 0 ? "distributing" : "neutral";
    return `This wallet has been ${direction} for ${hours}h (net ${totalFlow > 0 ? "+" : ""}${totalFlow.toFixed(4)} ETH, ${totalTxs} txs)`;
  }
}

export { FlowTracker, type FlowSignal, type FlowAlert };

// ─── Whale Watch Skill (User Interface) ───────────────────────────────

export function createWhaleWatchSkill(engine: WhaleWatchEngine): SkillDefinition {
  return {
    name: "whale-watch",
    description:
      "Track whale wallets and get alerts when they make large transactions. " +
      "Example: 'Watch vitalik's wallet for moves over $100k'.",
    parameters: whaleWatchParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = whaleWatchParams.parse(params);

      switch (parsed.action) {
        case "watch":
          return handleWatch(engine, parsed, context);
        case "list":
          return handleList(engine, context);
        case "remove":
          return handleRemove(engine, parsed, context);
        case "copy":
          return handleCopy(engine, parsed, context);
        case "uncopy":
          return handleUncopy(engine, parsed, context);
      }
    },
  };
}

function handleWatch(
  engine: WhaleWatchEngine,
  parsed: z.infer<typeof whaleWatchParams>,
  context: SkillExecutionContext,
): SkillResult {
  if (!parsed.address) {
    return {
      success: false,
      message: "Please provide a wallet address to watch.\n\nExample: _Watch 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 for moves over $50k_",
    };
  }

  // Validate address format: EVM (0x...) or Solana (base58, 32-44 chars)
  const isEvmAddress = /^0x[a-fA-F0-9]{40}$/.test(parsed.address);
  const isSolanaAddress = parsed.chainId === 900 && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(parsed.address);
  if (!isEvmAddress && !isSolanaAddress) {
    return {
      success: false,
      message: parsed.chainId === 900
        ? "Invalid Solana address. Please provide a valid base58 address."
        : "Invalid wallet address. Please provide a valid Ethereum address (0x...).",
    };
  }

  const chainName = CHAIN_NAMES[parsed.chainId];
  if (!chainName) {
    return {
      success: false,
      message: `Chain ${parsed.chainId} is not supported for whale watching. Supported: Ethereum, Base, Arbitrum, Optimism.`,
    };
  }

  const watchId = engine.createWatch(
    context.userId,
    parsed.address,
    parsed.label ?? null,
    parsed.minValueUsd,
    parsed.chainId,
  );

  const labelStr = parsed.label ? ` (${parsed.label})` : "";

  return {
    success: true,
    message:
      `*Whale Watch #${watchId} Created*\n\n` +
      `Watching: \`${shortenAddress(parsed.address)}\`${labelStr}\n` +
      `Chain: ${chainName}\n` +
      `Min value: $${parsed.minValueUsd.toLocaleString("en-US")}\n\n` +
      `_You'll be notified when this wallet makes large transactions._`,
  };
}

function handleList(
  engine: WhaleWatchEngine,
  context: SkillExecutionContext,
): SkillResult {
  const watches = engine.getUserWatches(context.userId);

  if (watches.length === 0) {
    return {
      success: true,
      message: "No active whale watches. Create one with: _Watch 0x... for moves over $50k_",
    };
  }

  const lines = ["*Your Whale Watches*\n"];
  for (const watch of watches) {
    const chainName = CHAIN_NAMES[watch.chain_id] ?? `Chain ${watch.chain_id}`;
    const labelStr = watch.label ? ` (${watch.label})` : "";
    lines.push(
      `*#${watch.id}* \`${shortenAddress(watch.watched_address)}\`${labelStr}`,
    );
    const copyStr = watch.auto_copy
      ? ` | Copy: ON ${watch.copy_amount} ETH, ${watch.copy_today_count}/${watch.copy_max_daily} daily`
      : "";
    lines.push(
      `   Chain: ${chainName} | Min: $${watch.min_value_usd.toLocaleString("en-US")}${copyStr}`,
    );
  }

  return { success: true, message: lines.join("\n") };
}

function handleRemove(
  engine: WhaleWatchEngine,
  parsed: z.infer<typeof whaleWatchParams>,
  context: SkillExecutionContext,
): SkillResult {
  if (!parsed.watchId) {
    return { success: false, message: "Please specify a watch ID to remove." };
  }

  const deleted = engine.deleteWatch(parsed.watchId, context.userId);
  if (!deleted) {
    return { success: false, message: `Watch #${parsed.watchId} not found or not yours.` };
  }

  return { success: true, message: `*Watch #${parsed.watchId} removed.*` };
}

function handleCopy(
  engine: WhaleWatchEngine,
  parsed: z.infer<typeof whaleWatchParams>,
  context: SkillExecutionContext,
): SkillResult {
  if (!parsed.watchId) {
    return { success: false, message: "Please specify a watch ID to enable copy-trading on." };
  }
  if (!parsed.copyAmount) {
    return { success: false, message: "Please specify a copy amount (in ETH).\n\nExample: _Copy watch #1 with 0.1 ETH_" };
  }

  const success = engine.enableCopy(parsed.watchId, context.userId, parsed.copyAmount, parsed.copyMaxDaily);
  if (!success) {
    return { success: false, message: `Watch #${parsed.watchId} not found or not yours.` };
  }

  return {
    success: true,
    message:
      `*Copy-Trading Enabled on Watch #${parsed.watchId}*\n\n` +
      `Amount: ${parsed.copyAmount} ETH per trade\n` +
      `Max daily: ${parsed.copyMaxDaily} trades\n\n` +
      `_When this whale swaps on a known DEX, a copy-trade will execute automatically. Safety checks are always enforced._`,
  };
}

function handleUncopy(
  engine: WhaleWatchEngine,
  parsed: z.infer<typeof whaleWatchParams>,
  context: SkillExecutionContext,
): SkillResult {
  if (!parsed.watchId) {
    return { success: false, message: "Please specify a watch ID to disable copy-trading on." };
  }

  const success = engine.disableCopy(parsed.watchId, context.userId);
  if (!success) {
    return { success: false, message: `Watch #${parsed.watchId} not found or not yours.` };
  }

  return { success: true, message: `*Copy-trading disabled on watch #${parsed.watchId}.*` };
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(2);
}
