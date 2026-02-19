import { getLogger } from "@chainclaw/core";
import type { SkillResult } from "@chainclaw/core";
import type { SkillDefinition, SkillExecutionContext } from "@chainclaw/skills";

const logger = getLogger("sandbox");

export interface SandboxOptions {
  /** Execution timeout in milliseconds (default: 5000) */
  timeoutMs?: number;
  /** Max characters for sendReply/requestConfirmation output (default: 4096) */
  maxOutputLength?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_OUTPUT = 4096;

/**
 * Wraps skill execution with timeout and output-length guards.
 * Provides a lightweight safety layer for community skills.
 */
export class SandboxedExecutor {
  private timeoutMs: number;
  private maxOutputLength: number;

  constructor(options: SandboxOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputLength = options.maxOutputLength ?? DEFAULT_MAX_OUTPUT;
  }

  /**
   * Wrap a SkillDefinition so its execute() runs with timeout
   * and output-length guards.
   */
  wrap(skill: SkillDefinition): SkillDefinition {
    const { timeoutMs, maxOutputLength } = this;

    return {
      ...skill,
      async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
        // Proxy sendReply to enforce output length
        const proxiedContext: SkillExecutionContext = {
          ...context,
          sendReply: async (text: string) => {
            const truncated =
              text.length > maxOutputLength
                ? text.slice(0, maxOutputLength) + "\n...(truncated)"
                : text;
            await context.sendReply(truncated);
          },
          requestConfirmation: context.requestConfirmation
            ? async (prompt: string) => {
                const truncated =
                  prompt.length > maxOutputLength
                    ? prompt.slice(0, maxOutputLength) + "...(truncated)"
                    : prompt;
                return context.requestConfirmation!(truncated);
              }
            : undefined,
        };

        // Execute with timeout
        const timeoutPromise = new Promise<SkillResult>((_, reject) => {
          setTimeout(
            () => reject(new Error(`Skill "${skill.name}" timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        });

        try {
          const result = await Promise.race([skill.execute(params, proxiedContext), timeoutPromise]);
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown sandbox error";
          logger.error({ err, skill: skill.name }, "Sandboxed skill execution failed");
          return {
            success: false,
            message: `Skill error: ${message}`,
          };
        }
      },
    };
  }
}
