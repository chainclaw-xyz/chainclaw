import { getLogger, fetchWithRetry } from "@chainclaw/core";
import type { Address } from "viem";

const logger = getLogger("contract-audit");

const EXPLORER_APIS: Record<number, string> = {
  1: "https://api.etherscan.io/api",
  8453: "https://api.basescan.org/api",
  42161: "https://api.arbiscan.io/api",
  10: "https://api-optimistic.etherscan.io/api",
  137: "https://api.polygonscan.com/api",
  56: "https://api.bscscan.com/api",
  43114: "https://api.snowtrace.io/api",
  324: "https://block-explorer-api.mainnet.zksync.io/api",
  534352: "https://api.scrollscan.com/api",
  81457: "https://api.blastscan.io/api",
  100: "https://api.gnosisscan.io/api",
  59144: "https://api.lineascan.build/api",
  250: "https://api.ftmscan.com/api",
  5000: "https://api.mantlescan.xyz/api",
};

export interface AuditFinding {
  pattern: string;
  severity: "info" | "warning" | "danger";
  description: string;
  matchCount: number;
}

export interface ContractAuditReport {
  address: string;
  chainId: number;
  sourceVerified: boolean;
  contractName: string | null;
  compilerVersion: string | null;
  findings: AuditFinding[];
  isProxy: boolean;
  hasSelfDestruct: boolean;
  hasHiddenMint: boolean;
  hasDelegatecall: boolean;
  hasModifiableFees: boolean;
  summary: string;
  auditedAt: string;
}

interface DangerousPattern {
  name: string;
  regex: RegExp;
  severity: "info" | "warning" | "danger";
  description: string;
}

const DANGEROUS_PATTERNS: DangerousPattern[] = [
  {
    name: "selfdestruct",
    regex: /selfdestruct\s*\(/gi,
    severity: "danger",
    description: "Contract contains selfdestruct — can be destroyed, locking funds",
  },
  {
    name: "delegatecall_arbitrary",
    regex: /\.delegatecall\s*\(/gi,
    severity: "warning",
    description: "Uses delegatecall — could execute arbitrary code if target is untrusted",
  },
  {
    name: "hidden_mint",
    regex: /function\s+\w*[Mm]int\w*\s*\([^)]*\)\s*(external|public|internal)/gi,
    severity: "warning",
    description: "Contains mint function(s) — supply can be inflated by authorized callers",
  },
  {
    name: "owner_transfer",
    regex: /onlyOwner[^}]{0,500}(_?transfer|_?send|_?withdraw)/gis,
    severity: "danger",
    description: "Owner-only transfer/withdraw function — owner can drain funds",
  },
  {
    name: "modifiable_fees",
    regex: /function\s+set\w*(Fee|Tax|Rate)\s*\(/gi,
    severity: "warning",
    description: "Fee/tax is modifiable — owner can change trading fees at any time",
  },
  {
    name: "proxy_upgradeable",
    regex: /upgradeTo|_upgradeTo|ERC1967|TransparentUpgradeableProxy|UUPSUpgradeable/gi,
    severity: "info",
    description: "Contract is upgradeable via proxy — implementation can be changed",
  },
  {
    name: "assembly_usage",
    regex: /assembly\s*\{/gi,
    severity: "info",
    description: "Uses inline assembly — harder to audit, may contain hidden logic",
  },
];

export class ContractAuditor {
  constructor(private explorerApiKeys?: Record<number, string>) {}

  async fetchSourceCode(
    chainId: number,
    address: Address,
  ): Promise<{ source: string; contractName: string; compiler: string } | null> {
    const baseUrl = EXPLORER_APIS[chainId];
    if (!baseUrl) {
      logger.warn({ chainId }, "No explorer API for chain");
      return null;
    }

    const apiKey = this.explorerApiKeys?.[chainId] ?? "";
    const params = new URLSearchParams({
      module: "contract",
      action: "getsourcecode",
      address: address.toLowerCase(),
      ...(apiKey ? { apikey: apiKey } : {}),
    });

    try {
      const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`);
      if (!response.ok) return null;

      const data = (await response.json()) as {
        status: string;
        result: Array<{
          SourceCode: string;
          ContractName: string;
          CompilerVersion: string;
        }>;
      };

      if (data.status !== "1" || !data.result?.[0]) return null;
      const entry = data.result[0];
      if (!entry.SourceCode || entry.SourceCode === "") return null;

      return {
        source: entry.SourceCode,
        contractName: entry.ContractName,
        compiler: entry.CompilerVersion,
      };
    } catch (err) {
      logger.warn({ err, chainId, address }, "Failed to fetch source code");
      return null;
    }
  }

  analyzeSource(sourceCode: string): AuditFinding[] {
    const findings: AuditFinding[] = [];

    for (const pattern of DANGEROUS_PATTERNS) {
      const matches = sourceCode.match(pattern.regex);
      if (matches && matches.length > 0) {
        findings.push({
          pattern: pattern.name,
          severity: pattern.severity,
          description: pattern.description,
          matchCount: matches.length,
        });
      }
    }

    return findings;
  }

  async audit(chainId: number, address: Address): Promise<ContractAuditReport> {
    const result = await this.fetchSourceCode(chainId, address);

    if (!result) {
      return {
        address,
        chainId,
        sourceVerified: false,
        contractName: null,
        compilerVersion: null,
        findings: [],
        isProxy: false,
        hasSelfDestruct: false,
        hasHiddenMint: false,
        hasDelegatecall: false,
        hasModifiableFees: false,
        summary: "Source code not verified on block explorer — cannot audit.",
        auditedAt: new Date().toISOString(),
      };
    }

    const findings = this.analyzeSource(result.source);

    const report: ContractAuditReport = {
      address,
      chainId,
      sourceVerified: true,
      contractName: result.contractName,
      compilerVersion: result.compiler,
      findings,
      isProxy: findings.some((f) => f.pattern === "proxy_upgradeable"),
      hasSelfDestruct: findings.some((f) => f.pattern === "selfdestruct"),
      hasHiddenMint: findings.some((f) => f.pattern === "hidden_mint"),
      hasDelegatecall: findings.some((f) => f.pattern === "delegatecall_arbitrary"),
      hasModifiableFees: findings.some((f) => f.pattern === "modifiable_fees"),
      summary: this.buildSummary(findings),
      auditedAt: new Date().toISOString(),
    };

    logger.info(
      { address, chainId, findings: findings.length, verified: true },
      "Contract audit complete",
    );

    return report;
  }

  buildSummary(findings: AuditFinding[]): string {
    const dangers = findings.filter((f) => f.severity === "danger");
    const warnings = findings.filter((f) => f.severity === "warning");

    if (dangers.length > 0) {
      return `DANGER: ${dangers.length} critical pattern(s) found. ${warnings.length} warning(s).`;
    }
    if (warnings.length > 0) {
      return `${warnings.length} warning(s) found. Review carefully before interacting.`;
    }
    return "No dangerous patterns detected in source code.";
  }

  formatAuditReport(report: ContractAuditReport): string {
    const lines: string[] = [];
    lines.push("*Contract Source Audit*");
    lines.push("");

    if (!report.sourceVerified) {
      lines.push("Source: NOT VERIFIED");
      lines.push("_Cannot audit unverified contracts. Proceed with extreme caution._");
      return lines.join("\n");
    }

    lines.push(`Contract: ${report.contractName ?? "Unknown"}`);
    lines.push(`Compiler: ${report.compilerVersion ?? "Unknown"}`);
    lines.push(`Proxy: ${report.isProxy ? "Yes (upgradeable)" : "No"}`);
    lines.push("");

    if (report.findings.length === 0) {
      lines.push("_No dangerous patterns detected._");
    } else {
      lines.push("*Findings:*");
      for (const f of report.findings) {
        const icon =
          f.severity === "danger" ? "[!]" :
          f.severity === "warning" ? "[~]" : "[-]";
        lines.push(`  ${icon} ${f.description}${f.matchCount > 1 ? ` (${f.matchCount}x)` : ""}`);
      }
    }

    lines.push("");
    lines.push(`_${report.summary}_`);

    return lines.join("\n");
  }
}
