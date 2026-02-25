import { z } from "zod";
import type Database from "better-sqlite3";
import { getLogger, type SkillResult } from "@chainclaw/core";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";
import { getEthPriceUsd } from "./prices.js";
import { createPublicClient, http, formatEther, type PublicClient } from "viem";
import { mainnet, base, arbitrum, optimism, polygon, bsc, avalanche, zkSync, scroll, blast, gnosis, linea, fantom, mantle } from "viem/chains";

const logger = getLogger("skill-whale-watch");

const whaleWatchParams = z.object({
  action: z.enum(["watch", "list", "remove"]),
  address: z.string().optional(),
  label: z.string().optional(),
  minValueUsd: z.number().optional().default(10_000),
  chainId: z.number().optional().default(1),
  watchId: z.number().optional(),
});

interface WatchRow {
  id: number;
  user_id: string;
  watched_address: string;
  label: string | null;
  min_value_usd: number;
  chain_id: number;
  status: string;
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

// ─── Whale Watch Engine (Background Service) ──────────────────────────

export type WhaleNotifier = (userId: string, message: string) => Promise<void>;

export class WhaleWatchEngine {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private notifier: WhaleNotifier | null = null;
  private clients: Map<number, PublicClient> = new Map();
  private lastProcessedBlock: Map<number, bigint> = new Map();

  constructor(
    private db: Database.Database,
    private rpcOverrides?: Record<number, string>,
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
    logger.debug("Whale watches table initialized");
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

            const message =
              `*Whale Alert*\n\n` +
              `${labelStr} ${direction} ${valueEth.toFixed(4)} ETH ($${formatUsd(valueUsd)})\n` +
              `→ ${direction === "sent" ? "To" : "From"}: \`${shortenAddress(counterparty)}\`\n` +
              `Chain: ${chainName} | Block: ${block.number?.toLocaleString("en-US")}\n` +
              `Tx: \`${shortenAddress(tx.hash)}\``;

            if (this.notifier) {
              try {
                await this.notifier(watch.user_id, message);
              } catch (err) {
                logger.error({ err, watchId: watch.id }, "Failed to send whale alert");
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

  if (!/^0x[a-fA-F0-9]{40}$/.test(parsed.address)) {
    return {
      success: false,
      message: "Invalid wallet address. Please provide a valid Ethereum address (0x...).",
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
    lines.push(
      `   Chain: ${chainName} | Min: $${watch.min_value_usd.toLocaleString("en-US")}`,
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

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(2);
}
