import { retryAsync } from "./retry.js";
import { isTransientNetworkError } from "./errors.js";
import { getLogger } from "./logger.js";

const logger = getLogger("fetch");

// ─── HTTP Retry Error ──────────────────────────────────────

const DEFAULT_RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/**
 * Thrown internally when fetch returns a retryable HTTP status.
 * Never escapes the retry loop under normal operation.
 */
export class HttpRetryError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;

  constructor(status: number, statusText: string, retryAfterMs?: number) {
    super(`HTTP ${status}: ${statusText}`);
    this.name = "HttpRetryError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

// ─── Options ───────────────────────────────────────────────

export interface FetchWithRetryOptions {
  /** Max total attempts including the first (default: 3). */
  maxAttempts?: number;
  /** Additional HTTP statuses to retry on, appended to 429/502/503/504. */
  retryableStatuses?: number[];
  /** Initial delay in ms (default: 300). */
  initialDelayMs?: number;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

// ─── fetchWithRetry ────────────────────────────────────────

/**
 * Fetch with automatic retry on transient network errors and retryable HTTP statuses.
 *
 * Retries when:
 * - fetch() itself throws a transient error (ECONNRESET, ETIMEDOUT, DNS, etc.)
 * - The response has a retryable status (429, 502, 503, 504)
 *
 * Non-retryable responses (400, 401, 403, 404, etc.) pass through as a normal
 * Response — the caller still checks `response.ok`.
 */
export async function fetchWithRetry(
  url: string | URL,
  init?: RequestInit,
  opts?: FetchWithRetryOptions,
): Promise<Response> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const retryableStatuses = new Set([
    ...DEFAULT_RETRYABLE_STATUSES,
    ...(opts?.retryableStatuses ?? []),
  ]);

  return retryAsync(
    async () => {
      const response = await fetch(url, init);

      if (!response.ok && retryableStatuses.has(response.status)) {
        let retryAfterMs: number | undefined;
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter) {
          const seconds = Number(retryAfter);
          if (!Number.isNaN(seconds)) {
            retryAfterMs = seconds * 1000;
          }
        }
        throw new HttpRetryError(response.status, response.statusText, retryAfterMs);
      }

      return response;
    },
    {
      maxAttempts,
      initialDelayMs: opts?.initialDelayMs ?? 300,
      signal: opts?.signal,
      shouldRetry: (err) =>
        isTransientNetworkError(err) || err instanceof HttpRetryError,
      retryAfterMs: (err) =>
        err instanceof HttpRetryError ? err.retryAfterMs : undefined,
      onRetry: (_err, attempt, delayMs) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        const short = urlStr.length > 80 ? urlStr.substring(0, 80) + "..." : urlStr;
        logger.warn({ url: short, attempt, delayMs }, "Retrying fetch");
      },
    },
  );
}
