import { z } from "zod";
import type Database from "better-sqlite3";
import { parseUnits, type Address, type Hex } from "viem";
import { getLogger, fetchWithRetry, type SkillResult } from "@chainclaw/core";
import type { TransactionExecutor } from "@chainclaw/pipeline";
import type { WalletManager } from "@chainclaw/wallet";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";
import { getEthPriceUsd } from "./prices.js";

const logger = getLogger("skill-dca");

const dcaParams = z.object({
  action: z.enum(["create", "list", "pause", "resume", "cancel", "status"]),
  // For create
  fromToken: z.string().optional(),
  toToken: z.string().optional(),
  amount: z.string().optional(),
  chainId: z.number().optional().default(1),
  frequency: z.enum(["hourly", "daily", "weekly"]).optional(),
  maxExecutions: z.number().optional(),
  // For pause/resume/cancel/status
  jobId: z.number().optional(),
});

// Token addresses + decimals per chain (mirrors swap.ts)
const TOKEN_INFO: Record<number, Record<string, { address: Address; decimals: number }>> = {
  1: {
    ETH: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
    DAI: { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
  },
  8453: {
    ETH: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  },
  42161: {
    ETH: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    USDT: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
    WETH: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
    DAI: { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 },
  },
  10: {
    ETH: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
    USDC: { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
    USDT: { address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
    WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    DAI: { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 },
  },
};

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum",
  10: "Optimism",
};

const FREQUENCY_MS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

// ─── DCA Job types ──────────────────────────────────────────────

interface DcaJob {
  id: number;
  user_id: string;
  from_token: string;
  to_token: string;
  amount: string;
  chain_id: number;
  frequency: string;
  interval_ms: number;
  status: "active" | "paused" | "completed" | "cancelled";
  total_executions: number;
  max_executions: number | null;
  total_spent: string;
  avg_price: string | null;
  last_executed_at: string | null;
  next_execution_at: string;
  wallet_address: string;
  created_at: string;
}

// ─── DCA Scheduler ──────────────────────────────────────────────

export class DcaScheduler {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private db: Database.Database,
    private executor: TransactionExecutor,
    private walletManager: WalletManager,
    private oneInchApiKey?: string,
  ) {
    this.initTable();
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dca_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        from_token TEXT NOT NULL,
        to_token TEXT NOT NULL,
        amount TEXT NOT NULL,
        chain_id INTEGER NOT NULL DEFAULT 1,
        frequency TEXT NOT NULL,
        interval_ms INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed', 'cancelled')),
        total_executions INTEGER NOT NULL DEFAULT 0,
        max_executions INTEGER,
        total_spent TEXT NOT NULL DEFAULT '0',
        avg_price TEXT,
        last_executed_at TEXT,
        next_execution_at TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_dca_jobs_user ON dca_jobs(user_id);
      CREATE INDEX IF NOT EXISTS idx_dca_jobs_next ON dca_jobs(status, next_execution_at);
    `);
    logger.debug("DCA jobs table initialized");
  }

  createJob(
    userId: string, fromToken: string, toToken: string, amount: string,
    chainId: number, frequency: string, maxExecutions: number | null,
    walletAddress: string,
  ): number {
    const intervalMs = FREQUENCY_MS[frequency];
    if (!intervalMs) throw new Error(`Invalid frequency: ${frequency}`);

    const nextAt = new Date(Date.now() + intervalMs).toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO dca_jobs (user_id, from_token, to_token, amount, chain_id, frequency, interval_ms, max_executions, next_execution_at, wallet_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(userId, fromToken, toToken, amount, chainId, frequency, intervalMs, maxExecutions, nextAt, walletAddress);
    return Number(result.lastInsertRowid);
  }

  getJob(id: number, userId: string): DcaJob | null {
    return this.db.prepare("SELECT * FROM dca_jobs WHERE id = ? AND user_id = ?").get(id, userId) as DcaJob | null;
  }

  getUserJobs(userId: string): DcaJob[] {
    return this.db.prepare(
      "SELECT * FROM dca_jobs WHERE user_id = ? AND status IN ('active', 'paused') ORDER BY created_at DESC",
    ).all(userId) as DcaJob[];
  }

  updateStatus(id: number, userId: string, status: DcaJob["status"]): boolean {
    const result = this.db.prepare("UPDATE dca_jobs SET status = ? WHERE id = ? AND user_id = ?").run(status, id, userId);
    return result.changes > 0;
  }

  /** Start the polling loop (call once at server startup) */
  start(pollIntervalMs = 60_000): void {
    if (this.running) return;
    this.running = true;
    logger.info({ pollIntervalMs }, "DCA scheduler started");

    this.pollInterval = setInterval(() => {
      this.executeDueJobs().catch((err) => logger.error({ err }, "DCA poll error"));
    }, pollIntervalMs);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.running = false;
    logger.info("DCA scheduler stopped");
  }

  private async executeDueJobs(): Promise<void> {
    const now = new Date().toISOString();
    const dueJobs = this.db.prepare(
      "SELECT * FROM dca_jobs WHERE status = 'active' AND next_execution_at <= ?",
    ).all(now) as DcaJob[];

    if (dueJobs.length === 0) return;
    logger.info({ count: dueJobs.length }, "Executing due DCA jobs");

    for (const job of dueJobs) {
      try {
        await this.executeJob(job);
      } catch (err) {
        logger.error({ err, jobId: job.id }, "DCA job execution failed");
      }
    }
  }

  private async executeJob(job: DcaJob): Promise<void> {
    const fromUpper = job.from_token.toUpperCase();
    const toUpper = job.to_token.toUpperCase();
    const chainId = job.chain_id;

    const fromInfo = TOKEN_INFO[chainId]?.[fromUpper];
    const toInfo = TOKEN_INFO[chainId]?.[toUpper];
    if (!fromInfo || !toInfo) {
      logger.warn({ jobId: job.id, fromToken: fromUpper, toToken: toUpper }, "Token not found, skipping DCA");
      return;
    }

    const amountWei = parseUnits(job.amount, fromInfo.decimals);
    const _isFromNative = fromUpper === "ETH";

    // Build 1inch swap params
    const params = new URLSearchParams({
      src: fromInfo.address,
      dst: toInfo.address,
      amount: amountWei.toString(),
      from: job.wallet_address,
      slippage: "1", // 1% default for DCA
      disableEstimate: "true",
    });

    const endpoint = this.oneInchApiKey ? "swap" : "quote";
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.oneInchApiKey) {
      headers["Authorization"] = `Bearer ${this.oneInchApiKey}`;
    }

    const response = await fetchWithRetry(
      `https://api.1inch.dev/swap/v6.0/${chainId}/${endpoint}?${params.toString()}`,
      { headers },
    );

    if (!response.ok) {
      logger.warn({ status: response.status, jobId: job.id }, "DCA swap quote failed");
      // Don't update next_execution_at — retry next poll
      return;
    }

    const quote = (await response.json()) as { toAmount: string; tx?: { to: string; data: string; value: string; gas: number } };

    if (!quote.tx) {
      logger.warn({ jobId: job.id }, "DCA quote has no tx (no API key?), skipping execution");
      this.advanceJob(job, "0", null);
      return;
    }

    const signer = this.walletManager.getSigner(job.wallet_address);
    const ethPrice = await getEthPriceUsd();

    const result = await this.executor.execute(
      {
        chainId,
        from: job.wallet_address as Address,
        to: quote.tx.to as Address,
        value: BigInt(quote.tx.value),
        data: quote.tx.data as Hex,
        gasLimit: BigInt(quote.tx.gas),
      },
      signer,
      {
        userId: job.user_id,
        skillName: "dca",
        intentDescription: `DCA: swap ${job.amount} ${fromUpper} → ${toUpper} (job #${job.id})`,
        ethPriceUsd: ethPrice,
      },
      {},
    );

    if (result.success) {
      const toDecimals = toInfo.decimals;
      const received = Number(BigInt(quote.toAmount)) / 10 ** toDecimals;
      const spent = Number(job.amount);
      const price = spent > 0 && received > 0 ? (spent / received).toFixed(6) : null;
      this.advanceJob(job, job.amount, price);
      logger.info({ jobId: job.id, executions: job.total_executions + 1 }, "DCA execution succeeded");
    } else {
      logger.warn({ jobId: job.id, message: result.message }, "DCA swap execution failed");
      // Still advance the schedule so we don't retry immediately
      this.advanceJob(job, "0", null);
    }
  }

  private advanceJob(job: DcaJob, spentThisRound: string, priceThisRound: string | null): void {
    const newTotal = job.total_executions + 1;
    const newSpent = (Number(job.total_spent) + Number(spentThisRound)).toString();

    // Compute running average price
    let newAvgPrice = job.avg_price;
    if (priceThisRound) {
      const prevAvg = job.avg_price ? Number(job.avg_price) : 0;
      const prevCount = job.total_executions;
      newAvgPrice = ((prevAvg * prevCount + Number(priceThisRound)) / newTotal).toFixed(6);
    }

    // Check if completed
    const completed = job.max_executions != null && newTotal >= job.max_executions;
    const newStatus = completed ? "completed" : "active";
    const nextAt = completed ? job.next_execution_at : new Date(Date.now() + job.interval_ms).toISOString();

    this.db.prepare(`
      UPDATE dca_jobs
      SET total_executions = ?, total_spent = ?, avg_price = ?, last_executed_at = datetime('now'),
          next_execution_at = ?, status = ?
      WHERE id = ?
    `).run(newTotal, newSpent, newAvgPrice, nextAt, newStatus, job.id);
  }
}

// ─── DCA Skill Definition ───────────────────────────────────────

export function createDcaSkill(scheduler: DcaScheduler): SkillDefinition {
  return {
    name: "dca",
    description:
      "Dollar-cost averaging. Create recurring swap schedules (hourly, daily, weekly). " +
      "Manage with list, pause, resume, cancel, or status.",
    parameters: dcaParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = dcaParams.parse(params);

      if (!context.walletAddress) {
        return { success: false, message: "No wallet configured. Use /wallet create first." };
      }

      switch (parsed.action) {
        case "create":
          return handleCreate(scheduler, parsed, context);
        case "list":
          return handleList(scheduler, context);
        case "pause":
          return handleStatusChange(scheduler, parsed.jobId, context, "paused");
        case "resume":
          return handleStatusChange(scheduler, parsed.jobId, context, "active");
        case "cancel":
          return handleStatusChange(scheduler, parsed.jobId, context, "cancelled");
        case "status":
          return handleStatus(scheduler, parsed.jobId, context);
      }
    },
  };
}

function handleCreate(
  scheduler: DcaScheduler,
  parsed: z.infer<typeof dcaParams>,
  context: SkillExecutionContext,
): SkillResult {
  const fromToken = parsed.fromToken?.toUpperCase();
  const toToken = parsed.toToken?.toUpperCase();
  const amount = parsed.amount;
  const frequency = parsed.frequency;
  const chainId = parsed.chainId;

  if (!fromToken || !toToken || !amount || !frequency) {
    return { success: false, message: "Missing required fields: fromToken, toToken, amount, and frequency." };
  }

  const chainTokens = TOKEN_INFO[chainId];
  if (!chainTokens?.[fromToken]) {
    return { success: false, message: `${fromToken} is not supported on ${CHAIN_NAMES[chainId] ?? `Chain ${chainId}`}.` };
  }
  if (!chainTokens?.[toToken]) {
    return { success: false, message: `${toToken} is not supported on ${CHAIN_NAMES[chainId] ?? `Chain ${chainId}`}.` };
  }

  const jobId = scheduler.createJob(
    context.userId, fromToken, toToken, amount, chainId,
    frequency, parsed.maxExecutions ?? null, context.walletAddress!,
  );

  const maxLabel = parsed.maxExecutions ? ` (${parsed.maxExecutions} executions)` : " (unlimited)";
  const chainName = CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;

  return {
    success: true,
    message:
      `*DCA Job #${jobId} Created*\n\n` +
      `${amount} ${fromToken} → ${toToken}\n` +
      `Frequency: ${frequency}\n` +
      `Chain: ${chainName}${maxLabel}\n\n` +
      `_First execution in ~1 ${frequency.replace("ly", "")}._`,
  };
}

function handleList(scheduler: DcaScheduler, context: SkillExecutionContext): SkillResult {
  const jobs = scheduler.getUserJobs(context.userId);

  if (jobs.length === 0) {
    return { success: true, message: "No active DCA jobs. Use `create` to start one." };
  }

  const lines = ["*Your DCA Jobs*\n"];
  for (const job of jobs) {
    const status = job.status === "paused" ? " (paused)" : "";
    const progress = job.max_executions ? ` ${job.total_executions}/${job.max_executions}` : ` ${job.total_executions} done`;
    const chainName = CHAIN_NAMES[job.chain_id] ?? `Chain ${job.chain_id}`;
    lines.push(
      `*#${job.id}* ${job.amount} ${job.from_token} → ${job.to_token} (${job.frequency}, ${chainName})${status}${progress}`,
    );
  }

  return { success: true, message: lines.join("\n") };
}

function handleStatusChange(
  scheduler: DcaScheduler,
  jobId: number | undefined,
  context: SkillExecutionContext,
  newStatus: DcaJob["status"],
): SkillResult {
  if (!jobId) {
    return { success: false, message: "Please specify a job ID." };
  }

  const updated = scheduler.updateStatus(jobId, context.userId, newStatus);
  if (!updated) {
    return { success: false, message: `DCA job #${jobId} not found or not yours.` };
  }

  const verb = newStatus === "active" ? "resumed" : newStatus === "paused" ? "paused" : "cancelled";
  return { success: true, message: `DCA job #${jobId} ${verb}.` };
}

function handleStatus(
  scheduler: DcaScheduler,
  jobId: number | undefined,
  context: SkillExecutionContext,
): SkillResult {
  if (!jobId) {
    return { success: false, message: "Please specify a job ID." };
  }

  const job = scheduler.getJob(jobId, context.userId);
  if (!job) {
    return { success: false, message: `DCA job #${jobId} not found or not yours.` };
  }

  const chainName = CHAIN_NAMES[job.chain_id] ?? `Chain ${job.chain_id}`;
  const progress = job.max_executions
    ? `${job.total_executions}/${job.max_executions}`
    : `${job.total_executions} executions`;
  const avgPrice = job.avg_price ? `\nAvg price: ${job.avg_price}` : "";
  const lastExec = job.last_executed_at ? `\nLast executed: ${job.last_executed_at}` : "\nNot yet executed";
  const nextExec = job.status === "active" ? `\nNext: ${job.next_execution_at}` : "";

  return {
    success: true,
    message:
      `*DCA Job #${job.id}*\n\n` +
      `${job.amount} ${job.from_token} → ${job.to_token}\n` +
      `Chain: ${chainName}\n` +
      `Frequency: ${job.frequency}\n` +
      `Status: ${job.status}\n` +
      `Progress: ${progress}\n` +
      `Total spent: ${job.total_spent} ${job.from_token}` +
      avgPrice + lastExec + nextExec,
  };
}
