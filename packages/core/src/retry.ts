import { getLogger } from "./logger.js";

const logger = getLogger("retry");

// ─── Backoff ────────────────────────────────────────────────

export interface BackoffPolicy {
  initialMs: number;
  maxMs: number;
  factor: number;
  jitter: number;
}

const DEFAULT_BACKOFF: BackoffPolicy = {
  initialMs: 300,
  maxMs: 30_000,
  factor: 2,
  jitter: 0.2,
};

/**
 * Compute exponential backoff delay with jitter.
 * attempt is 1-based (first retry = attempt 1).
 */
export function computeBackoff(
  policy: Partial<BackoffPolicy>,
  attempt: number,
): number {
  const p = { ...DEFAULT_BACKOFF, ...policy };
  const base = p.initialMs * p.factor ** (attempt - 1);
  const jitterRange = base * p.jitter;
  const delay = base + jitterRange * Math.random();
  return Math.min(delay, p.maxMs);
}

// ─── Sleep with Abort ───────────────────────────────────────

/**
 * Sleep for `ms` with cooperative abort support.
 * Rejects with AbortError if signal is already aborted or fires during sleep.
 */
export function sleepWithAbort(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    const reason = signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Aborted", "AbortError");
    return Promise.reject(reason);
  }
  return new Promise((resolve, reject) => {
    const onTimeout = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };

    const onAbort = () => {
      clearTimeout(timer);
      const reason = signal?.reason instanceof Error
        ? signal.reason
        : new DOMException("Aborted", "AbortError");
      reject(reason);
    };

    const timer = setTimeout(onTimeout, ms);

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

// ─── Retry Async ────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum total attempts (including first). Default: 3 */
  maxAttempts?: number;
  /** Initial delay before first retry in ms. Default: 300 */
  initialDelayMs?: number;
  /** Maximum delay cap in ms. Default: 30_000 */
  maxDelayMs?: number;
  /** Jitter factor (0-1). Default: 0.2 */
  jitter?: number;
  /** Custom predicate to decide if an error is retryable. Default: always retry. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Extract server-provided retry-after delay in ms. Takes priority over backoff. */
  retryAfterMs?: (err: unknown) => number | undefined;
  /** Callback fired before each retry. */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

/**
 * Retry an async function with exponential backoff.
 *
 * @param fn - The function to retry. Receives current attempt (1-based).
 * @param opts - Retry configuration.
 * @returns The result of fn on success.
 * @throws The last error if all attempts are exhausted.
 */
export async function retryAsync<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const policy: Partial<BackoffPolicy> = {
    initialMs: opts.initialDelayMs,
    maxMs: opts.maxDelayMs,
    jitter: opts.jitter,
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts) break;
      if (opts.shouldRetry && !opts.shouldRetry(err, attempt)) break;

      // Compute delay
      let delayMs = computeBackoff(policy, attempt);
      if (opts.retryAfterMs) {
        const override = opts.retryAfterMs(err);
        if (override !== undefined) delayMs = override;
      }

      if (opts.onRetry) {
        opts.onRetry(err, attempt, delayMs);
      }

      logger.debug(
        { attempt, maxAttempts, delayMs },
        "Retrying after error",
      );

      await sleepWithAbort(delayMs, opts.signal);
    }
  }

  throw lastError;
}
