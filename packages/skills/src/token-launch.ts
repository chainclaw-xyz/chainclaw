import { z } from "zod";
import type Database from "better-sqlite3";
import { getLogger, type SkillResult } from "@chainclaw/core";
import type { SolanaTransactionExecutor } from "@chainclaw/pipeline";
import type { WalletManager } from "@chainclaw/wallet";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";
import type { TokenLaunchProvider, LaunchParams } from "./token-launch-types.js";

const logger = getLogger("skill-token-launch");

// ─── DB Row Interface ─────────────────────────────────────────

interface LaunchRow {
  id: number;
  user_id: string;
  chain_id: number;
  name: string;
  symbol: string;
  token_address: string | null;
  tx_hash: string | null;
  status: string;
  provider: string;
  created_at: string;
}

// ─── Token Launch Engine ──────────────────────────────────────

export class TokenLaunchEngine {
  private providerMap: Map<number, TokenLaunchProvider> = new Map();

  constructor(
    private db: Database.Database,
    providers: TokenLaunchProvider[],
  ) {
    this.initTable();
    for (const provider of providers) {
      for (const chainId of provider.supportedChains) {
        this.providerMap.set(chainId, provider);
      }
    }
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS token_launches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        token_address TEXT,
        tx_hash TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'failed')),
        provider TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_token_launches_user ON token_launches(user_id);
      CREATE INDEX IF NOT EXISTS idx_token_launches_status ON token_launches(status);
    `);
    logger.debug("Token launch table initialized");
  }

  getProvider(chainId: number): TokenLaunchProvider | undefined {
    return this.providerMap.get(chainId);
  }

  getSupportedChains(): number[] {
    return [...this.providerMap.keys()];
  }

  recordLaunch(
    userId: string,
    chainId: number,
    name: string,
    symbol: string,
    providerName: string,
  ): number {
    const result = this.db
      .prepare(
        `INSERT INTO token_launches (user_id, chain_id, name, symbol, provider)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(userId, chainId, name, symbol, providerName);
    return result.lastInsertRowid as number;
  }

  confirmLaunch(id: number, tokenAddress: string, txHash?: string): void {
    this.db
      .prepare(
        `UPDATE token_launches SET status = 'confirmed', token_address = ?, tx_hash = ? WHERE id = ?`,
      )
      .run(tokenAddress, txHash ?? null, id);
  }

  failLaunch(id: number): void {
    this.db.prepare(`UPDATE token_launches SET status = 'failed' WHERE id = ?`).run(id);
  }

  getUserLaunches(userId: string, limit = 20, offset = 0): LaunchRow[] {
    return this.db
      .prepare(
        `SELECT * FROM token_launches WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(userId, limit, offset) as LaunchRow[];
  }
}

// ─── Skill Parameters ─────────────────────────────────────────

const tokenLaunchParams = z.object({
  action: z.enum(["launch", "list"]).default("launch"),
  name: z.string().min(1).max(64).optional(),
  symbol: z.string().min(1).max(10).optional(),
  description: z.string().max(500).optional(),
  imageUrl: z.string().url().optional(),
  twitter: z.string().optional(),
  telegram: z.string().optional(),
  website: z.string().optional(),
  chainId: z.number().optional().default(8453),
  initialBuySol: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Must be a positive number (e.g. '0.1')")
    .optional()
    .default("0.1"),
  limit: z.number().min(1).max(100).optional().default(20),
  offset: z.number().min(0).optional().default(0),
});

// Escape Telegram MarkdownV2 special chars that appear in provider names
function escapeMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

// ─── Skill Factory ────────────────────────────────────────────

export function createTokenLaunchSkill(
  engine: TokenLaunchEngine,
  walletManager: WalletManager,
  solanaExecutor?: SolanaTransactionExecutor,
): SkillDefinition {
  return {
    name: "token-launch",
    description:
      "Launch a new token on a launchpad. Supports pump.fun (Solana, chainId 900) and Clanker (Base/Unichain/Arbitrum). Provide a name, symbol, and chainId.",
    parameters: tokenLaunchParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = tokenLaunchParams.parse(params);

      if (parsed.action === "list") {
        return handleList(engine, context, parsed.limit, parsed.offset);
      }

      return handleLaunch(parsed, engine, walletManager, solanaExecutor, context);
    },
  };
}

// ─── Action: list ─────────────────────────────────────────────

function handleList(
  engine: TokenLaunchEngine,
  context: SkillExecutionContext,
  limit: number,
  offset: number,
): SkillResult {
  const rows = engine.getUserLaunches(context.userId, limit, offset);

  if (rows.length === 0) {
    return { success: true, message: "No token launches found. Use 'launch' to create your first token." };
  }

  const lines = rows.map((r) => {
    const addr = r.token_address
      ? `\`${r.token_address.slice(0, 8)}...${r.token_address.slice(-6)}\``
      : "pending";
    return `• *${r.name}* (${r.symbol}) — ${addr} — ${r.status} — ${r.provider} — ${r.created_at.slice(0, 10)}`;
  });

  return {
    success: true,
    message: ["*Your Token Launches*", "", ...lines].join("\n"),
  };
}

// ─── Action: launch ───────────────────────────────────────────

async function handleLaunch(
  parsed: z.infer<typeof tokenLaunchParams>,
  engine: TokenLaunchEngine,
  walletManager: WalletManager,
  solanaExecutor: SolanaTransactionExecutor | undefined,
  context: SkillExecutionContext,
): Promise<SkillResult> {
  const { name, symbol, description, imageUrl, twitter, telegram, website, chainId, initialBuySol } = parsed;

  if (!name || !symbol) {
    return { success: false, message: "Please provide both a token name and symbol." };
  }

  const provider = engine.getProvider(chainId);
  if (!provider) {
    const supported = engine
      .getSupportedChains()
      .map((id) => {
        const p = engine.getProvider(id);
        return `chainId ${id} (${p?.name ?? "unknown"})`;
      })
      .join(", ");
    return {
      success: false,
      message: `No launch provider available for chainId ${chainId}. Supported: ${supported}`,
    };
  }

  const walletAddress = context.walletAddress;
  if (!walletAddress) {
    return { success: false, message: "No wallet configured. Use /wallet create to get started." };
  }

  // Solana (pump.fun) requires a Solana wallet (base58 public key), not an EVM 0x address.
  const isSolana = chainId === 900;
  if (isSolana && walletAddress.startsWith("0x")) {
    return {
      success: false,
      message:
        "pump.fun requires a Solana wallet. Your current default wallet is an EVM address. " +
        "Create or import a Solana wallet and set it as default first.",
    };
  }

  let privateKey: string;

  try {
    if (isSolana) {
      // For Solana, validate wallet accessibility via getSolanaSigner (which decrypts the keypair).
      // The signer is retrieved again later before broadcasting; this is just a pre-flight check.
      // getPrivateKey() is not appropriate here — Solana keys are 64-byte hex, not EVM 32-byte.
      walletManager.getSolanaSigner(walletAddress);
      privateKey = "";
    } else {
      // For EVM providers, getPrivateKey validates the wallet and may be used for signing.
      privateKey = walletManager.getPrivateKey(walletAddress);
    }
  } catch {
    return { success: false, message: "Could not access wallet. Ensure the wallet is unlocked and properly configured." };
  }

  await context.sendReply(
    `_Launching *${name}* (${symbol}) via ${provider.name} on chainId ${chainId}…_`,
  );

  const launchId = engine.recordLaunch(context.userId, chainId, name, symbol, provider.name);

  const launchParams: LaunchParams = {
    name,
    symbol,
    description,
    imageUrl,
    twitter,
    telegram,
    website,
    chainId,
    initialBuySol,
  };

  try {
    const result = await provider.launch(launchParams, walletAddress, privateKey);

    // pump.fun providers set result.signedTx — broadcast via solanaExecutor
    if (result.signedTx) {
      if (!solanaExecutor) {
        engine.failLaunch(launchId);
        return {
          success: false,
          message: "Solana executor not available. Set SOLANA_RPC_URL in .env to enable pump.fun launches.",
        };
      }

      const signer = walletManager.getSolanaSigner(walletAddress);
      const execResult = await solanaExecutor.executePrebuilt(
        result.signedTx,
        signer,
        {
          userId: context.userId,
          skillName: "token-launch",
          intentDescription: `Launch token ${name} (${symbol}) on pump.fun`,
        },
      );

      if (!execResult.success) {
        engine.failLaunch(launchId);
        return { success: false, message: execResult.message ?? "pump.fun transaction failed." };
      }

      engine.confirmLaunch(launchId, result.tokenAddress, execResult.txId ?? execResult.signature);

      return {
        success: true,
        message: [
          `*Token Launched on pump\\.fun*`,
          "",
          `*Name:* ${name}`,
          `*Symbol:* ${symbol}`,
          `*Mint:* \`${result.tokenAddress}\``,
          `*Tx:* \`${execResult.txId ?? execResult.signature ?? "—"}\``,
          "",
          `View on pump\\.fun: https://pump.fun/coin/${result.tokenAddress}`,
        ].join("\n"),
      };
    }

    // EVM providers (Clanker) — no tx to broadcast.
    // An empty tokenAddress means the provider returned an informational message
    // (e.g. Clanker with no API key configured) rather than actually deploying.
    if (!result.tokenAddress) {
      engine.failLaunch(launchId);
      return { success: false, message: result.message };
    }

    engine.confirmLaunch(launchId, result.tokenAddress, result.txHash);

    return {
      success: true,
      message: [
        `*Token Queued via ${escapeMd(provider.name)}*`,
        "",
        `*Name:* ${name}`,
        `*Symbol:* ${symbol}`,
        result.message,
      ].join("\n"),
    };
  } catch (err) {
    engine.failLaunch(launchId);
    logger.error({ err, name, symbol, chainId }, "Token launch failed");
    return {
      success: false,
      message: `Token launch failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
