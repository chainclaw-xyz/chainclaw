import { getLogger, fetchWithRetry } from "@chainclaw/core";

const logger = getLogger("rugcheck");

const RUGCHECK_API = "https://api.rugcheck.xyz/v1";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Types ──────────────────────────────────────────────────

export interface RugCheckReport {
  mint: string;
  tokenMeta: {
    name: string;
    symbol: string;
  };
  score: number; // 0-100+, higher = riskier
  risks: Array<{
    name: string;
    description: string;
    level: "info" | "warn" | "danger";
    score: number;
  }>;
  topHolders: Array<{
    address: string;
    pct: number;
  }>;
  markets: Array<{
    marketType: string;
    pubkey: string;
    liquidityA: string;
    liquidityB: string;
  }>;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  isToken2022: boolean;
}

export interface SolanaTokenSafetyReport {
  mint: string;
  name: string;
  symbol: string;
  riskLevel: "safe" | "warning" | "danger";
  score: number;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  topHolderPct: number;
  risks: string[];
  hasLiquidity: boolean;
}

// ─── Cache ──────────────────────────────────────────────────

const cache = new Map<string, { report: SolanaTokenSafetyReport; expiresAt: number }>();

// ─── Client ─────────────────────────────────────────────────

/**
 * Check a Solana token's safety using the RugCheck API.
 */
export async function checkSolanaToken(mint: string): Promise<SolanaTokenSafetyReport | null> {
  // Check cache
  const cached = cache.get(mint);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.report;
  }

  try {
    const response = await fetchWithRetry(
      `${RUGCHECK_API}/tokens/${mint}/report`,
      { headers: { Accept: "application/json" } },
    );

    if (!response.ok) {
      logger.warn({ status: response.status, mint }, "RugCheck API error");
      return null;
    }

    const raw = (await response.json()) as RugCheckReport;
    const report = mapToSafetyReport(raw);

    // Cache result
    cache.set(mint, { report, expiresAt: Date.now() + CACHE_TTL_MS });

    return report;
  } catch (err) {
    logger.error({ err, mint }, "Failed to check Solana token safety");
    return null;
  }
}

/**
 * Format a Solana token safety report for user display.
 */
export function formatSolanaTokenReport(report: SolanaTokenSafetyReport): string {
  const icon = report.riskLevel === "safe" ? "+" : report.riskLevel === "warning" ? "!" : "x";

  const lines = [
    `*Solana Token Safety Report*`,
    ``,
    `Token: ${report.name} (${report.symbol})`,
    `Mint: \`${report.mint}\``,
    `Risk: ${icon} ${report.riskLevel.toUpperCase()} (score: ${report.score})`,
    ``,
    `Mint authority: ${report.mintAuthorityRevoked ? "Revoked" : "ACTIVE (can mint new tokens)"}`,
    `Freeze authority: ${report.freezeAuthorityRevoked ? "Revoked" : "ACTIVE (can freeze accounts)"}`,
    `Top holder: ${report.topHolderPct.toFixed(1)}%`,
    `Liquidity: ${report.hasLiquidity ? "Yes" : "No"}`,
  ];

  if (report.risks.length > 0) {
    lines.push(``, `Risks:`);
    for (const risk of report.risks) {
      lines.push(`  - ${risk}`);
    }
  }

  return lines.join("\n");
}

// ─── Internal ───────────────────────────────────────────────

function mapToSafetyReport(raw: RugCheckReport): SolanaTokenSafetyReport {
  const topHolderPct = raw.topHolders.length > 0
    ? Math.max(...raw.topHolders.map((h) => h.pct))
    : 0;

  const hasLiquidity = raw.markets.length > 0;

  const dangerRisks = raw.risks.filter((r) => r.level === "danger");
  const warnRisks = raw.risks.filter((r) => r.level === "warn");

  let riskLevel: "safe" | "warning" | "danger";
  if (dangerRisks.length > 0 || raw.score > 500) {
    riskLevel = "danger";
  } else if (warnRisks.length > 0 || raw.score > 200) {
    riskLevel = "warning";
  } else {
    riskLevel = "safe";
  }

  return {
    mint: raw.mint,
    name: raw.tokenMeta?.name ?? "Unknown",
    symbol: raw.tokenMeta?.symbol ?? "???",
    riskLevel,
    score: raw.score,
    mintAuthorityRevoked: raw.mintAuthority === null,
    freezeAuthorityRevoked: raw.freezeAuthority === null,
    topHolderPct,
    risks: raw.risks.map((r) => `[${r.level}] ${r.name}: ${r.description}`),
    hasLiquidity,
  };
}
