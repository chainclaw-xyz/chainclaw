import { getLogger } from "@chainclaw/core";
import type { SkillDefinition } from "./types.js";

const logger = getLogger("skill-registry");

export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();

  register(skill: SkillDefinition): void {
    if (this.skills.has(skill.name)) {
      logger.warn({ skill: skill.name }, "Overwriting existing skill");
    }
    this.skills.set(skill.name, skill);
    logger.info({ skill: skill.name }, "Skill registered");
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  list(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }
}
