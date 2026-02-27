import type { z } from "zod";
import type { SkillResult } from "@chainclaw/core";

export interface SkillDefinition {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: z.ZodType<any>;
  execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult>;
}

export interface UserPreferences {
  defaultChainId?: number;
  slippageTolerance?: number;
  confirmationThreshold?: number;
}

export interface SkillExecutionContext {
  userId: string;
  walletAddress: string | null;
  chainIds: number[];
  sendReply: (text: string) => Promise<void>;
  requestConfirmation?: (prompt: string) => Promise<boolean>;
  preferences?: UserPreferences;
  /** Resolve an ENS name or 0x address to a checksummed address. */
  resolveAddress?: (nameOrAddress: string) => Promise<string>;
}
