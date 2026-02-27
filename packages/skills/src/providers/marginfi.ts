import { getLogger } from "@chainclaw/core";
import {
  Connection,
  PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";

const logger = getLogger("marginfi");

// MarginFi V2 program addresses
const MARGINFI_PROGRAM_ID = new PublicKey("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const MARGINFI_GROUP = new PublicKey("4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFkQ7m8pRH");

// Supported tokens on MarginFi with their bank addresses
const MARGINFI_BANKS: Record<string, { bank: string; mint: string; decimals: number }> = {
  SOL: { bank: "CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh", mint: "So11111111111111111111111111111111111111112", decimals: 9 },
  USDC: { bank: "2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  USDT: { bank: "HmpMfL8942u22htC4EMiWgLX931g3sacXFR6KjuLgKLV", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  MSOL: { bank: "3fGK3aSaJtC12xXMuitRuFcbyPEMnBHq2sdNYuVmobx3", mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", decimals: 9 },
  JITOSOL: { bank: "Bohoc1ikHLD7xKJuzTyiTyCwzaL5N7ixBKSzNrXNLwCB", mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", decimals: 9 },
};

// ─── Types ──────────────────────────────────────────────────

export interface MarginFiPosition {
  account: string;
  balances: Array<{
    token: string;
    supplied: number;
    borrowed: number;
  }>;
  healthFactor: number;
}

// ─── Position Query ─────────────────────────────────────────

/**
 * Get a user's MarginFi lending position.
 * Uses the MarginFi API for simplified position querying.
 */
export async function getMarginFiPosition(
  owner: string,
  rpcUrl: string,
): Promise<MarginFiPosition | null> {
  try {
    // Query MarginFi accounts owned by the user
    const connection = new Connection(rpcUrl, "confirmed");
    const ownerPubkey = new PublicKey(owner);

    const accounts = await connection.getProgramAccounts(MARGINFI_PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 8 + 32, bytes: ownerPubkey.toBase58() } }, // authority offset
        { memcmp: { offset: 8, bytes: MARGINFI_GROUP.toBase58() } }, // group offset
      ],
    });

    if (accounts.length === 0) {
      return null;
    }

    // For now, return a simplified position
    // Full deserialization would require the MarginFi IDL
    return {
      account: accounts[0].pubkey.toBase58(),
      balances: [],
      healthFactor: 0,
    };
  } catch (err) {
    logger.error({ err, owner }, "Failed to fetch MarginFi position");
    return null;
  }
}

/**
 * Build MarginFi supply instructions.
 * Note: Full implementation requires the MarginFi SDK for proper
 * account derivation. This is a simplified version that builds
 * the basic instruction layout.
 */
export async function buildSupplyInstructions(
  owner: string,
  token: string,
  amount: bigint,
  _rpcUrl: string,
): Promise<TransactionInstruction[] | null> {
  const bankInfo = MARGINFI_BANKS[token.toUpperCase()];
  if (!bankInfo) {
    logger.warn({ token }, "Unsupported MarginFi token");
    return null;
  }

  // For a complete implementation, we would need to:
  // 1. Find or create the user's MarginFi account
  // 2. Build the deposit instruction with proper accounts
  // 3. Handle token account creation if needed
  //
  // This requires the MarginFi IDL and proper account derivation.
  // For now, log that we need the SDK and return null.
  logger.info({ owner, token, amount: amount.toString() }, "MarginFi supply — requires SDK for full implementation");
  return null;
}

/**
 * Build MarginFi withdraw instructions.
 */
export async function buildWithdrawInstructions(
  owner: string,
  token: string,
  amount: bigint,
  _rpcUrl: string,
): Promise<TransactionInstruction[] | null> {
  const bankInfo = MARGINFI_BANKS[token.toUpperCase()];
  if (!bankInfo) {
    logger.warn({ token }, "Unsupported MarginFi token");
    return null;
  }

  logger.info({ owner, token, amount: amount.toString() }, "MarginFi withdraw — requires SDK for full implementation");
  return null;
}

/**
 * Build MarginFi borrow instructions.
 */
export async function buildBorrowInstructions(
  owner: string,
  token: string,
  amount: bigint,
  _rpcUrl: string,
): Promise<TransactionInstruction[] | null> {
  const bankInfo = MARGINFI_BANKS[token.toUpperCase()];
  if (!bankInfo) {
    logger.warn({ token }, "Unsupported MarginFi token");
    return null;
  }

  logger.info({ owner, token, amount: amount.toString() }, "MarginFi borrow — requires SDK for full implementation");
  return null;
}

/**
 * Build MarginFi repay instructions.
 */
export async function buildRepayInstructions(
  owner: string,
  token: string,
  amount: bigint,
  _rpcUrl: string,
): Promise<TransactionInstruction[] | null> {
  const bankInfo = MARGINFI_BANKS[token.toUpperCase()];
  if (!bankInfo) {
    logger.warn({ token }, "Unsupported MarginFi token");
    return null;
  }

  logger.info({ owner, token, amount: amount.toString() }, "MarginFi repay — requires SDK for full implementation");
  return null;
}

/**
 * Get the list of supported tokens on MarginFi.
 */
export function getSupportedTokens(): string[] {
  return Object.keys(MARGINFI_BANKS);
}

/**
 * Format a MarginFi position for user display.
 */
export function formatPosition(position: MarginFiPosition): string {
  if (position.balances.length === 0) {
    return `*MarginFi Position*\n\nAccount: \`${position.account}\`\nNo active balances.`;
  }

  const lines = [
    `*MarginFi Position*`,
    ``,
    `Account: \`${position.account}\``,
    `Health Factor: ${position.healthFactor.toFixed(2)}`,
    ``,
  ];

  for (const b of position.balances) {
    if (b.supplied > 0) lines.push(`  Supplied: ${b.supplied} ${b.token}`);
    if (b.borrowed > 0) lines.push(`  Borrowed: ${b.borrowed} ${b.token}`);
  }

  return lines.join("\n");
}
