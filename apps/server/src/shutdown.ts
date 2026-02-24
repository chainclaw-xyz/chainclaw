import { getLogger } from "@chainclaw/core";

const logger = getLogger("shutdown");

/**
 * Execute a shutdown step with per-step timeout and error isolation.
 * Logs progress and timing. Never throws — a failing step won't block subsequent ones.
 */
export async function shutdownStep(
  step: number,
  totalSteps: number,
  label: string,
  fn: () => void | Promise<void>,
  timeoutMs: number,
  shutdownStart: number,
): Promise<void> {
  const elapsed = () => Date.now() - shutdownStart;
  const tag = `${step}/${totalSteps}`;

  logger.info({ step: tag, elapsedMs: elapsed() }, `Shutdown [${tag}] ${label}...`);

  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      let timer: ReturnType<typeof setTimeout>;
      await Promise.race([
        result,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]).finally(() => clearTimeout(timer!));
    }
    logger.info({ step: tag, elapsedMs: elapsed() }, `Shutdown [${tag}] ${label} done`);
  } catch (err) {
    logger.warn({ err, step: tag, elapsedMs: elapsed() }, `Shutdown [${tag}] ${label} failed — skipping`);
  }
}
