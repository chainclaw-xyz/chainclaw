import { getLogger, fetchWithRetry } from "@chainclaw/core";

const logger = getLogger("jupiter-limit");

const JUPITER_TRIGGER_API = "https://api.jup.ag/trigger/v1";

// ─── Types ──────────────────────────────────────────────────

export interface JupiterCreateOrderResponse {
  order: string; // order public key
  transaction: string; // base64-encoded VersionedTransaction
  requestId: string;
}

export interface JupiterCancelOrderResponse {
  transaction: string; // base64-encoded VersionedTransaction
  requestId: string;
}

export interface JupiterTriggerOrder {
  orderKey: string;
  maker: string;
  inputMint: string;
  outputMint: string;
  makingAmount: string;
  takingAmount: string;
  expiredAt: number | null;
  status: string;
  createdAt: string;
}

export interface JupiterGetOrdersResponse {
  orders: JupiterTriggerOrder[];
  hasMoreData: boolean;
}

// ─── API Client ─────────────────────────────────────────────

export async function createJupiterLimitOrder(params: {
  inputMint: string;
  outputMint: string;
  maker: string;
  makingAmount: string;
  takingAmount: string;
  expiredAt?: number;
}): Promise<JupiterCreateOrderResponse | null> {
  try {
    const response = await fetchWithRetry(`${JUPITER_TRIGGER_API}/createOrder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        maker: params.maker,
        payer: params.maker,
        params: {
          makingAmount: params.makingAmount,
          takingAmount: params.takingAmount,
          expiredAt: params.expiredAt,
        },
        computeUnitPrice: "auto",
        wrapAndUnwrapSol: true,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn({ status: response.status, body: text }, "Jupiter create order failed");
      return null;
    }

    return (await response.json()) as JupiterCreateOrderResponse;
  } catch (err) {
    logger.error({ err }, "Failed to create Jupiter limit order");
    return null;
  }
}

export async function cancelJupiterLimitOrder(
  maker: string,
  orderKey: string,
): Promise<JupiterCancelOrderResponse | null> {
  try {
    const response = await fetchWithRetry(`${JUPITER_TRIGGER_API}/cancelOrder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maker,
        order: orderKey,
        computeUnitPrice: "auto",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn({ status: response.status, body: text }, "Jupiter cancel order failed");
      return null;
    }

    return (await response.json()) as JupiterCancelOrderResponse;
  } catch (err) {
    logger.error({ err }, "Failed to cancel Jupiter limit order");
    return null;
  }
}

export async function getJupiterOpenOrders(
  wallet: string,
): Promise<JupiterTriggerOrder[]> {
  try {
    const params = new URLSearchParams({ user: wallet, orderStatus: "active" });
    const response = await fetchWithRetry(
      `${JUPITER_TRIGGER_API}/getTriggerOrders?${params.toString()}`,
      { headers: { Accept: "application/json" } },
    );

    if (!response.ok) {
      logger.warn({ status: response.status }, "Jupiter get orders failed");
      return [];
    }

    const data = (await response.json()) as JupiterGetOrdersResponse;
    return data.orders;
  } catch (err) {
    logger.error({ err }, "Failed to get Jupiter open orders");
    return [];
  }
}
