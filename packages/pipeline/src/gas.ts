import { createPublicClient, http, parseGwei, type Chain } from "viem";
import { mainnet, base, arbitrum, optimism } from "viem/chains";
import { getLogger } from "@chainclaw/core";
import type { GasStrategy } from "./types.js";

const logger = getLogger("gas-optimizer");

const viemChains: Record<number, Chain> = { 1: mainnet, 8453: base, 42161: arbitrum, 10: optimism };

export interface GasFeeEstimate {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  strategy: GasStrategy;
}

// Priority fee per strategy (in gwei)
const PRIORITY_FEES: Record<GasStrategy, bigint> = {
  slow: parseGwei("1"),
  standard: parseGwei("1.5"),
  fast: parseGwei("3"),
};

// Base fee multiplier (numerator/denominator to avoid floating point)
const BASE_FEE_MULTIPLIER: Record<GasStrategy, [bigint, bigint]> = {
  slow: [11n, 10n],       // 1.1x
  standard: [125n, 100n], // 1.25x
  fast: [2n, 1n],         // 2x
};

export class GasOptimizer {
  private rpcOverrides: Record<number, string>;

  constructor(rpcOverrides?: Record<number, string>) {
    this.rpcOverrides = rpcOverrides ?? {};
  }

  async estimateFees(chainId: number, strategy: GasStrategy = "standard"): Promise<GasFeeEstimate> {
    const chain = viemChains[chainId];
    if (!chain) throw new Error(`Unsupported chain for gas estimation: ${chainId}`);

    const client = createPublicClient({
      chain,
      transport: http(this.rpcOverrides[chainId]),
    });

    const block = await client.getBlock({ blockTag: "latest" });
    const baseFee = block.baseFeePerGas;

    if (!baseFee) {
      // Pre-EIP-1559 chain — return legacy-compatible defaults
      logger.warn({ chainId }, "No baseFeePerGas (pre-EIP-1559), using defaults");
      return {
        maxFeePerGas: parseGwei("50"),
        maxPriorityFeePerGas: PRIORITY_FEES[strategy],
        strategy,
      };
    }

    const priorityFee = PRIORITY_FEES[strategy];
    const [num, den] = BASE_FEE_MULTIPLIER[strategy];
    const maxFee = (baseFee * num) / den + priorityFee;

    logger.debug({ chainId, strategy, baseFee: baseFee.toString(), maxFee: maxFee.toString(), priorityFee: priorityFee.toString() }, "Gas fees estimated");

    return {
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priorityFee,
      strategy,
    };
  }
}
