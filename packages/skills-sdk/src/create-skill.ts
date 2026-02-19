import { getLogger } from "@chainclaw/core";
import { skillManifestSchema, type SkillManifest, type SkillFactory, type PackagedSkill } from "./types.js";

const logger = getLogger("skills-sdk");

/**
 * Define a packaged skill with a validated manifest and factory function.
 * The factory is called once at definition time to verify the skill name matches the manifest.
 */
export function defineSkill(manifest: SkillManifest, factory: SkillFactory): PackagedSkill {
  const parsed = skillManifestSchema.parse(manifest);

  // Validate factory produces a skill with matching name
  const testSkill = factory();
  if (testSkill.name !== parsed.name) {
    throw new Error(
      `Skill name mismatch: manifest says "${parsed.name}" but factory creates "${testSkill.name}"`,
    );
  }

  logger.info({ skill: parsed.name, version: parsed.version }, "Skill defined");

  return {
    manifest: parsed,
    factory,
  };
}
