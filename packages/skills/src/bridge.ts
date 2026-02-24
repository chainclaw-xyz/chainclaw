import { z } from "zod";
import { type Address, type Hex } from "viem";
import { getLogger, fetchWithRetry, type SkillResult } from "@chainclaw/core";
import type { TransactionExecutor } from "@chainclaw/pipeline";
import type { WalletManager } from "@chainclaw/wallet";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";
import { getEthPriceUsd } from "./prices.js";
import { LIFI_NATIVE_TOKEN, resolveToken, getChainName } from "./token-addresses.js";

const logger = getLogger("skill-bridge");

const bridgeParams = z.object({
  token: z.string(),
  amount: z.string(),
  fromChainId: z.number(),
  toChainId: z.number(),
  slippageBps: z.number().optional(),
  prefer: z.enum(["cheapest", "fastest", "recommended"]).optional().default("recommended"),
});

interface LiFiQuoteResponse {
  estimate: {
    toAmount: string;
    toAmountMin: string;
    approvalAddress?: string;
    executionDuration: number;
    gasCosts: Array<{ amountUSD: string }>;
    feeCosts: Array<{ amountUSD: string }>;
  };
  transactionRequest?: {
    to: string;
    data: string;
    value: string;
    gasLimit: string;
    chainId: number;
  };
  tool: string;
  toolDetails?: {
    name: string;
  };
  action: {
    fromChainId: number;
    toChainId: number;
    fromToken: { symbol: string; decimals: number };
    toToken: { symbol: string; decimals: number };
  };
}

type RouteOrder = "CHEAPEST" | "FASTEST" | "RECOMMENDED";

interface ParsedRoute {
  order: RouteOrder;
  quote: LiFiQuoteResponse;
  bridgeName: string;
  estimatedOutput: string;
  minOutput: string;
  gasCostUsd: string;
  durationMin: number;
  toDecimals: number;
}

export function createBridgeSkill(
  executor: TransactionExecutor,
  walletManager: WalletManager,
): SkillDefinition {
  return {
    name: "bridge",
    description:
      "Bridge tokens across chains via Li.Fi. Compares cheapest, fastest, and recommended routes. " +
      "Use prefer parameter to select route strategy.",
    parameters: bridgeParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = bridgeParams.parse(params);

      if (!context.walletAddress) {
        return { success: false, message: "No wallet configured. Use /wallet create first." };
      }

      const { token, amount, fromChainId, toChainId, prefer } = parsed;
      const tokenUpper = token.toUpperCase();
      const slippageBps = parsed.slippageBps
        ?? (context.preferences?.slippageTolerance ? context.preferences.slippageTolerance * 100 : undefined)
        ?? 100;

      const fromChainName = getChainName(fromChainId);
      const toChainName = getChainName(toChainId);

      logger.info({ token: tokenUpper, amount, fromChainId, toChainId, prefer }, "Executing bridge");

      if (fromChainId === toChainId) {
        return { success: false, message: "Source and destination chains must be different." };
      }

      // Resolve token addresses — use Li.Fi native token for ETH
      const fromInfo = resolveToken(fromChainId, tokenUpper);
      const toInfo = resolveToken(toChainId, tokenUpper);
      const fromTokenAddress = tokenUpper === "ETH" ? LIFI_NATIVE_TOKEN : fromInfo?.address;
      const toTokenAddress = tokenUpper === "ETH" ? LIFI_NATIVE_TOKEN : toInfo?.address;

      if (!fromTokenAddress) {
        return { success: false, message: `${tokenUpper} is not supported on ${fromChainName} for bridging.` };
      }
      if (!toTokenAddress) {
        return { success: false, message: `${tokenUpper} is not supported on ${toChainName} for bridging.` };
      }

      const decimals = fromInfo?.decimals ?? 18;

      await context.sendReply(
        `_Finding bridge routes for ${amount} ${tokenUpper} from ${fromChainName} to ${toChainName}..._`,
      );

      // Fetch all 3 routes in parallel
      const routes = await getLiFiRoutes(
        fromChainId, toChainId, fromTokenAddress, toTokenAddress,
        amount, decimals, context.walletAddress as Address, slippageBps,
      );

      if (routes.length === 0) {
        return {
          success: false,
          message: `Could not find a bridge route for ${amount} ${tokenUpper} from ${fromChainName} to ${toChainName}. The Li.Fi API may be unavailable or no routes exist for this pair.`,
        };
      }

      // Show route comparison if we have multiple
      if (routes.length > 1) {
        await context.sendReply(formatRouteComparison(routes, tokenUpper, amount, fromChainName, toChainName, prefer));
      }

      // Select the preferred route
      const preferOrder = prefer.toUpperCase() as RouteOrder;
      const selectedRoute = routes.find((r) => r.order === preferOrder) ?? routes[0];

      // Show selected route details
      await context.sendReply(
        `*Selected Route: ${selectedRoute.bridgeName}* (${selectedRoute.order.toLowerCase()})\n\n` +
        `${amount} ${tokenUpper} (${fromChainName}) → ~${selectedRoute.estimatedOutput} ${tokenUpper} (${toChainName})\n` +
        `Min received: ${selectedRoute.minOutput} ${tokenUpper}\n` +
        `Est. time: ~${selectedRoute.durationMin} min\n` +
        `Gas cost: ~$${selectedRoute.gasCostUsd}\n` +
        `Slippage: ${slippageBps / 100}%`,
      );

      if (!selectedRoute.quote.transactionRequest) {
        return {
          success: true,
          message: `*Quote:* ${amount} ${tokenUpper} (${fromChainName}) → ~${selectedRoute.estimatedOutput} ${tokenUpper} (${toChainName})\n_Bridge execution data not available from Li.Fi for this route._`,
        };
      }

      // Ask for confirmation if available
      if (context.requestConfirmation) {
        const confirmed = await context.requestConfirmation(
          `*Bridge ${amount} ${tokenUpper}*\n\n` +
          `From: ${fromChainName}\n` +
          `To: ${toChainName}\n` +
          `Route: ${selectedRoute.bridgeName}\n` +
          `You receive: ~${selectedRoute.estimatedOutput} ${tokenUpper}\n` +
          `Est. time: ~${selectedRoute.durationMin} min\n` +
          `Gas: ~$${selectedRoute.gasCostUsd}\n\n` +
          `Proceed with this bridge?`,
        );
        if (!confirmed) {
          return { success: false, message: "Bridge cancelled." };
        }
      }

      // Execute through pipeline
      const signer = walletManager.getSigner(context.walletAddress);
      const ethPrice = await getEthPriceUsd();
      const txReq = selectedRoute.quote.transactionRequest;
      const estimatedOutput = selectedRoute.estimatedOutput;
      const durationMin = selectedRoute.durationMin;

      const result = await executor.execute(
        {
          chainId: txReq.chainId,
          from: context.walletAddress as Address,
          to: txReq.to as Address,
          value: BigInt(txReq.value),
          data: txReq.data as Hex,
          gasLimit: BigInt(txReq.gasLimit),
        },
        signer,
        {
          userId: context.userId,
          skillName: "bridge",
          intentDescription: `Bridge ${amount} ${tokenUpper} from ${fromChainName} to ${toChainName} via ${selectedRoute.bridgeName}`,
          ethPriceUsd: ethPrice,
        },
        {
          onSimulated: async (_sim, preview) => {
            await context.sendReply(preview);
          },
          onRiskWarning: context.requestConfirmation
            ? async (warning) => context.requestConfirmation!(`*Risk Warning*\n\n${warning}\n\nProceed?`)
            : undefined,
          onBroadcast: async (hash) => {
            await context.sendReply(
              `Bridge tx broadcast: \`${hash}\`\n_Funds should arrive on ${toChainName} in ~${durationMin} min._`,
            );
          },
          onConfirmed: async (_hash, blockNumber) => {
            await context.sendReply(
              `Bridge source tx confirmed in block ${blockNumber}!\n\n` +
              `${amount} ${tokenUpper} (${fromChainName}) → ~${estimatedOutput} ${tokenUpper} (${toChainName})\n` +
              `_Check your ${toChainName} balance in a few minutes._`,
            );
          },
          onFailed: async (error) => {
            await context.sendReply(`Bridge failed: ${error}`);
          },
        },
      );

      return { success: result.success, message: result.message };
    },
  };
}

async function getLiFiRoutes(
  fromChainId: number,
  toChainId: number,
  fromTokenAddress: Address,
  toTokenAddress: Address,
  amount: string,
  decimals: number,
  walletAddress: Address,
  slippageBps: number,
): Promise<ParsedRoute[]> {
  const amountWei = BigInt(Math.round(Number(amount) * 10 ** decimals)).toString();
  const orders: RouteOrder[] = ["CHEAPEST", "FASTEST", "RECOMMENDED"];

  const results = await Promise.allSettled(
    orders.map((order) => fetchLiFiQuote(
      fromChainId, toChainId, fromTokenAddress, toTokenAddress,
      amountWei, walletAddress, slippageBps, order,
    )),
  );

  const routes: ParsedRoute[] = [];
  const seenTools = new Set<string>();

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status !== "fulfilled" || !result.value) continue;

    const quote = result.value;
    const toolKey = `${quote.tool}-${quote.estimate.toAmount}`;

    // Deduplicate routes that return the same bridge/amount
    if (seenTools.has(toolKey)) continue;
    seenTools.add(toolKey);

    const toDecimals = quote.action.toToken.decimals;
    routes.push({
      order: orders[i],
      quote,
      bridgeName: quote.toolDetails?.name ?? quote.tool,
      estimatedOutput: formatTokenAmount(quote.estimate.toAmount, toDecimals),
      minOutput: formatTokenAmount(quote.estimate.toAmountMin, toDecimals),
      gasCostUsd: quote.estimate.gasCosts.reduce((sum, g) => sum + Number(g.amountUSD), 0).toFixed(2),
      durationMin: Math.ceil(quote.estimate.executionDuration / 60),
      toDecimals,
    });
  }

  return routes;
}

async function fetchLiFiQuote(
  fromChainId: number,
  toChainId: number,
  fromTokenAddress: Address,
  toTokenAddress: Address,
  amountWei: string,
  walletAddress: Address,
  slippageBps: number,
  order: RouteOrder,
): Promise<LiFiQuoteResponse | null> {
  try {
    const params = new URLSearchParams({
      fromChain: String(fromChainId),
      toChain: String(toChainId),
      fromToken: fromTokenAddress,
      toToken: toTokenAddress,
      fromAmount: amountWei,
      fromAddress: walletAddress,
      toAddress: walletAddress,
      slippage: String(slippageBps / 10000), // Li.Fi expects 0-1 range
      order,
    });

    const response = await fetchWithRetry(`https://li.quest/v1/quote?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const body = await response.text();
      logger.warn({ status: response.status, body: body.substring(0, 200), order }, "Li.Fi quote API error");
      return null;
    }

    return (await response.json()) as LiFiQuoteResponse;
  } catch (err) {
    logger.error({ err, order }, "Failed to get Li.Fi quote");
    return null;
  }
}

function formatRouteComparison(
  routes: ParsedRoute[],
  token: string,
  amount: string,
  fromChain: string,
  toChain: string,
  selectedPrefer: string,
): string {
  const lines = [
    `*Bridge Routes: ${amount} ${token} ${fromChain} → ${toChain}*\n`,
    "```",
    "Route          | Output       | Gas     | Time",
    "───────────────┼──────────────┼─────────┼──────",
  ];

  for (const route of routes) {
    const marker = route.order.toLowerCase() === selectedPrefer ? " *" : "";
    const name = (route.bridgeName.substring(0, 14)).padEnd(14);
    const output = route.estimatedOutput.padEnd(12);
    const gas = `$${route.gasCostUsd}`.padEnd(7);
    lines.push(`${name} | ${output} | ${gas} | ~${route.durationMin}m${marker}`);
  }

  lines.push("```");
  lines.push(`\\* = selected (${selectedPrefer})`);

  return lines.join("\n");
}

function formatTokenAmount(rawAmount: string, decimals: number): string {
  const value = Number(BigInt(rawAmount)) / 10 ** decimals;
  if (value < 0.0001) return "<0.0001";
  if (value < 1) return value.toFixed(4);
  if (value < 10000) return value.toFixed(2);
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
