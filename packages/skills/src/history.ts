import { z } from "zod";
import { getLogger, type SkillResult } from "@chainclaw/core";
import type { TransactionLog, TransactionRecord } from "@chainclaw/pipeline";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";

const logger = getLogger("skill-history");

const historyParams = z.object({
  limit: z.number().optional().default(10),
  format: z.enum(["text", "csv", "json"]).optional().default("text"),
});

export function createHistorySkill(txLog: TransactionLog): SkillDefinition {
  return {
    name: "history",
    description:
      "View your transaction history. Supports text, CSV, and JSON export formats.",
    parameters: historyParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = historyParams.parse(params);
      const { limit, format } = parsed;

      logger.info({ userId: context.userId, limit, format }, "Fetching transaction history");

      const records = txLog.getByUser(context.userId, limit);

      if (records.length === 0) {
        return {
          success: true,
          message: "No transactions found. Your transaction history will appear here after you execute swaps or other on-chain actions.",
        };
      }

      if (format === "csv") {
        return {
          success: true,
          message: formatCsv(records),
        };
      }

      if (format === "json") {
        return {
          success: true,
          message: "```json\n" + JSON.stringify(records, null, 2) + "\n```",
        };
      }

      return {
        success: true,
        message: txLog.formatHistory(records),
      };
    },
  };
}

function formatCsv(records: TransactionRecord[]): string {
  const lines = [
    "id,date,skill,status,chain,from,to,value,hash,gas_used,error",
  ];

  for (const tx of records) {
    const date = tx.createdAt?.split("T")[0] ?? "";
    const hash = tx.hash ?? "";
    const gasUsed = tx.gasUsed ?? "";
    const error = tx.error?.replace(/,/g, ";") ?? "";

    lines.push(
      [
        tx.id,
        date,
        tx.skillName,
        tx.status,
        tx.chainId,
        tx.from,
        tx.to,
        tx.value,
        hash,
        gasUsed,
        error,
      ].join(","),
    );
  }

  return "```\n" + lines.join("\n") + "\n```";
}
