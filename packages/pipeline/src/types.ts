import type { Address, Hex } from "viem";

export type TxStatus = "pending" | "simulated" | "approved" | "signed" | "broadcast" | "confirmed" | "failed" | "rejected";

export type GasStrategy = "slow" | "standard" | "fast";

export interface TransactionRequest {
  chainId: number;
  from: Address;
  to: Address;
  value: bigint;
  data?: Hex;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasStrategy?: GasStrategy;
}

export interface SimulationResult {
  success: boolean;
  gasEstimate: bigint;
  balanceChanges: BalanceChange[];
  error?: string;
  rawResult?: unknown;
}

export interface BalanceChange {
  token: string;
  symbol: string;
  amount: string;
  direction: "in" | "out";
}

export interface GuardrailCheck {
  passed: boolean;
  rule: string;
  message: string;
}

export interface TransactionRecord {
  id: string;
  userId: string;
  chainId: number;
  from: string;
  to: string;
  value: string;
  hash?: string;
  status: TxStatus;
  skillName: string;
  intentDescription: string;
  simulationResult?: string; // JSON
  guardrailChecks?: string; // JSON
  gasUsed?: string;
  gasPrice?: string;
  blockNumber?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserLimits {
  maxPerTx: number;       // USD
  maxPerDay: number;      // USD
  cooldownSeconds: number; // seconds between large tx
  slippageBps: number;    // basis points (100 = 1%)
}

export const DEFAULT_LIMITS: UserLimits = {
  maxPerTx: 1000,
  maxPerDay: 5000,
  cooldownSeconds: 30,
  slippageBps: 100,
};
