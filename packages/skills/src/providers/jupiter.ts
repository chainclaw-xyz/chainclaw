import { getLogger, fetchWithRetry } from "@chainclaw/core";

const logger = getLogger("jupiter");

const JUPITER_API = "https://quote-api.jup.ag/v6";

// ─── Types ──────────────────────────────────────────────────

export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }>;
  contextSlot: number;
  timeTaken: number;
}

export interface JupiterSwapResponse {
  swapTransaction: string; // base64-encoded serialized VersionedTransaction
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

// ─── API Client ─────────────────────────────────────────────

/**
 * Get a swap quote from Jupiter V6 API.
 */
export async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps: number,
): Promise<JupiterQuote | null> {
  try {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount,
      slippageBps: String(slippageBps),
    });

    const response = await fetchWithRetry(
      `${JUPITER_API}/quote?${params.toString()}`,
      { headers: { Accept: "application/json" } },
    );

    if (!response.ok) {
      logger.warn({ status: response.status }, "Jupiter quote API error");
      return null;
    }

    return (await response.json()) as JupiterQuote;
  } catch (err) {
    logger.error({ err }, "Failed to get Jupiter quote");
    return null;
  }
}

/**
 * Get a swap transaction from Jupiter V6 API.
 * Returns a base64-encoded serialized VersionedTransaction.
 */
export async function getJupiterSwapTransaction(
  quoteResponse: JupiterQuote,
  userPublicKey: string,
): Promise<JupiterSwapResponse | null> {
  try {
    const response = await fetchWithRetry(`${JUPITER_API}/swap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn({ status: response.status, body: text }, "Jupiter swap API error");
      return null;
    }

    return (await response.json()) as JupiterSwapResponse;
  } catch (err) {
    logger.error({ err }, "Failed to get Jupiter swap transaction");
    return null;
  }
}

/**
 * Format a token amount from smallest unit to human-readable.
 */
export function formatSolanaTokenAmount(rawAmount: string, decimals: number): string {
  const value = Number(BigInt(rawAmount)) / 10 ** decimals;
  if (value < 0.0001) return "<0.0001";
  if (value < 1) return value.toFixed(4);
  if (value < 10000) return value.toFixed(2);
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
