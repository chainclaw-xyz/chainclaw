import { z } from "zod";
import { type Address } from "viem";
import { getLogger, type SkillResult } from "@chainclaw/core";
import type { RiskEngine } from "@chainclaw/pipeline";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";

const logger = getLogger("skill-risk-check");

const riskCheckParams = z.object({
  contractAddress: z.string().min(1, "Contract address is required"),
  chainId: z.number().optional().default(1),
});

export function createRiskCheckSkill(riskEngine: RiskEngine): SkillDefinition {
  return {
    name: "risk_check",
    description:
      "Check the safety and risk of a token or contract. Analyzes honeypot risk, owner privileges, taxes, holder concentration, and more.",
    parameters: riskCheckParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = riskCheckParams.parse(params);
      const { chainId } = parsed;
      let contractAddress = parsed.contractAddress;

      // Resolve ENS name if needed
      if (!/^0x[a-fA-F0-9]{40}$/i.test(contractAddress)) {
        if (!context.resolveAddress) {
          return { success: false, message: "Invalid contract address. Provide a 0x address." };
        }
        try {
          const resolved = await context.resolveAddress(contractAddress);
          await context.sendReply(`_Resolved ${contractAddress} → \`${resolved.slice(0, 6)}...${resolved.slice(-4)}\`_`);
          contractAddress = resolved;
        } catch (err) {
          return { success: false, message: `Could not resolve '${contractAddress}': ${err instanceof Error ? err.message : "Unknown error"}` };
        }
      }

      logger.info({ contractAddress, chainId }, "Running risk check");

      await context.sendReply(`_Analyzing contract ${contractAddress} on chain ${chainId}..._`);

      const report = await riskEngine.analyzeToken(
        chainId,
        contractAddress as Address,
      );

      if (!report) {
        return {
          success: false,
          message: `Could not analyze contract ${contractAddress}. The security API may be unavailable or the address may not be a token contract.`,
        };
      }

      const formatted = riskEngine.formatRiskReport(report);

      // Contract source audit
      let auditSection = "";
      try {
        const auditReport = await riskEngine.auditContract(chainId, contractAddress as Address);
        auditSection = "\n\n" + riskEngine.formatContractAudit(auditReport);
      } catch (err) {
        logger.warn({ err, contractAddress }, "Contract source audit failed");
      }

      // Add action suggestions based on risk level
      let suggestion;
      if (report.riskLevel === "critical" || report.isHoneypot) {
        suggestion =
          "\n\n*Recommendation:* DO NOT interact with this token. It has critical risk indicators.";
      } else if (report.riskLevel === "high") {
        suggestion =
          "\n\n*Recommendation:* Exercise extreme caution. This token has significant risks.";
      } else if (report.riskLevel === "medium") {
        suggestion =
          "\n\n*Recommendation:* Proceed with caution. Review the risks above before trading.";
      } else {
        suggestion =
          "\n\n*Recommendation:* No major risks detected. Always DYOR.";
      }

      return {
        success: true,
        message: formatted + auditSection + suggestion,
      };
    },
  };
}
