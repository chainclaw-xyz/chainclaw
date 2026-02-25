import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address } from "viem";
import { ContractAuditor } from "../risk/contract-audit.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  fetchWithRetry: vi.fn(),
}));

import { fetchWithRetry } from "@chainclaw/core";

const mockFetch = vi.mocked(fetchWithRetry);

describe("ContractAuditor", () => {
  let auditor: ContractAuditor;

  beforeEach(() => {
    vi.clearAllMocks();
    auditor = new ContractAuditor();
  });

  // ─── analyzeSource ──────────────────────────────────────────

  it("detects selfdestruct pattern", () => {
    const source = `contract Bad { function kill() external { selfdestruct(payable(msg.sender)); } }`;
    const findings = auditor.analyzeSource(source);
    const match = findings.find((f) => f.pattern === "selfdestruct");
    expect(match).toBeDefined();
    expect(match!.severity).toBe("danger");
    expect(match!.matchCount).toBe(1);
  });

  it("detects delegatecall pattern", () => {
    const source = `contract Proxy { function forward(address target) external { target.delegatecall(msg.data); } }`;
    const findings = auditor.analyzeSource(source);
    const match = findings.find((f) => f.pattern === "delegatecall_arbitrary");
    expect(match).toBeDefined();
    expect(match!.severity).toBe("warning");
  });

  it("detects hidden mint functions", () => {
    const source = `contract Token {
      function mint(address to, uint256 amount) external { _balances[to] += amount; }
      function batchMint(address[] calldata tos) public { }
    }`;
    const findings = auditor.analyzeSource(source);
    const match = findings.find((f) => f.pattern === "hidden_mint");
    expect(match).toBeDefined();
    expect(match!.matchCount).toBe(2);
  });

  it("detects modifiable fee functions", () => {
    const source = `contract Token {
      function setFee(uint256 fee) external onlyOwner { _fee = fee; }
      function setBuyTax(uint256 tax) external onlyOwner { _buyTax = tax; }
    }`;
    const findings = auditor.analyzeSource(source);
    const match = findings.find((f) => f.pattern === "modifiable_fees");
    expect(match).toBeDefined();
    expect(match!.severity).toBe("warning");
    expect(match!.matchCount).toBe(2);
  });

  it("detects proxy/upgradeable patterns", () => {
    const source = `import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
      contract Token is UUPSUpgradeable {
        function _authorizeUpgrade(address) internal override { }
      }`;
    const findings = auditor.analyzeSource(source);
    const match = findings.find((f) => f.pattern === "proxy_upgradeable");
    expect(match).toBeDefined();
    expect(match!.severity).toBe("info");
  });

  it("detects owner-only transfer/withdraw", () => {
    const source = `contract Vault {
      modifier onlyOwner() { require(msg.sender == owner); _; }
      function emergencyWithdraw() external onlyOwner { payable(owner).transfer(address(this).balance); }
    }`;
    const findings = auditor.analyzeSource(source);
    const match = findings.find((f) => f.pattern === "owner_transfer");
    expect(match).toBeDefined();
    expect(match!.severity).toBe("danger");
  });

  it("detects assembly usage", () => {
    const source = `contract Low { function foo() external { assembly { mstore(0, 1) } } }`;
    const findings = auditor.analyzeSource(source);
    const match = findings.find((f) => f.pattern === "assembly_usage");
    expect(match).toBeDefined();
    expect(match!.severity).toBe("info");
  });

  it("returns empty findings for clean source", () => {
    const source = `contract SafeToken {
      mapping(address => uint256) private _balances;
      function transfer(address to, uint256 amount) external returns (bool) {
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        return true;
      }
    }`;
    const findings = auditor.analyzeSource(source);
    expect(findings).toHaveLength(0);
  });

  // ─── audit ──────────────────────────────────────────────────

  it("returns sourceVerified false when API returns empty source", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "1",
        result: [{ SourceCode: "", ContractName: "", CompilerVersion: "" }],
      }),
    } as any);

    const report = await auditor.audit(1, "0xdead000000000000000000000000000000000000" as Address);
    expect(report.sourceVerified).toBe(false);
    expect(report.findings).toHaveLength(0);
    expect(report.summary).toContain("not verified");
  });

  it("returns sourceVerified false for unsupported chain", async () => {
    const report = await auditor.audit(99999, "0xdead000000000000000000000000000000000000" as Address);
    expect(report.sourceVerified).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns full audit report for verified source with findings", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "1",
        result: [{
          SourceCode: `contract Bad {
            function kill() external { selfdestruct(payable(msg.sender)); }
            function setFee(uint256 f) external { fee = f; }
          }`,
          ContractName: "BadToken",
          CompilerVersion: "v0.8.20",
        }],
      }),
    } as any);

    const report = await auditor.audit(1, "0xdead000000000000000000000000000000000000" as Address);
    expect(report.sourceVerified).toBe(true);
    expect(report.contractName).toBe("BadToken");
    expect(report.hasSelfDestruct).toBe(true);
    expect(report.hasModifiableFees).toBe(true);
    expect(report.findings.length).toBeGreaterThanOrEqual(2);
  });

  it("handles API error gracefully", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as any);
    const report = await auditor.audit(1, "0xdead000000000000000000000000000000000000" as Address);
    expect(report.sourceVerified).toBe(false);
  });

  it("handles network error gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const report = await auditor.audit(1, "0xdead000000000000000000000000000000000000" as Address);
    expect(report.sourceVerified).toBe(false);
  });

  // ─── formatAuditReport ──────────────────────────────────────

  it("formats unverified contract report", () => {
    const report = auditor.formatAuditReport({
      address: "0xdead", chainId: 1, sourceVerified: false, contractName: null,
      compilerVersion: null, findings: [], isProxy: false, hasSelfDestruct: false,
      hasHiddenMint: false, hasDelegatecall: false, hasModifiableFees: false,
      summary: "Source code not verified.", auditedAt: new Date().toISOString(),
    });
    expect(report).toContain("NOT VERIFIED");
    expect(report).toContain("extreme caution");
  });

  it("formats verified contract with findings", () => {
    const report = auditor.formatAuditReport({
      address: "0xdead", chainId: 1, sourceVerified: true, contractName: "BadToken",
      compilerVersion: "v0.8.20",
      findings: [
        { pattern: "selfdestruct", severity: "danger", description: "Has selfdestruct", matchCount: 1 },
        { pattern: "modifiable_fees", severity: "warning", description: "Fees modifiable", matchCount: 2 },
      ],
      isProxy: false, hasSelfDestruct: true, hasHiddenMint: false,
      hasDelegatecall: false, hasModifiableFees: true,
      summary: "DANGER: 1 critical pattern(s) found. 1 warning(s).",
      auditedAt: new Date().toISOString(),
    });
    expect(report).toContain("BadToken");
    expect(report).toContain("[!] Has selfdestruct");
    expect(report).toContain("[~] Fees modifiable (2x)");
    expect(report).toContain("DANGER");
  });

  it("formats verified contract with no findings", () => {
    const report = auditor.formatAuditReport({
      address: "0xsafe", chainId: 1, sourceVerified: true, contractName: "SafeToken",
      compilerVersion: "v0.8.20", findings: [], isProxy: false, hasSelfDestruct: false,
      hasHiddenMint: false, hasDelegatecall: false, hasModifiableFees: false,
      summary: "No dangerous patterns detected in source code.",
      auditedAt: new Date().toISOString(),
    });
    expect(report).toContain("SafeToken");
    expect(report).toContain("No dangerous patterns detected");
  });

  // ─── buildSummary ──────────────────────────────────────────

  it("buildSummary reports dangers and warnings", () => {
    const summary = auditor.buildSummary([
      { pattern: "selfdestruct", severity: "danger", description: "", matchCount: 1 },
      { pattern: "modifiable_fees", severity: "warning", description: "", matchCount: 1 },
      { pattern: "assembly_usage", severity: "info", description: "", matchCount: 1 },
    ]);
    expect(summary).toContain("DANGER");
    expect(summary).toContain("1 critical pattern(s)");
    expect(summary).toContain("1 warning(s)");
  });

  it("buildSummary reports warnings only", () => {
    const summary = auditor.buildSummary([
      { pattern: "modifiable_fees", severity: "warning", description: "", matchCount: 1 },
    ]);
    expect(summary).toContain("1 warning(s)");
    expect(summary).not.toContain("DANGER");
  });

  it("buildSummary reports no patterns", () => {
    const summary = auditor.buildSummary([]);
    expect(summary).toContain("No dangerous patterns detected");
  });
});
