import { z } from "zod";
import { getLogger, type SkillResult } from "@chainclaw/core";
import type { SkillRegistry } from "./registry.js";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";

const logger = getLogger("skill-workflow");

const stepSchema = z.object({
  skill: z.string(),
  params: z.record(z.unknown()),
});

const workflowParams = z.object({
  steps: z.array(stepSchema).min(1).max(10),
});

export interface WorkflowStep {
  skill: string;
  params: Record<string, unknown>;
}

export interface WorkflowResult {
  totalSteps: number;
  completedSteps: number;
  failedAtStep: number | null;
  results: Array<{ step: number; skill: string; success: boolean; message: string }>;
}

export function createWorkflowSkill(registry: SkillRegistry): SkillDefinition {
  return {
    name: "workflow",
    description:
      "Execute a multi-step workflow by chaining skills sequentially. " +
      "Example: bridge ETH to Arbitrum, swap half to USDC, supply to Aave. " +
      "Stops on first failure and reports which steps completed.",
    parameters: workflowParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = workflowParams.parse(params);
      const { steps } = parsed;

      logger.info({ stepCount: steps.length, skills: steps.map((s) => s.skill) }, "Starting workflow");

      await context.sendReply(
        `*Workflow Started* (${steps.length} steps)\n\n` +
        steps.map((s, i) => `${i + 1}. ${s.skill} ${summarizeParams(s.params)}`).join("\n"),
      );

      const workflowResult: WorkflowResult = {
        totalSteps: steps.length,
        completedSteps: 0,
        failedAtStep: null,
        results: [],
      };

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepNum = i + 1;
        if (!registry.has(step.skill)) {
          const msg = `Step ${stepNum}: Unknown skill "${step.skill}"`;
          workflowResult.failedAtStep = stepNum;
          workflowResult.results.push({ step: stepNum, skill: step.skill, success: false, message: msg });
          await context.sendReply(`*Step ${stepNum} Failed:* ${msg}`);
          break;
        }

        if (step.skill === "workflow") {
          const msg = `Step ${stepNum}: Cannot nest workflows`;
          workflowResult.failedAtStep = stepNum;
          workflowResult.results.push({ step: stepNum, skill: step.skill, success: false, message: msg });
          await context.sendReply(`*Step ${stepNum} Failed:* ${msg}`);
          break;
        }

        await context.sendReply(`*Step ${stepNum}/${steps.length}:* ${step.skill}...`);

        try {
          const result = await registry.executeSkill(step.skill, step.params, context);

          workflowResult.results.push({
            step: stepNum,
            skill: step.skill,
            success: result.success,
            message: result.message,
          });

          if (!result.success) {
            workflowResult.failedAtStep = stepNum;
            await context.sendReply(`*Step ${stepNum} Failed:* ${result.message}`);
            break;
          }

          workflowResult.completedSteps = stepNum;
          logger.info({ stepNum, skill: step.skill }, "Workflow step completed");
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          workflowResult.failedAtStep = stepNum;
          workflowResult.results.push({
            step: stepNum,
            skill: step.skill,
            success: false,
            message: errMsg,
          });
          await context.sendReply(`*Step ${stepNum} Error:* ${errMsg}`);
          logger.error({ err, stepNum, skill: step.skill }, "Workflow step threw");
          break;
        }
      }

      // Build summary
      const allPassed = workflowResult.completedSteps === workflowResult.totalSteps;
      const summaryLines = [
        allPassed
          ? `*Workflow Complete* (${workflowResult.totalSteps}/${workflowResult.totalSteps} steps)`
          : `*Workflow Stopped* (${workflowResult.completedSteps}/${workflowResult.totalSteps} steps completed)`,
        "",
      ];

      for (const r of workflowResult.results) {
        const icon = r.success ? "+" : "-";
        summaryLines.push(`${icon} Step ${r.step} (${r.skill}): ${r.success ? "done" : "failed"}`);
      }

      if (workflowResult.failedAtStep && workflowResult.failedAtStep < workflowResult.totalSteps) {
        const skipped = workflowResult.totalSteps - workflowResult.failedAtStep;
        summaryLines.push(`\n_${skipped} step(s) skipped due to failure._`);
      }

      return {
        success: allPassed,
        message: summaryLines.join("\n"),
        data: workflowResult,
      };
    },
  };
}

function summarizeParams(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") {
      parts.push(`${key}=${JSON.stringify(value)}`);
    }
  }
  return parts.length > 0 ? `(${parts.join(", ")})` : "";
}
