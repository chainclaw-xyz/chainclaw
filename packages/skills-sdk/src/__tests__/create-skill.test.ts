import { describe, it, expect, vi } from "vitest";
import { defineSkill } from "../create-skill.js";
import type { SkillManifest } from "../types.js";

// Mock @chainclaw/core logger
vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const makeFactory = (name: string) => () => ({
  name,
  description: "Test skill",
  parameters: { parse: (p: unknown) => p } as any,
  execute: async () => ({ success: true, message: "ok" }),
});

const validManifest: SkillManifest = {
  name: "test-skill",
  version: "1.0.0",
  description: "A test skill",
  author: "tester",
  permissions: ["wallet:read"],
  chainclaw: ">=0.1.0",
};

describe("defineSkill", () => {
  it("creates a packaged skill with valid manifest and factory", () => {
    const pkg = defineSkill(validManifest, makeFactory("test-skill"));

    expect(pkg.manifest.name).toBe("test-skill");
    expect(pkg.manifest.version).toBe("1.0.0");
    expect(pkg.manifest.permissions).toEqual(["wallet:read"]);
    expect(typeof pkg.factory).toBe("function");

    const skill = pkg.factory();
    expect(skill.name).toBe("test-skill");
  });

  it("throws on name mismatch between manifest and factory", () => {
    expect(() => defineSkill(validManifest, makeFactory("wrong-name"))).toThrow(
      'Skill name mismatch: manifest says "test-skill" but factory creates "wrong-name"',
    );
  });

  it("throws on invalid manifest name format", () => {
    const badManifest = { ...validManifest, name: "Bad Name!" };
    expect(() => defineSkill(badManifest, makeFactory("Bad Name!"))).toThrow();
  });

  it("throws on invalid semver version", () => {
    const badManifest = { ...validManifest, name: "test-skill", version: "not-semver" };
    expect(() => defineSkill(badManifest, makeFactory("test-skill"))).toThrow("semver");
  });

  it("applies default permissions when not provided", () => {
    const minManifest: SkillManifest = {
      name: "minimal",
      version: "0.1.0",
      description: "Minimal skill",
      author: "tester",
      permissions: [],
      chainclaw: ">=0.1.0",
    };

    const pkg = defineSkill(minManifest, makeFactory("minimal"));
    expect(pkg.manifest.permissions).toEqual([]);
  });

  it("throws on missing required fields", () => {
    const incomplete = { name: "test" } as any;
    expect(() => defineSkill(incomplete, makeFactory("test"))).toThrow();
  });
});
