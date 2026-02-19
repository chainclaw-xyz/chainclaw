import { describe, it, expect } from "vitest";
import { z } from "zod";
import { SkillRegistry } from "../registry.js";
import type { SkillDefinition } from "../types.js";

function createMockSkill(name: string): SkillDefinition {
  return {
    name,
    description: `Mock ${name} skill`,
    parameters: z.object({}),
    async execute() {
      return { success: true, message: "ok" };
    },
  };
}

describe("SkillRegistry", () => {
  it("starts empty", () => {
    const registry = new SkillRegistry();
    expect(registry.list()).toHaveLength(0);
  });

  it("registers and retrieves a skill", () => {
    const registry = new SkillRegistry();
    const skill = createMockSkill("balance");

    registry.register(skill);

    expect(registry.has("balance")).toBe(true);
    expect(registry.get("balance")).toBe(skill);
  });

  it("lists all registered skills", () => {
    const registry = new SkillRegistry();
    registry.register(createMockSkill("balance"));
    registry.register(createMockSkill("swap"));

    const skills = registry.list();
    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.name)).toContain("balance");
    expect(skills.map((s) => s.name)).toContain("swap");
  });

  it("returns undefined for unregistered skill", () => {
    const registry = new SkillRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
    expect(registry.has("nonexistent")).toBe(false);
  });

  it("overwrites existing skill with same name", () => {
    const registry = new SkillRegistry();
    const skill1 = createMockSkill("balance");
    const skill2 = createMockSkill("balance");

    registry.register(skill1);
    registry.register(skill2);

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("balance")).toBe(skill2);
  });
});
