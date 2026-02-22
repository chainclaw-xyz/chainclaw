import { getLogger } from "./logger.js";

const logger = getLogger("errors");

// ─── Error Classification ───────────────────────────────────

export type ErrorCategory = "fatal" | "config" | "transient" | "abort" | "unknown";

const FATAL_CODES = new Set([
  "ERR_OUT_OF_MEMORY",
  "ERR_WORKER_OUT_OF_MEMORY",
  "ERR_WORKER_UNCAUGHT_EXCEPTION",
  "ERR_SCRIPT_EXECUTION_TIMEOUT",
]);

const CONFIG_CODES = new Set([
  "INVALID_CONFIG",
  "MISSING_API_KEY",
  "MISSING_CREDENTIALS",
]);

const TRANSIENT_CODES = new Set([
  // Node.js errno
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "ECONNABORTED",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  // Undici (native fetch)
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_DNS_RESOLVE_FAILED",
  "UND_ERR_CONNECT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/**
 * Extract error code from an error object.
 */
function extractErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * Walk the error cause chain to find a matching code.
 */
function findInCauseChain(
  err: unknown,
  predicate: (code: string) => boolean,
  depth = 0,
): boolean {
  if (depth > 10) return false;

  const code = extractErrorCode(err);
  if (code && predicate(code)) return true;

  if (err && typeof err === "object" && "cause" in err) {
    return findInCauseChain((err as { cause: unknown }).cause, predicate, depth + 1);
  }

  return false;
}

/**
 * Check if an error represents an intentional abort.
 */
export function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err && typeof err === "object" && "name" in err) {
    return (err as { name: string }).name === "AbortError";
  }
  return false;
}

/**
 * Check if an error is a transient network issue that may resolve on retry.
 */
export function isTransientNetworkError(err: unknown): boolean {
  // Direct code check
  if (findInCauseChain(err, (code) => TRANSIENT_CODES.has(code))) return true;

  // TypeError("fetch failed") from undici — wraps transient cause
  if (
    err instanceof TypeError &&
    err.message === "fetch failed" &&
    err.cause
  ) {
    return isTransientNetworkError(err.cause);
  }

  // AggregateError — any element is transient → whole error is transient
  if (err instanceof AggregateError) {
    return err.errors.some((e) => isTransientNetworkError(e));
  }

  return false;
}

/**
 * Classify an error into a category for handling decisions.
 */
export function classifyError(err: unknown): ErrorCategory {
  if (isAbortError(err)) return "abort";
  if (findInCauseChain(err, (code) => FATAL_CODES.has(code))) return "fatal";
  if (findInCauseChain(err, (code) => CONFIG_CODES.has(code))) return "config";
  if (isTransientNetworkError(err)) return "transient";
  return "unknown";
}

// ─── Process-level Handler ──────────────────────────────────

/**
 * Install a process-level unhandled rejection handler that classifies errors
 * and decides whether to exit or continue.
 *
 * - Fatal/config/unknown errors: log and exit(1)
 * - Transient/abort errors: log and continue
 */
export function installUnhandledRejectionHandler(): void {
  process.on("unhandledRejection", (reason: unknown) => {
    const category = classifyError(reason);

    switch (category) {
      case "transient":
        logger.warn(
          { err: reason },
          "Transient network error (unhandled rejection) — continuing",
        );
        break;

      case "abort":
        logger.debug({ err: reason }, "Abort error (unhandled rejection) — expected");
        break;

      case "fatal":
        logger.error({ err: reason }, "Fatal error — exiting");
        process.exit(1);
        break;

      case "config":
        logger.error({ err: reason }, "Configuration error — exiting");
        process.exit(1);
        break;

      default:
        logger.error(
          { err: reason },
          "Unhandled rejection (unknown category) — exiting",
        );
        process.exit(1);
    }
  });
}
