import { getLogger, fetchWithRetry } from "@chainclaw/core";
import { encodeFunctionData, formatEther, formatUnits, maxUint256, parseAbi, type Address } from "viem";
import type { TransactionRequest, SimulationResult, BalanceChange, AntiRugResult } from "./types.js";

const logger = getLogger("simulator");

export interface SimulatorConfig {
  tenderlyApiKey?: string;
  tenderlyAccount?: string;
  tenderlyProject?: string;
}

// Uniswap V2 Router — used for sell simulation
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D" as Address;
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address;

const erc20Abi = parseAbi(["function approve(address spender, uint256 amount) external returns (bool)"]);
const uniV2Abi = parseAbi([
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)",
]);

interface TenderlyBundleSimResult {
  simulation: {
    status: boolean;
    gas_used: number;
    error_message?: string;
  };
  transaction: {
    transaction_info: {
      asset_changes?: Array<{
        token_info: { symbol: string; name: string; decimals: number; address?: string };
        raw_amount: string;
        from: string;
        to: string;
      }>;
    };
  };
}

interface TenderlyBundleResponse {
  simulation_results: TenderlyBundleSimResult[];
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
      const response = await fetchWithRetry(url, {
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

  async simulateSellAfterBuy(
    buyTx: TransactionRequest,
    tokenAddress: Address,
  ): Promise<AntiRugResult> {
    const { tenderlyApiKey, tenderlyAccount, tenderlyProject } = this.config;

    if (!tenderlyApiKey || !tenderlyAccount || !tenderlyProject) {
      return {
        canSell: true, sellTax: 0, netLossPercent: 0,
        buyReceived: "0", sellReceived: "0",
        warning: "Anti-rug simulation unavailable (no Tenderly key)",
      };
    }

    const url = `https://api.tenderly.co/api/v1/account/${tenderlyAccount}/project/${tenderlyProject}/simulate-bundle`;

    // Build approve tx: approve Uniswap V2 Router to spend tokens
    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [UNISWAP_V2_ROUTER, maxUint256],
    });

    // Build sell tx: swap all received tokens back to ETH via Uniswap V2
    // We use a placeholder amount (1e18) — Tenderly bundle simulation uses state from prior txs
    const sellData = encodeFunctionData({
      abi: uniV2Abi,
      functionName: "swapExactTokensForETH",
      args: [
        1000000000000000000n, // amountIn — placeholder, real amount comes from buy
        0n, // amountOutMin — 0 for simulation
        [tokenAddress, WETH_ADDRESS], // path: token → WETH
        buyTx.from, // recipient
        BigInt(Math.floor(Date.now() / 1000) + 3600), // deadline: 1 hour
      ],
    });

    try {
      const response = await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Access-Key": tenderlyApiKey,
        },
        body: JSON.stringify({
          simulations: [
            {
              network_id: String(buyTx.chainId),
              from: buyTx.from,
              to: buyTx.to,
              value: buyTx.value.toString(),
              input: buyTx.data ?? "0x",
              gas: buyTx.gasLimit ? Number(buyTx.gasLimit) : 8000000,
              save: false,
            },
            {
              network_id: String(buyTx.chainId),
              from: buyTx.from,
              to: tokenAddress,
              value: "0",
              input: approveData,
              gas: 100000,
              save: false,
            },
            {
              network_id: String(buyTx.chainId),
              from: buyTx.from,
              to: UNISWAP_V2_ROUTER,
              value: "0",
              input: sellData,
              gas: 500000,
              save: false,
            },
          ],
        }),
      });

      if (!response.ok) {
        logger.warn({ status: response.status }, "Anti-rug bundle simulation API error");
        return {
          canSell: true, sellTax: 0, netLossPercent: 0,
          buyReceived: "0", sellReceived: "0",
          warning: "Anti-rug simulation failed — proceeding with caution",
        };
      }

      const data = (await response.json()) as TenderlyBundleResponse;
      const results = data.simulation_results;

      if (!results || results.length < 3) {
        return {
          canSell: true, sellTax: 0, netLossPercent: 0,
          buyReceived: "0", sellReceived: "0",
          warning: "Anti-rug simulation returned incomplete results",
        };
      }

      const buyResult = results[0];
      const sellResult = results[2];

      // Check if sell simulation succeeded
      if (!sellResult.simulation.status) {
        logger.info({ tokenAddress, error: sellResult.simulation.error_message }, "Anti-rug: sell simulation failed");
        return {
          canSell: false, sellTax: 100, netLossPercent: 100,
          buyReceived: "0", sellReceived: "0",
          warning: `Cannot sell token: ${sellResult.simulation.error_message ?? "sell transaction reverted"}`,
        };
      }

      // Extract token amount received from buy
      const buyChanges = buyResult.transaction?.transaction_info?.asset_changes ?? [];
      const tokenReceived = buyChanges.find(
        (c) => c.to.toLowerCase() === buyTx.from.toLowerCase() &&
               c.token_info.address?.toLowerCase() === tokenAddress.toLowerCase(),
      );
      const buyReceived = tokenReceived
        ? formatUnits(BigInt(tokenReceived.raw_amount), tokenReceived.token_info.decimals)
        : "0";

      // Extract ETH received from sell
      const sellChanges = sellResult.transaction?.transaction_info?.asset_changes ?? [];
      const ethReceived = sellChanges.find(
        (c) => c.to.toLowerCase() === buyTx.from.toLowerCase() &&
               (c.token_info.symbol === "ETH" || c.token_info.symbol === "WETH"),
      );
      const sellReceivedRaw = ethReceived ? BigInt(ethReceived.raw_amount) : 0n;
      const sellReceived = ethReceived
        ? formatUnits(sellReceivedRaw, ethReceived.token_info.decimals)
        : "0";

      // Calculate round-trip loss
      const ethSpent = buyTx.value;
      const netLossPercent = ethSpent > 0n
        ? Number((ethSpent - sellReceivedRaw) * 10000n / ethSpent) / 100
        : 0;
      const sellTax = Math.max(0, netLossPercent);

      logger.info(
        { tokenAddress, canSell: true, netLossPercent: netLossPercent.toFixed(1), buyReceived, sellReceived },
        "Anti-rug simulation complete",
      );

      return {
        canSell: true,
        sellTax,
        netLossPercent,
        buyReceived,
        sellReceived,
        warning: netLossPercent > 20 ? `High round-trip loss: ${netLossPercent.toFixed(1)}%` : undefined,
      };
    } catch (err) {
      logger.warn({ err, tokenAddress }, "Anti-rug simulation error");
      return {
        canSell: true, sellTax: 0, netLossPercent: 0,
        buyReceived: "0", sellReceived: "0",
        warning: "Anti-rug simulation error — proceeding with caution",
      };
    }
  }
}
