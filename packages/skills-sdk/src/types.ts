import { z } from "zod";

// Re-export existing skill types for SDK consumers
export type { SkillDefinition, SkillExecutionContext, UserPreferences } from "@chainclaw/skills";
export type { SkillResult } from "@chainclaw/core";

// ─── Skill Permissions ──────────────────────────────────────

export const SKILL_PERMISSIONS = [
  "wallet:read",
  "wallet:sign",
  "network:read",
  "network:write",
  "storage:read",
  "storage:write",
  "http:outbound",
] as const;

export type SkillPermission = (typeof SKILL_PERMISSIONS)[number];

// ─── Skill Manifest ─────────────────────────────────────────

export const skillManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "Skill name must be lowercase alphanumeric with hyphens"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Must be semver (e.g. 1.0.0)"),
  description: z.string().min(1).max(256),
  author: z.string().min(1).max(64),
  permissions: z
    .array(z.enum(SKILL_PERMISSIONS))
    .default([]),
  chainclaw: z.string().default(">=0.1.0"),
  homepage: z.string().url().optional(),
  repository: z.string().url().optional(),
});

export type SkillManifest = z.infer<typeof skillManifestSchema>;

// ─── Packaged Skill ─────────────────────────────────────────

export type SkillFactory = () => import("@chainclaw/skills").SkillDefinition;

export interface PackagedSkill {
  manifest: SkillManifest;
  factory: SkillFactory;
}
