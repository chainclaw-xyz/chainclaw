import { getLogger } from "@chainclaw/core";
import { formatEther, formatUnits } from "viem";
import type { TransactionRequest, SimulationResult, BalanceChange } from "./types.js";

const logger = getLogger("simulator");

export interface SimulatorConfig {
  tenderlyApiKey?: string;
  tenderlyAccount?: string;
  tenderlyProject?: string;
}

interface TenderlySimResponse {
  simulation: {
    status: boolean;
    gas_used: number;
    error_message?: string;
  };
  transaction: {
    transaction_info: {
      asset_changes?: Array<{
        token_info: { symbol: string; name: string; decimals: number };
        raw_amount: string;
        from: string;
        to: string;
      }>;
    };
  };
}

export class TransactionSimulator {
  private config: SimulatorConfig;

  constructor(config: SimulatorConfig) {
    this.config = config;
    if (config.tenderlyApiKey) {
      logger.info("Simulator initialized with Tenderly API");
    } else {
      logger.info("Simulator initialized in estimate-only mode (no Tenderly key)");
    }
  }

  async simulate(tx: TransactionRequest): Promise<SimulationResult> {
    // Try Tenderly first if configured
    if (this.config.tenderlyApiKey && this.config.tenderlyAccount && this.config.tenderlyProject) {
      return this.simulateWithTenderly(tx);
    }

    // Fallback: basic gas estimation
    return this.estimateOnly(tx);
  }

  private async simulateWithTenderly(tx: TransactionRequest): Promise<SimulationResult> {
    const { tenderlyApiKey, tenderlyAccount, tenderlyProject } = this.config;
    const url = `https://api.tenderly.co/api/v1/account/${tenderlyAccount}/project/${tenderlyProject}/simulate`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Access-Key": tenderlyApiKey!,
        },
        body: JSON.stringify({
          network_id: String(tx.chainId),
          from: tx.from,
          to: tx.to,
          value: tx.value.toString(),
          input: tx.data ?? "0x",
          gas: tx.gasLimit ? Number(tx.gasLimit) : 8000000,
          save: false,
          save_if_fails: false,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        logger.error({ status: response.status, body: text }, "Tenderly simulation failed");
        return this.estimateOnly(tx);
      }

      const data = (await response.json()) as TenderlySimResponse;
      const sim = data.simulation;
      const balanceChanges: BalanceChange[] = [];

      const assetChanges = data.transaction?.transaction_info?.asset_changes;
      if (assetChanges) {
        for (const change of assetChanges) {
          const isOutgoing = change.from.toLowerCase() === tx.from.toLowerCase();
          balanceChanges.push({
            token: change.token_info.name,
            symbol: change.token_info.symbol,
            amount: formatUnits(BigInt(change.raw_amount), change.token_info.decimals),
            direction: isOutgoing ? "out" : "in",
          });
        }
      }

      logger.info(
        { gasUsed: sim.gas_used, success: sim.status, changes: balanceChanges.length },
        "Tenderly simulation complete",
      );

      return {
        success: sim.status,
        gasEstimate: BigInt(sim.gas_used),
        balanceChanges,
        error: sim.error_message,
        rawResult: data,
      };
    } catch (err) {
      logger.error({ err }, "Tenderly simulation error, falling back to estimate");
      return this.estimateOnly(tx);
    }
  }

  private estimateOnly(tx: TransactionRequest): SimulationResult {
    // Basic estimation without actual simulation
    const gasEstimate = tx.gasLimit ?? 200000n;

    const balanceChanges: BalanceChange[] = [];
    if (tx.value > 0n) {
      balanceChanges.push({
        token: "ETH",
        symbol: "ETH",
        amount: formatEther(tx.value),
        direction: "out",
      });
    }

    return {
      success: true,
      gasEstimate,
      balanceChanges,
    };
  }

  formatPreview(result: SimulationResult, gasPrice?: bigint): string {
    const lines: string[] = ["*Transaction Preview*", ""];

    if (!result.success) {
      lines.push(`Status: WOULD FAIL`);
      if (result.error) lines.push(`Error: ${result.error}`);
      return lines.join("\n");
    }

    if (result.balanceChanges.length > 0) {
      lines.push("*Balance Changes:*");
      for (const change of result.balanceChanges) {
        const icon = change.direction === "out" ? "-" : "+";
        lines.push(`  ${icon}${change.amount} ${change.symbol}`);
      }
      lines.push("");
    }

    const gasCost = gasPrice
      ? formatEther(result.gasEstimate * gasPrice)
      : null;
    lines.push(`Est. gas: ${result.gasEstimate.toLocaleString()}${gasCost ? ` (~${gasCost} ETH)` : ""}`);

    return lines.join("\n");
  }
}
