import { z } from "zod";
import { type Address, type Hex } from "viem";
import type Database from "better-sqlite3";
import { getLogger, type SkillResult } from "@chainclaw/core";
import type { TransactionExecutor } from "@chainclaw/pipeline";
import type { WalletManager } from "@chainclaw/wallet";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";
import type { PrivacyProvider, ShieldedBalance } from "./privacy-types.js";
import { getEthPriceUsd } from "./prices.js";
import { resolveToken, getChainName } from "./token-addresses.js";

const logger = getLogger("skill-privacy");

const privacyParams = z.object({
  action: z.enum(["deposit", "withdraw", "balance", "history"]),
  // Deposit / withdraw params
  token: z.string().optional(),
  amount: z.string().optional(),
  chainId: z.number().optional().default(1),
  // Withdraw-specific (accepts 0x address or ENS name)
  recipientAddress: z.string().optional(),
  // History params
  limit: z.number().min(1).max(100).optional().default(20),
  offset: z.number().min(0).optional().default(0),
});

// ─── DB Row Interfaces ────────────────────────────────────────

interface DepositRow {
  id: number;
  user_id: string;
  chain_id: number;
  token: string;
  amount: string;
  tx_hash: string | null;
  note_commitment: string;
  status: string;
  provider: string;
  created_at: string;
}

interface WithdrawalRow {
  id: number;
  user_id: string;
  chain_id: number;
  token: string;
  amount: string;
  tx_hash: string | null;
  recipient_address: string;
  nullifier_hash: string;
  status: string;
  provider: string;
  created_at: string;
}

// ─── Privacy Engine ───────────────────────────────────────────

export class PrivacyEngine {
  constructor(
    private db: Database.Database,
    private provider: PrivacyProvider,
  ) {
    this.initTable();
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS privacy_deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        token TEXT NOT NULL,
        amount TEXT NOT NULL,
        tx_hash TEXT,
        note_commitment TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'spent')),
        provider TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_priv_deposits_user ON privacy_deposits(user_id);
      CREATE INDEX IF NOT EXISTS idx_priv_deposits_status ON privacy_deposits(status);

      CREATE TABLE IF NOT EXISTS privacy_withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        token TEXT NOT NULL,
        amount TEXT NOT NULL,
        tx_hash TEXT,
        recipient_address TEXT NOT NULL,
        nullifier_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'failed')),
        provider TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_priv_withdrawals_user ON privacy_withdrawals(user_id);
    `);

    logger.debug("Privacy tables initialized");
  }

  getProvider(): PrivacyProvider {
    return this.provider;
  }

  /**
   * Ensure provider is initialized. Lazy-loads artifacts on first call.
   * Returns an error message if init fails, or null on success.
   */
  async ensureInitialized(sendProgress?: (msg: string) => Promise<void>): Promise<string | null> {
    if (this.provider.isInitialized()) return null;

    try {
      await this.provider.init((msg) => {
        logger.info({ provider: this.provider.name }, msg);
        if (sendProgress) void sendProgress(`_${msg}_`);
      });
      return null;
    } catch (err) {
      logger.error({ err }, "Privacy provider init failed");
      return err instanceof Error ? err.message : "Privacy provider initialization failed";
    }
  }

  // ─── Deposit Tracking ────────────────────────────────────────

  recordDeposit(
    userId: string,
    chainId: number,
    token: string,
    amount: string,
    noteCommitment: string,
  ): number {
    const result = this.db.prepare(`
      INSERT INTO privacy_deposits (user_id, chain_id, token, amount, note_commitment, provider)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, chainId, token.toUpperCase(), amount, noteCommitment, this.provider.name);
    return Number(result.lastInsertRowid);
  }

  confirmDeposit(depositId: number, txHash: string): void {
    this.db.prepare(
      "UPDATE privacy_deposits SET status = 'confirmed', tx_hash = ? WHERE id = ?",
    ).run(txHash, depositId);
  }

  failDeposit(depositId: number): void {
    this.db.prepare(
      "DELETE FROM privacy_deposits WHERE id = ? AND status = 'pending'",
    ).run(depositId);
  }

  // ─── Withdrawal Tracking ─────────────────────────────────────

  recordWithdrawal(
    userId: string,
    chainId: number,
    token: string,
    amount: string,
    recipientAddress: string,
    nullifierHash: string,
  ): number {
    const result = this.db.prepare(`
      INSERT INTO privacy_withdrawals (user_id, chain_id, token, amount, recipient_address, nullifier_hash, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, chainId, token.toUpperCase(), amount, recipientAddress, nullifierHash, this.provider.name);
    return Number(result.lastInsertRowid);
  }

  confirmWithdrawal(withdrawalId: number, txHash: string): void {
    this.db.prepare(
      "UPDATE privacy_withdrawals SET status = 'confirmed', tx_hash = ? WHERE id = ?",
    ).run(txHash, withdrawalId);
  }

  failWithdrawal(withdrawalId: number): void {
    this.db.prepare(
      "UPDATE privacy_withdrawals SET status = 'failed' WHERE id = ?",
    ).run(withdrawalId);
  }

  // ─── History Queries ─────────────────────────────────────────

  getUserDeposits(userId: string, limit = 20, offset = 0): DepositRow[] {
    return this.db.prepare(
      "SELECT * FROM privacy_deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    ).all(userId, limit, offset) as DepositRow[];
  }

  getUserWithdrawals(userId: string, limit = 20, offset = 0): WithdrawalRow[] {
    return this.db.prepare(
      "SELECT * FROM privacy_withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    ).all(userId, limit, offset) as WithdrawalRow[];
  }
}

// ─── Action Handlers ──────────────────────────────────────────

async function handleDeposit(
  engine: PrivacyEngine,
  executor: TransactionExecutor,
  walletManager: WalletManager,
  parsed: z.infer<typeof privacyParams>,
  context: SkillExecutionContext,
): Promise<SkillResult> {
  const { token, amount, chainId } = parsed;

  if (!token || !amount) {
    return { success: false, message: "Missing required fields: token, amount" };
  }

  const provider = engine.getProvider();

  // Validate chain support
  if (!provider.supportedChains.includes(chainId)) {
    return {
      success: false,
      message: `${provider.name} does not support ${getChainName(chainId)}. Supported: ${provider.supportedChains.map(getChainName).join(", ")}`,
    };
  }

  // Resolve token
  const tokenUpper = token.toUpperCase();
  const tokenInfo = resolveToken(chainId, tokenUpper);
  if (!tokenInfo) {
    return { success: false, message: `${tokenUpper} is not supported on ${getChainName(chainId)}.` };
  }

  // Initialize provider (lazy)
  const initError = await engine.ensureInitialized(context.sendReply);
  if (initError) return { success: false, message: initError };

  await context.sendReply(
    `_Preparing privacy deposit: ${amount} ${tokenUpper} on ${getChainName(chainId)} via ${provider.name}..._`,
  );

  // Get private key for note encryption (needed by zk-privacy providers)
  const privateKey = walletManager.getPrivateKey(context.walletAddress!);

  // Build deposit transactions from provider
  let depositResult;
  try {
    depositResult = await provider.deposit({
      walletAddress: context.walletAddress!,
      privateKey,
      token: tokenUpper,
      tokenAddress: tokenInfo.address,
      decimals: tokenInfo.decimals,
      amount,
      chainId,
    });
  } catch (err) {
    logger.error({ err }, "Provider deposit failed");
    return { success: false, message: `Privacy deposit failed: ${err instanceof Error ? err.message : "Unknown error"}` };
  }

  // Record deposit before execution
  const depositId = engine.recordDeposit(
    context.userId,
    chainId,
    tokenUpper,
    amount,
    depositResult.noteCommitment,
  );

  // Execute each transaction through the pipeline
  const signer = walletManager.getSigner(context.walletAddress!);
  const ethPrice = await getEthPriceUsd();
  let lastHash: string | undefined;

  for (let i = 0; i < depositResult.transactions.length; i++) {
    const tx = depositResult.transactions[i];
    const stepLabel = depositResult.transactions.length > 1
      ? ` (step ${i + 1}/${depositResult.transactions.length}: ${tx.description})`
      : "";

    await context.sendReply(`_Executing${stepLabel}..._`);

    const result = await executor.execute(
      {
        chainId,
        from: context.walletAddress! as Address,
        to: tx.to as Address,
        value: BigInt(tx.value),
        data: tx.data as Hex,
        gasLimit: BigInt(tx.gasEstimate),
      },
      signer,
      {
        userId: context.userId,
        skillName: "privacy",
        intentDescription: `Privacy deposit ${amount} ${tokenUpper}${stepLabel}`,
        ethPriceUsd: ethPrice,
      },
      {
        onSimulated: async (_sim, preview) => {
          await context.sendReply(preview);
        },
        onRiskWarning: context.requestConfirmation
          ? async (warning) => context.requestConfirmation!(`*Risk Warning*\n\n${warning}\n\nProceed?`)
          : undefined,
        onConfirmationRequired: context.requestConfirmation
          ? async (preview) => context.requestConfirmation!(`*Confirm Privacy Deposit*\n\n${preview}\n\nApprove?`)
          : undefined,
        onBroadcast: async (hash) => {
          await context.sendReply(`Transaction broadcast: \`${hash}\``);
        },
        onConfirmed: async (hash, blockNumber) => {
          lastHash = hash;
          await context.sendReply(`Confirmed in block ${blockNumber}`);
        },
        onFailed: async (error) => {
          await context.sendReply(`Failed: ${error}`);
        },
      },
    );

    if (!result.success) {
      engine.failDeposit(depositId);
      return { success: false, message: `Privacy deposit failed${stepLabel}: ${result.message}` };
    }

    // Track the last successful tx hash
    if (result.hash) lastHash = result.hash;
  }

  // Mark deposit as confirmed using the last successful tx hash
  engine.confirmDeposit(depositId, lastHash ?? "unknown");

  return {
    success: true,
    message:
      `*Privacy Deposit Complete*\n\n` +
      `${amount} ${tokenUpper} shielded on ${getChainName(chainId)} via ${provider.name}\n` +
      `Deposit ID: #${depositId}` +
      (lastHash ? `\nTx: \`${lastHash}\`` : ""),
    data: { depositId, noteCommitment: depositResult.noteCommitment },
  };
}

async function handleWithdraw(
  engine: PrivacyEngine,
  executor: TransactionExecutor,
  walletManager: WalletManager,
  parsed: z.infer<typeof privacyParams>,
  context: SkillExecutionContext,
): Promise<SkillResult> {
  const { token, amount, chainId } = parsed;
  let recipientAddress = parsed.recipientAddress ?? context.walletAddress!;

  if (!token || !amount) {
    return { success: false, message: "Missing required fields: token, amount" };
  }

  // Resolve ENS name if needed
  if (!/^0x[a-fA-F0-9]{40}$/i.test(recipientAddress)) {
    if (!context.resolveAddress) {
      return { success: false, message: "Invalid recipient address. Provide a 0x address or ENS name." };
    }
    try {
      const resolved = await context.resolveAddress(recipientAddress);
      await context.sendReply(`_Resolved ${recipientAddress} → \`${resolved.slice(0, 6)}...${resolved.slice(-4)}\`_`);
      recipientAddress = resolved;
    } catch (err) {
      return { success: false, message: `Could not resolve '${recipientAddress}': ${err instanceof Error ? err.message : "Unknown error"}` };
    }
  }

  const provider = engine.getProvider();

  if (!provider.supportedChains.includes(chainId)) {
    return {
      success: false,
      message: `${provider.name} does not support ${getChainName(chainId)}.`,
    };
  }

  const tokenUpper = token.toUpperCase();
  const tokenInfo = resolveToken(chainId, tokenUpper);
  if (!tokenInfo) {
    return { success: false, message: `${tokenUpper} is not supported on ${getChainName(chainId)}.` };
  }

  const initError = await engine.ensureInitialized(context.sendReply);
  if (initError) return { success: false, message: initError };

  await context.sendReply(
    `_Preparing privacy withdrawal: ${amount} ${tokenUpper} to ${recipientAddress.slice(0, 6)}...${recipientAddress.slice(-4)} via ${provider.name}..._\n` +
    `_Generating zero-knowledge proof (this may take a moment)..._`,
  );

  // Get private key for zk-proof generation (needed by privacy providers)
  const privateKey = walletManager.getPrivateKey(context.walletAddress!);

  let withdrawResult;
  try {
    withdrawResult = await provider.withdraw({
      walletAddress: context.walletAddress!,
      privateKey,
      token: tokenUpper,
      tokenAddress: tokenInfo.address,
      decimals: tokenInfo.decimals,
      amount,
      chainId,
      recipientAddress,
    });
  } catch (err) {
    logger.error({ err }, "Provider withdraw failed");
    return { success: false, message: `Privacy withdrawal failed: ${err instanceof Error ? err.message : "Unknown error"}` };
  }

  // Record withdrawal before execution
  const withdrawalId = engine.recordWithdrawal(
    context.userId,
    chainId,
    tokenUpper,
    amount,
    recipientAddress,
    withdrawResult.nullifierHash,
  );

  // Execute through pipeline
  const signer = walletManager.getSigner(context.walletAddress!);
  const ethPrice = await getEthPriceUsd();
  const tx = withdrawResult.transaction;

  const result = await executor.execute(
    {
      chainId,
      from: context.walletAddress! as Address,
      to: tx.to as Address,
      value: BigInt(tx.value),
      data: tx.data as Hex,
      gasLimit: BigInt(tx.gasEstimate),
    },
    signer,
    {
      userId: context.userId,
      skillName: "privacy",
      intentDescription: `Privacy withdraw ${amount} ${tokenUpper} to ${recipientAddress.slice(0, 6)}...`,
      ethPriceUsd: ethPrice,
    },
    {
      onSimulated: async (_sim, preview) => {
        await context.sendReply(preview);
      },
      onRiskWarning: context.requestConfirmation
        ? async (warning) => context.requestConfirmation!(`*Risk Warning*\n\n${warning}\n\nProceed?`)
        : undefined,
      onConfirmationRequired: context.requestConfirmation
        ? async (preview) => context.requestConfirmation!(`*Confirm Privacy Withdrawal*\n\n${preview}\n\nApprove?`)
        : undefined,
      onBroadcast: async (hash) => {
        await context.sendReply(`Transaction broadcast: \`${hash}\``);
      },
      onConfirmed: async (hash, blockNumber) => {
        engine.confirmWithdrawal(withdrawalId, hash);
        await context.sendReply(
          `*Privacy Withdrawal Complete*\n\n` +
          `${amount} ${tokenUpper} unshielded to ${recipientAddress.slice(0, 6)}...${recipientAddress.slice(-4)}\n` +
          `Block: ${blockNumber}\nTx: \`${hash}\``,
        );
      },
      onFailed: async (error) => {
        engine.failWithdrawal(withdrawalId);
        await context.sendReply(`Withdrawal failed: ${error}`);
      },
    },
  );

  if (!result.success) {
    engine.failWithdrawal(withdrawalId);
    return { success: false, message: `Privacy withdrawal failed: ${result.message}` };
  }

  return {
    success: true,
    message:
      `*Privacy Withdrawal Complete*\n\n` +
      `${amount} ${tokenUpper} unshielded on ${getChainName(chainId)} via ${provider.name}\n` +
      `Recipient: ${recipientAddress.slice(0, 6)}...${recipientAddress.slice(-4)}\n` +
      `Withdrawal ID: #${withdrawalId}`,
    data: { withdrawalId, nullifierHash: withdrawResult.nullifierHash },
  };
}

async function handleBalance(
  engine: PrivacyEngine,
  walletManager: WalletManager,
  parsed: z.infer<typeof privacyParams>,
  context: SkillExecutionContext,
): Promise<SkillResult> {
  const provider = engine.getProvider();
  const { chainId } = parsed;

  if (!provider.supportedChains.includes(chainId)) {
    return {
      success: false,
      message: `${provider.name} does not support ${getChainName(chainId)}.`,
    };
  }

  const initError = await engine.ensureInitialized(context.sendReply);
  if (initError) return { success: false, message: initError };

  await context.sendReply(`_Scanning shielded balances on ${getChainName(chainId)}..._`);

  const privateKey = walletManager.getPrivateKey(context.walletAddress!);

  let balances: ShieldedBalance[];
  try {
    balances = await provider.getShieldedBalance(context.walletAddress!, privateKey, chainId);
  } catch (err) {
    logger.error({ err }, "Balance query failed");
    return { success: false, message: `Balance query failed: ${err instanceof Error ? err.message : "Unknown error"}` };
  }

  if (balances.length === 0) {
    return { success: true, message: `No shielded balances on ${getChainName(chainId)} via ${provider.name}.` };
  }

  const lines = balances.map(
    (b) => `${b.amount} ${b.token}`,
  );

  return {
    success: true,
    message:
      `*Shielded Balances* (${getChainName(chainId)} via ${provider.name})\n\n` +
      lines.join("\n"),
    data: balances,
  };
}

function handleHistory(
  engine: PrivacyEngine,
  parsed: z.infer<typeof privacyParams>,
  context: SkillExecutionContext,
): SkillResult {
  const deposits = engine.getUserDeposits(context.userId, parsed.limit, parsed.offset);
  const withdrawals = engine.getUserWithdrawals(context.userId, parsed.limit, parsed.offset);

  if (deposits.length === 0 && withdrawals.length === 0) {
    return { success: true, message: "No privacy transaction history." };
  }

  const lines: string[] = [];

  if (deposits.length > 0) {
    lines.push("*Deposits:*");
    for (const d of deposits) {
      const hash = d.tx_hash ? ` \`${d.tx_hash.slice(0, 10)}...\`` : "";
      lines.push(`  #${d.id} Shield ${d.amount} ${d.token} on ${getChainName(d.chain_id)} [${d.status}]${hash}`);
    }
  }

  if (withdrawals.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("*Withdrawals:*");
    for (const w of withdrawals) {
      const hash = w.tx_hash ? ` \`${w.tx_hash.slice(0, 10)}...\`` : "";
      lines.push(`  #${w.id} Unshield ${w.amount} ${w.token} → ${w.recipient_address.slice(0, 6)}...${w.recipient_address.slice(-4)} [${w.status}]${hash}`);
    }
  }

  return {
    success: true,
    message: `*Privacy History*\n\n${lines.join("\n")}`,
    data: { deposits, withdrawals },
  };
}

// ─── Skill Factory ──────────────────────────────────────────────

export function createPrivacySkill(
  engine: PrivacyEngine,
  executor: TransactionExecutor,
  walletManager: WalletManager,
): SkillDefinition {
  return {
    name: "privacy",
    description:
      "Shield and unshield tokens via privacy pools. Deposit to make tokens private, withdraw to any address without linking to your wallet.",
    parameters: privacyParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = privacyParams.parse(params);

      if (!context.walletAddress) {
        return { success: false, message: "No wallet configured. Use /wallet create first." };
      }

      switch (parsed.action) {
        case "deposit":
          return handleDeposit(engine, executor, walletManager, parsed, context);

        case "withdraw":
          return handleWithdraw(engine, executor, walletManager, parsed, context);

        case "balance":
          return handleBalance(engine, walletManager, parsed, context);

        case "history":
          return handleHistory(engine, parsed, context);

        default:
          return { success: false, message: `Unknown action: ${parsed.action as string}` };
      }
    },
  };
}
