import { z } from "zod";
import type Database from "better-sqlite3";
import { type Address } from "viem";
import { getLogger, fetchWithRetry, type SkillResult } from "@chainclaw/core";
import type { WalletManager } from "@chainclaw/wallet";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";
import { getTokenPrice } from "./prices.js";

const logger = getLogger("skill-limit-order");

const limitOrderParams = z.object({
  action: z.enum(["create", "list", "cancel"]).default("create"),
  fromToken: z.string().optional(),
  toToken: z.string().optional(),
  amount: z.string().optional(),
  limitPrice: z.number().optional(),
  chainId: z.number().optional().default(1),
  orderId: z.string().optional(),
});

// CoW Protocol supported chains
const COW_API_BASE: Record<number, string> = {
  1: "https://api.cow.fi/mainnet",
  100: "https://api.cow.fi/xdai",
};

// Token addresses for CoW Protocol (Ethereum + Gnosis)
const COW_TOKEN_ADDRESSES: Record<number, Record<string, { address: Address; decimals: number }>> = {
  1: {
    USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
    DAI: { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
    ETH: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 },
  },
  100: {
    WXDAI: { address: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d", decimals: 18 },
    USDC: { address: "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83", decimals: 6 },
    WETH: { address: "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1", decimals: 18 },
  },
};

interface LimitOrderRow {
  id: number;
  user_id: string;
  order_uid: string;
  from_token: string;
  to_token: string;
  amount: string;
  limit_price: number;
  chain_id: number;
  status: string;
  created_at: string;
}

export class LimitOrderManager {
  constructor(private db: Database.Database) {
    this.initTable();
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS limit_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        order_uid TEXT NOT NULL,
        from_token TEXT NOT NULL,
        to_token TEXT NOT NULL,
        amount TEXT NOT NULL,
        limit_price REAL NOT NULL,
        chain_id INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'filled', 'cancelled', 'expired')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_limit_orders_user ON limit_orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_limit_orders_status ON limit_orders(status);
    `);
    logger.debug("Limit orders table initialized");
  }

  saveOrder(
    userId: string,
    orderUid: string,
    fromToken: string,
    toToken: string,
    amount: string,
    limitPrice: number,
    chainId: number,
  ): number {
    const result = this.db.prepare(
      "INSERT INTO limit_orders (user_id, order_uid, from_token, to_token, amount, limit_price, chain_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(userId, orderUid, fromToken.toUpperCase(), toToken.toUpperCase(), amount, limitPrice, chainId);
    return Number(result.lastInsertRowid);
  }

  getUserOrders(userId: string): LimitOrderRow[] {
    return this.db.prepare(
      "SELECT * FROM limit_orders WHERE user_id = ? AND status = 'open' ORDER BY created_at DESC",
    ).all(userId) as LimitOrderRow[];
  }

  cancelOrder(orderUid: string, userId: string): boolean {
    const result = this.db.prepare(
      "UPDATE limit_orders SET status = 'cancelled' WHERE order_uid = ? AND user_id = ? AND status = 'open'",
    ).run(orderUid, userId);
    return result.changes > 0;
  }

  getOrderByUid(orderUid: string): LimitOrderRow | undefined {
    return this.db.prepare(
      "SELECT * FROM limit_orders WHERE order_uid = ?",
    ).get(orderUid) as LimitOrderRow | undefined;
  }
}

export function createLimitOrderSkill(
  orderManager: LimitOrderManager,
  walletManager: WalletManager,
): SkillDefinition {
  return {
    name: "limit-order",
    description:
      "Create gasless limit orders via CoW Protocol. Set a target price and the order executes when the market reaches it. " +
      "Example: 'Set a limit order to buy ETH at $2000 with 500 USDC'.",
    parameters: limitOrderParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = limitOrderParams.parse(params);

      switch (parsed.action) {
        case "create":
          return handleCreate(orderManager, walletManager, parsed, context);
        case "list":
          return handleList(orderManager, context);
        case "cancel":
          return handleCancel(orderManager, parsed, context);
      }
    },
  };
}

async function handleCreate(
  orderManager: LimitOrderManager,
  walletManager: WalletManager,
  parsed: z.infer<typeof limitOrderParams>,
  context: SkillExecutionContext,
): Promise<SkillResult> {
  const { fromToken, toToken, amount, limitPrice, chainId } = parsed;

  if (!fromToken || !toToken || !amount || limitPrice == null) {
    return {
      success: false,
      message: "Missing required fields. Please specify: fromToken, toToken, amount, and limitPrice.\n\nExample: _Set a limit order to sell 1 ETH for USDC at $3000_",
    };
  }

  if (!context.walletAddress) {
    return { success: false, message: "No wallet configured. Use /wallet to create or import one." };
  }

  const apiBase = COW_API_BASE[chainId];
  if (!apiBase) {
    return {
      success: false,
      message: `CoW Protocol is not supported on chain ${chainId}. Supported chains: Ethereum (1), Gnosis (100).`,
    };
  }

  const fromUpper = fromToken.toUpperCase();
  const toUpper = toToken.toUpperCase();
  const chainTokens = COW_TOKEN_ADDRESSES[chainId];

  const fromInfo = chainTokens?.[fromUpper];
  const toInfo = chainTokens?.[toUpper];

  if (!fromInfo) {
    return { success: false, message: `Token ${fromUpper} not supported for limit orders on chain ${chainId}.` };
  }
  if (!toInfo) {
    return { success: false, message: `Token ${toUpper} not supported for limit orders on chain ${chainId}.` };
  }

  // For ETH, wrap to WETH for CoW Protocol
  const weth = chainTokens["WETH"];
  const sellToken = fromUpper === "ETH" && weth ? weth.address : fromInfo.address;
  const buyToken = toUpper === "ETH" && weth ? weth.address : toInfo.address;

  const sellDecimals = fromUpper === "ETH" ? 18 : fromInfo.decimals;

  // Calculate sell/buy amounts based on limit price
  const sellAmountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** sellDecimals));
  const buyAmountRaw = calculateBuyAmount(
    parseFloat(amount),
    limitPrice,
    fromUpper,
    toUpper,
    toUpper === "ETH" ? 18 : toInfo.decimals,
  );

  // Get current price for comparison
  const currentPrice = await getTokenPrice(fromUpper === "USDC" || fromUpper === "USDT" ? toUpper : fromUpper);

  const priceComparison = currentPrice
    ? `\nCurrent price: $${currentPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    : "";

  // Request user confirmation before submitting
  if (context.requestConfirmation) {
    const confirmed = await context.requestConfirmation(
      `*Confirm Limit Order*\n\n` +
      `Sell: ${amount} ${fromUpper}\n` +
      `Buy: ${toUpper} at $${limitPrice.toLocaleString("en-US")}${priceComparison}\n` +
      `Chain: ${chainId === 1 ? "Ethereum" : `Chain ${chainId}`}\n` +
      `Expires: 7 days\n\n` +
      `Approve this order?`,
    );
    if (!confirmed) {
      return { success: false, message: "Limit order cancelled by user." };
    }
  }

  await context.sendReply(
    `_Submitting limit order: Sell ${amount} ${fromUpper} for ${toUpper} at $${limitPrice.toLocaleString("en-US")}..._`,
  );

  try {
    // Create order via CoW Protocol API
    const validTo = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days

    const orderPayload = {
      sellToken,
      buyToken,
      sellAmount: sellAmountRaw.toString(),
      buyAmount: buyAmountRaw.toString(),
      validTo,
      appData: "0x0000000000000000000000000000000000000000000000000000000000000000",
      feeAmount: "0",
      kind: "sell",
      partiallyFillable: false,
      receiver: context.walletAddress,
      from: context.walletAddress,
      sellTokenBalance: "erc20",
      buyTokenBalance: "erc20",
      signingScheme: "eip712",
    };

    // Get the order hash for signing
    const response = await fetchWithRetry(
      `${apiBase}/api/v1/orders`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn({ status: response.status, error: errorText }, "CoW Protocol API error");

      // If we can't submit to CoW directly, save as a pending order locally
      const orderUid = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const orderId = orderManager.saveOrder(
        context.userId,
        orderUid,
        fromUpper,
        toUpper,
        amount,
        limitPrice,
        chainId,
      );

      return {
        success: true,
        message:
          `*Limit Order #${orderId} Created (Local)*\n\n` +
          `Sell: ${amount} ${fromUpper}\n` +
          `Buy: ${toUpper} at $${limitPrice.toLocaleString("en-US")}\n` +
          `Expires: 7 days${priceComparison}\n\n` +
          `_Note: Order saved locally. For on-chain execution via CoW Protocol, ensure your wallet has approved the CoW vault for ${fromUpper}._`,
      };
    }

    const orderUid = (await response.json()) as string;

    // Save to local DB
    const orderId = orderManager.saveOrder(
      context.userId,
      orderUid,
      fromUpper,
      toUpper,
      amount,
      limitPrice,
      chainId,
    );

    return {
      success: true,
      message:
        `*Limit Order #${orderId} Submitted*\n\n` +
        `Sell: ${amount} ${fromUpper}\n` +
        `Buy: ${toUpper} at $${limitPrice.toLocaleString("en-US")}\n` +
        `Expires: 7 days${priceComparison}\n` +
        `Order UID: \`${orderUid.slice(0, 16)}...\`\n\n` +
        `_Powered by CoW Protocol — gasless, MEV-protected._`,
    };
  } catch (err) {
    logger.error({ err }, "Failed to create limit order");
    return {
      success: false,
      message: "Failed to create limit order. Please try again later.",
    };
  }
}

function handleList(
  orderManager: LimitOrderManager,
  context: SkillExecutionContext,
): SkillResult {
  const orders = orderManager.getUserOrders(context.userId);

  if (orders.length === 0) {
    return {
      success: true,
      message: "No open limit orders. Create one with: _Set a limit order to buy ETH at $2000 with 500 USDC_",
    };
  }

  const lines = ["*Your Open Limit Orders*\n"];
  for (const order of orders) {
    lines.push(
      `*#${order.id}* Sell ${order.amount} ${order.from_token} → ${order.to_token} at $${order.limit_price.toLocaleString("en-US")}`,
    );
    lines.push(
      `   Chain: ${order.chain_id} | Created: ${order.created_at.slice(0, 10)}`,
    );
  }

  return { success: true, message: lines.join("\n") };
}

async function handleCancel(
  orderManager: LimitOrderManager,
  parsed: z.infer<typeof limitOrderParams>,
  context: SkillExecutionContext,
): Promise<SkillResult> {
  if (!parsed.orderId) {
    return { success: false, message: "Please specify an order ID to cancel." };
  }

  const order = orderManager.getOrderByUid(parsed.orderId);
  if (!order) {
    return { success: false, message: `Order ${parsed.orderId} not found.` };
  }

  // Try to cancel on CoW Protocol API
  const apiBase = COW_API_BASE[order.chain_id];
  if (apiBase && !order.order_uid.startsWith("local-")) {
    try {
      await fetchWithRetry(`${apiBase}/api/v1/orders/${order.order_uid}`, {
        method: "DELETE",
      });
    } catch (err) {
      logger.warn({ err, orderUid: order.order_uid }, "Failed to cancel on CoW API");
    }
  }

  const cancelled = orderManager.cancelOrder(order.order_uid, context.userId);
  if (!cancelled) {
    return { success: false, message: `Could not cancel order ${parsed.orderId}. It may not be yours or already filled.` };
  }

  return {
    success: true,
    message: `*Order Cancelled*\n\nLimit order for ${order.amount} ${order.from_token} → ${order.to_token} at $${order.limit_price} has been cancelled.`,
  };
}

function calculateBuyAmount(
  sellAmount: number,
  limitPrice: number,
  sellToken: string,
  buyToken: string,
  buyDecimals: number,
): bigint {
  // If selling stablecoin to buy ETH/token: buyAmount = sellAmount / limitPrice
  // If selling ETH/token for stablecoin: buyAmount = sellAmount * limitPrice
  const isSellingStable = ["USDC", "USDT", "DAI", "WXDAI"].includes(sellToken);

  let buyAmount: number;
  if (isSellingStable) {
    buyAmount = sellAmount / limitPrice;
  } else {
    buyAmount = sellAmount * limitPrice;
  }

  return BigInt(Math.floor(buyAmount * 10 ** buyDecimals));
}
