import type { Address } from "viem";

export interface RiskDimension {
  name: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  score: number; // 0-100
}

export interface ContractRiskReport {
  address: Address;
  chainId: number;
  overallScore: number; // 0-100 (higher = riskier)
  riskLevel: "safe" | "low" | "medium" | "high" | "critical";
  dimensions: RiskDimension[];
  isHoneypot: boolean;
  hasOwnerPrivileges: boolean;
  isProxy: boolean;
  isVerified: boolean;
  createdAt?: string;
  cachedAt: string;
}

export interface TokenSafetyReport {
  address: Address;
  chainId: number;
  symbol: string;
  name: string;
  overallScore: number;
  riskLevel: "safe" | "low" | "medium" | "high" | "critical";
  dimensions: RiskDimension[];
  isHoneypot: boolean;
  canTakeBackOwnership: boolean;
  hasMintFunction: boolean;
  canBlacklist: boolean;
  hasTradingCooldown: boolean;
  buyTax: number;
  sellTax: number;
  holderCount: number;
  topHolderPercent: number;
  liquidityUsd: number;
  isOpenSource: boolean;
  cachedAt: string;
}

export type AllowlistAction = "allow" | "block";

export interface ContractListEntry {
  address: string;
  chainId: number;
  action: AllowlistAction;
  reason: string;
  addedAt: string;
}
