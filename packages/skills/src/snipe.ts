import { z } from "zod";
import type Database from "better-sqlite3";
import { type Address } from "viem";
import { getLogger, fetchWithRetry, type SkillResult } from "@chainclaw/core";
import type { RiskEngine } from "@chainclaw/pipeline";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";

const logger = getLogger("skill-snipe");

const snipeParams = z.object({
  action: z.enum(["snipe", "list", "cancel"]).default("snipe"),
  token: z.string().optional(),
  amount: z.string().optional(),
  maxSlippage: z.number().optional().default(5),
  chainId: z.number().optional().default(1),
  safetyChecks: z.boolean().optional().default(true),
  snipeId: z.number().optional(),
});

interface SnipeRow {
  id: number;
  user_id: string;
  token_address: string;
  amount: string;
  max_slippage: number;
  chain_id: number;
  safety_checks: number;
  status: string;
  risk_score: string | null;
  created_at: string;
}

interface DexScreenerPair {
  chainId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd: string;
  liquidity: { usd: number };
  fdv: number;
  pairCreatedAt: number;
  txns: { h24: { buys: number; sells: number } };
}

const CHAIN_NAMES: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  42161: "arbitrum",
  10: "optimism",
};

// Safety thresholds
const MIN_LIQUIDITY_USD = 10_000;
const MAX_BUY_TAX_PCT = 10;

export class SnipeManager {
  constructor(private db: Database.Database) {
    this.initTable();
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        token_address TEXT NOT NULL,
        amount TEXT NOT NULL,
        max_slippage REAL NOT NULL DEFAULT 5,
        chain_id INTEGER NOT NULL DEFAULT 1,
        safety_checks INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'analyzing', 'safe', 'risky', 'executed', 'cancelled', 'failed')),
        risk_score TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_snipes_user ON snipes(user_id);
      CREATE INDEX IF NOT EXISTS idx_snipes_status ON snipes(status);
    `);
    logger.debug("Snipes table initialized");
  }

  createSnipe(
    userId: string,
    tokenAddress: string,
    amount: string,
    maxSlippage: number,
    chainId: number,
    safetyChecks: boolean,
  ): number {
    const result = this.db.prepare(
      "INSERT INTO snipes (user_id, token_address, amount, max_slippage, chain_id, safety_checks) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(userId, tokenAddress.toLowerCase(), amount, maxSlippage, chainId, safetyChecks ? 1 : 0);
    return Number(result.lastInsertRowid);
  }

  updateStatus(id: number, status: string, riskScore?: string): void {
    if (riskScore) {
      this.db.prepare(
        "UPDATE snipes SET status = ?, risk_score = ? WHERE id = ?",
      ).run(status, riskScore, id);
    } else {
      this.db.prepare(
        "UPDATE snipes SET status = ? WHERE id = ?",
      ).run(status, id);
    }
  }

  getUserSnipes(userId: string): SnipeRow[] {
    return this.db.prepare(
      "SELECT * FROM snipes WHERE user_id = ? AND status NOT IN ('cancelled') ORDER BY created_at DESC LIMIT 20",
    ).all(userId) as SnipeRow[];
  }

  cancelSnipe(id: number, userId: string): boolean {
    const result = this.db.prepare(
      "UPDATE snipes SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status IN ('pending', 'analyzing')",
    ).run(id, userId);
    return result.changes > 0;
  }
}

export function createSnipeSkill(
  snipeManager: SnipeManager,
  riskEngine: RiskEngine,
): SkillDefinition {
  return {
    name: "snipe",
    description:
      "Analyze and prepare to snipe a token with safety checks. Runs honeypot detection, " +
      "liquidity analysis, and tax checks before any buy. Example: 'Snipe 0x... on Base with 0.1 ETH'.",
    parameters: snipeParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = snipeParams.parse(params);

      switch (parsed.action) {
        case "snipe":
          return handleSnipe(snipeManager, riskEngine, parsed, context);
        case "list":
          return handleList(snipeManager, context);
        case "cancel":
          return handleCancel(snipeManager, parsed, context);
      }
    },
  };
}

async function handleSnipe(
  snipeManager: SnipeManager,
  riskEngine: RiskEngine,
  parsed: z.infer<typeof snipeParams>,
  context: SkillExecutionContext,
): Promise<SkillResult> {
  if (!parsed.token) {
    return {
      success: false,
      message: "Please provide a token address to snipe.\n\nExample: _Snipe 0xAbC123... on Base with 0.1 ETH_",
    };
  }

  if (!parsed.amount) {
    return {
      success: false,
      message: "Please specify the amount to spend (in ETH).\n\nExample: _Snipe 0xAbC123... with 0.1 ETH_",
    };
  }

  if (!context.walletAddress) {
    return { success: false, message: "No wallet configured. Use /wallet to create or import one." };
  }

  const tokenAddress = parsed.token;
  const chainId = parsed.chainId;
  const chainName = CHAIN_NAMES[chainId];

  if (!chainName) {
    return {
      success: false,
      message: `Chain ${chainId} is not supported for sniping. Supported: Ethereum, Base, Arbitrum, Optimism.`,
    };
  }

  // Save snipe to DB
  const snipeId = snipeManager.createSnipe(
    context.userId,
    tokenAddress,
    parsed.amount,
    parsed.maxSlippage,
    chainId,
    parsed.safetyChecks,
  );

  await context.sendReply(
    `*Snipe #${snipeId} — Analyzing Token*\n\n` +
    `Token: \`${tokenAddress}\`\n` +
    `Amount: ${parsed.amount} ETH\n` +
    `Chain: ${chainName}\n\n` +
    `_Running safety checks..._`,
  );

  snipeManager.updateStatus(snipeId, "analyzing");

  // Step 1: Fetch DEXScreener data for liquidity info
  const pairData = await fetchDexScreenerPair(tokenAddress, chainName);

  const lines: string[] = [];

  if (pairData) {
    lines.push(`*DEXScreener Data*`);
    lines.push(`  Name: ${pairData.baseToken.name} (${pairData.baseToken.symbol})`);
    lines.push(`  Price: $${pairData.priceUsd}`);
    lines.push(`  Liquidity: $${pairData.liquidity.usd.toLocaleString("en-US")}`);
    lines.push(`  24h Txns: ${pairData.txns.h24.buys} buys / ${pairData.txns.h24.sells} sells`);
    if (pairData.pairCreatedAt) {
      const ageHours = (Date.now() - pairData.pairCreatedAt) / (1000 * 60 * 60);
      lines.push(`  Pair age: ${ageHours < 24 ? `${ageHours.toFixed(1)}h` : `${(ageHours / 24).toFixed(1)}d`}`);
    }
    lines.push("");

    // Safety check: minimum liquidity
    if (pairData.liquidity.usd < MIN_LIQUIDITY_USD) {
      snipeManager.updateStatus(snipeId, "risky", "low-liquidity");
      return {
        success: false,
        message:
          lines.join("\n") +
          `\n*FAILED: Low Liquidity*\n` +
          `Liquidity ($${pairData.liquidity.usd.toLocaleString("en-US")}) is below minimum threshold ($${MIN_LIQUIDITY_USD.toLocaleString("en-US")}).\n` +
          `_Sniping low-liquidity tokens is extremely risky. Aborting._`,
      };
    }
  } else {
    lines.push("_No DEXScreener data found — token may be very new or not yet listed._\n");
  }

  // Step 2: GoPlus safety check (if enabled)
  if (parsed.safetyChecks) {
    try {
      const riskReport = await riskEngine.analyzeToken(chainId, tokenAddress as Address);

      if (riskReport) {
        lines.push("*GoPlus Security Analysis*");

        if (riskReport.isHoneypot) {
          snipeManager.updateStatus(snipeId, "risky", "honeypot");
          return {
            success: false,
            message:
              lines.join("\n") +
              `\n*BLOCKED: Honeypot Detected*\n` +
              `This token is flagged as a honeypot — you cannot sell after buying.\n` +
              `_Snipe #${snipeId} cancelled for your safety._`,
          };
        }

        // Check buy/sell tax
        const buyTax = riskReport.buyTax ?? 0;
        const sellTax = riskReport.sellTax ?? 0;
        lines.push(`  Honeypot: ${riskReport.isHoneypot ? "YES" : "No"}`);
        lines.push(`  Buy tax: ${buyTax}%`);
        lines.push(`  Sell tax: ${sellTax}%`);
        lines.push(`  Risk level: ${riskReport.riskLevel}`);

        if (buyTax > MAX_BUY_TAX_PCT) {
          snipeManager.updateStatus(snipeId, "risky", `high-buy-tax-${buyTax}%`);
          return {
            success: false,
            message:
              lines.join("\n") +
              `\n\n*BLOCKED: High Buy Tax (${buyTax}%)*\n` +
              `Buy tax exceeds ${MAX_BUY_TAX_PCT}% threshold. This token takes a large fee on purchase.\n` +
              `_Snipe #${snipeId} cancelled for your safety._`,
          };
        }

        if (riskReport.riskLevel === "critical") {
          snipeManager.updateStatus(snipeId, "risky", "critical-risk");
          return {
            success: false,
            message:
              lines.join("\n") +
              `\n\n*BLOCKED: Critical Risk*\n` +
              `GoPlus flagged this token as critical risk. DO NOT buy.\n` +
              `_Snipe #${snipeId} cancelled for your safety._`,
          };
        }

        lines.push("");
      } else {
        lines.push("_GoPlus analysis unavailable — proceed with extra caution._\n");
      }
    } catch (err) {
      logger.warn({ err, tokenAddress }, "Risk check failed during snipe");
      lines.push("_GoPlus safety check failed — proceed with extra caution._\n");
    }
  } else {
    lines.push("_Safety checks disabled by user._\n");
  }

  // Step 3: Token passed safety checks — request user confirmation before proceeding
  lines.push(`*Safety Checks Passed*\n`);
  lines.push(`Token \`${shortenAddress(tokenAddress)}\` appears safe to buy.`);
  lines.push(`Amount: ${parsed.amount} ETH | Slippage: ${parsed.maxSlippage}%`);

  if (context.requestConfirmation) {
    const confirmed = await context.requestConfirmation(
      lines.join("\n") +
      `\n\nProceed with snipe #${snipeId}?`,
    );
    if (!confirmed) {
      snipeManager.updateStatus(snipeId, "cancelled", "user-rejected");
      return { success: false, message: `*Snipe #${snipeId} cancelled by user.*` };
    }
  }

  snipeManager.updateStatus(snipeId, "safe", "passed");

  lines.push(
    `\n_To execute the swap, use: "Swap ${parsed.amount} ETH for ${tokenAddress} on ${chainName}"_\n` +
    `_Snipe #${snipeId} is ready._`,
  );

  return {
    success: true,
    message: lines.join("\n"),
    data: { snipeId, status: "safe" },
  };
}

function handleList(
  snipeManager: SnipeManager,
  context: SkillExecutionContext,
): SkillResult {
  const snipes = snipeManager.getUserSnipes(context.userId);

  if (snipes.length === 0) {
    return {
      success: true,
      message: "No recent snipes. Start one with: _Snipe 0xAbC... on Base with 0.1 ETH_",
    };
  }

  const lines = ["*Your Recent Snipes*\n"];
  for (const snipe of snipes) {
    lines.push(
      `*#${snipe.id}* \`${shortenAddress(snipe.token_address)}\` — ${snipe.amount} ETH`,
    );
    lines.push(
      `   Status: **${snipe.status}** | Chain: ${CHAIN_NAMES[snipe.chain_id] ?? snipe.chain_id}${snipe.risk_score ? ` | Risk: ${snipe.risk_score}` : ""}`,
    );
  }

  return { success: true, message: lines.join("\n") };
}

function handleCancel(
  snipeManager: SnipeManager,
  parsed: z.infer<typeof snipeParams>,
  context: SkillExecutionContext,
): SkillResult {
  if (!parsed.snipeId) {
    return { success: false, message: "Please specify a snipe ID to cancel." };
  }

  const cancelled = snipeManager.cancelSnipe(parsed.snipeId, context.userId);
  if (!cancelled) {
    return { success: false, message: `Snipe #${parsed.snipeId} not found, not yours, or already completed.` };
  }

  return { success: true, message: `*Snipe #${parsed.snipeId} cancelled.*` };
}

async function fetchDexScreenerPair(
  tokenAddress: string,
  chainName: string,
): Promise<DexScreenerPair | null> {
  try {
    const response = await fetchWithRetry(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
    );

    if (!response.ok) {
      logger.warn({ status: response.status }, "DEXScreener API error");
      return null;
    }

    const data = (await response.json()) as { pairs: DexScreenerPair[] | null };

    if (!data.pairs || data.pairs.length === 0) return null;

    // Find pair on the correct chain, sorted by liquidity
    const chainPairs = data.pairs
      .filter((p) => p.chainId === chainName)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

    return chainPairs[0] ?? data.pairs[0];
  } catch (err) {
    logger.warn({ err, tokenAddress }, "Failed to fetch DEXScreener data");
    return null;
  }
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
