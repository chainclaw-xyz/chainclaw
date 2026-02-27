import { getLogger } from "@chainclaw/core";
import type Database from "better-sqlite3";
import type { Address } from "viem";
import { GoPlusClient } from "./goplus.js";
import { RiskCache } from "./cache.js";
import { ContractAuditor, type ContractAuditReport } from "./contract-audit.js";
import { checkSolanaToken } from "./rugcheck.js";
import type { TokenSafetyReport, RiskDimension } from "./types.js";

const logger = getLogger("risk-engine");

export interface RiskEngineConfig {
  autoBlockThreshold?: number; // Risk score above which to auto-block (default: 80)
  warnThreshold?: number; // Risk score above which to warn (default: 40)
  explorerApiKeys?: Record<number, string>; // Per-chain Etherscan API keys for contract auditing
}

export class RiskEngine {
  private goplus: GoPlusClient;
  private cache: RiskCache;
  private auditor: ContractAuditor;
  private autoBlockThreshold: number;
  private warnThreshold: number;

  constructor(db: Database.Database, config?: RiskEngineConfig) {
    this.goplus = new GoPlusClient();
    this.cache = new RiskCache(db);
    this.auditor = new ContractAuditor(config?.explorerApiKeys);
    this.autoBlockThreshold = config?.autoBlockThreshold ?? 80;
    this.warnThreshold = config?.warnThreshold ?? 40;
  }

  async analyzeToken(
    chainId: number,
    tokenAddress: string,
  ): Promise<TokenSafetyReport | null> {
    // Solana: route to RugCheck
    if (chainId === 900) {
      return this.analyzeSolanaToken(tokenAddress);
    }

    // Check cache first
    const cached = this.cache.getCachedReport(tokenAddress as Address, chainId);
    if (cached) {
      logger.debug({ tokenAddress, chainId }, "Risk report from cache");
      return cached;
    }

    // Fetch from GoPlus
    const report = await this.goplus.getTokenSecurity(chainId, tokenAddress as Address);
    if (!report) return null;

    // Cache the result
    this.cache.cacheReport(report);
    return report;
  }

  private async analyzeSolanaToken(mint: string): Promise<TokenSafetyReport | null> {
    try {
      const report = await checkSolanaToken(mint);
      if (!report) return null;

      // Map RugCheck riskLevel → TokenSafetyReport riskLevel
      const riskLevelMap: Record<string, TokenSafetyReport["riskLevel"]> = {
        safe: "safe",
        warning: "medium",
        danger: "critical",
      };

      return {
        chainId: 900,
        address: mint as Address,
        name: report.name,
        symbol: report.symbol,
        isOpenSource: true,
        isHoneypot: report.riskLevel === "danger" && !report.hasLiquidity,
        canTakeBackOwnership: false,
        hasMintFunction: !report.mintAuthorityRevoked,
        canBlacklist: !report.freezeAuthorityRevoked,
        hasTradingCooldown: false,
        buyTax: 0,
        sellTax: 0,
        holderCount: 0,
        topHolderPercent: report.topHolderPct,
        liquidityUsd: report.hasLiquidity ? 1 : 0,
        overallScore: Math.min(report.score, 100),
        riskLevel: riskLevelMap[report.riskLevel] ?? "medium",
        dimensions: report.risks.map((riskStr, i) => ({
          name: `risk-${i}`,
          description: riskStr,
          score: 50,
          severity: riskStr.startsWith("[danger]") ? "critical" as const
            : riskStr.startsWith("[warn]") ? "high" as const
            : "medium" as const,
        })),
        cachedAt: new Date().toISOString(),
      };
    } catch (err) {
      logger.error({ err, mint }, "RugCheck analysis failed");
      return null;
    }
  }

  async shouldBlock(
    userId: string,
    chainId: number,
    contractAddress: Address,
  ): Promise<{ blocked: boolean; reason: string }> {
    // Check user blocklist first
    if (this.cache.isBlocked(userId, contractAddress, chainId)) {
      return { blocked: true, reason: "Contract is on your blocklist" };
    }

    // If user has explicitly allowed, skip risk check
    if (this.cache.isAllowed(userId, contractAddress, chainId)) {
      return { blocked: false, reason: "Contract is on your allowlist" };
    }

    // Auto-check risk
    const report = await this.analyzeToken(chainId, contractAddress);
    if (!report) {
      // Can't assess risk — allow but log warning
      logger.warn(
        { contractAddress, chainId },
        "Could not assess contract risk — proceeding with caution",
      );
      return { blocked: false, reason: "Risk assessment unavailable" };
    }

    if (report.isHoneypot) {
      return {
        blocked: true,
        reason: "Token is flagged as a honeypot — you would not be able to sell",
      };
    }

    if (report.overallScore >= this.autoBlockThreshold) {
      return {
        blocked: true,
        reason: `Token risk score is ${report.overallScore}/100 (${report.riskLevel}). Auto-blocked for safety.`,
      };
    }

    return { blocked: false, reason: "" };
  }

  needsWarning(report: TokenSafetyReport): boolean {
    return report.overallScore >= this.warnThreshold;
  }

  // ─── Contract list management ──────────────────────────────

  allowContract(
    userId: string,
    address: string,
    chainId: number,
    reason: string = "",
  ): void {
    this.cache.setContractAction(userId, address, chainId, "allow", reason);
  }

  blockContract(
    userId: string,
    address: string,
    chainId: number,
    reason: string = "",
  ): void {
    this.cache.setContractAction(userId, address, chainId, "block", reason);
  }

  removeFromList(
    userId: string,
    address: string,
    chainId: number,
  ): boolean {
    return this.cache.removeContractAction(userId, address, chainId);
  }

  getUserList(userId: string) {
    return this.cache.getUserList(userId);
  }

  // ─── Contract auditing ────────────────────────────────────

  async auditContract(
    chainId: number,
    address: Address,
  ): Promise<ContractAuditReport> {
    return this.auditor.audit(chainId, address);
  }

  formatContractAudit(report: ContractAuditReport): string {
    return this.auditor.formatAuditReport(report);
  }

  // ─── Report formatting ─────────────────────────────────────

  formatRiskReport(report: TokenSafetyReport): string {
    const lines: string[] = [];

    const levelIcon = {
      safe: "GREEN",
      low: "BLUE",
      medium: "YELLOW",
      high: "ORANGE",
      critical: "RED",
    }[report.riskLevel];

    lines.push(`*Risk Report: ${report.name} (${report.symbol})*`);
    lines.push("");
    lines.push(`Risk Level: [${levelIcon}] ${report.riskLevel.toUpperCase()} (${report.overallScore}/100)`);
    lines.push("");

    // Key facts
    lines.push("*Key Facts:*");
    lines.push(`  Source verified: ${report.isOpenSource ? "Yes" : "No"}`);
    lines.push(`  Honeypot: ${report.isHoneypot ? "YES" : "No"}`);
    lines.push(`  Holders: ${report.holderCount.toLocaleString()}`);
    if (report.buyTax > 0 || report.sellTax > 0) {
      lines.push(`  Buy tax: ${report.buyTax.toFixed(1)}% | Sell tax: ${report.sellTax.toFixed(1)}%`);
    }
    if (report.topHolderPercent > 0) {
      lines.push(`  Top holder concentration: ${report.topHolderPercent.toFixed(1)}%`);
    }
    lines.push("");

    // Risks
    if (report.dimensions.length > 0) {
      lines.push("*Risk Findings:*");
      const sorted = [...report.dimensions].sort(
        (a, b) => b.score - a.score,
      );
      for (const dim of sorted) {
        const icon = severityIcon(dim.severity);
        lines.push(`  ${icon} ${dim.description}`);
      }
    } else {
      lines.push("_No significant risks detected._");
    }

    return lines.join("\n");
  }
}

function severityIcon(severity: RiskDimension["severity"]): string {
  switch (severity) {
    case "critical":
      return "[!]";
    case "high":
      return "[!]";
    case "medium":
      return "[~]";
    case "low":
      return "[-]";
  }
}
