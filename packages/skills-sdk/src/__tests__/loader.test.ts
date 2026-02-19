import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillLoader } from "../loader.js";

// Mock @chainclaw/core logger
vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock SkillRegistry
function createMockRegistry() {
  const skills = new Map<string, unknown>();
  return {
    register: vi.fn((skill: any) => skills.set(skill.name, skill)),
    get: (name: string) => skills.get(name),
    list: () => Array.from(skills.values()),
    has: (name: string) => skills.has(name),
  };
}

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `chainclaw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("SkillLoader", () => {
  it("returns empty results for non-existent directory", async () => {
    const loader = new SkillLoader();
    const registry = createMockRegistry();

    const result = await loader.loadFromDirectory("/nonexistent/path", registry as any);

    expect(result.loaded).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("returns empty results for empty directory", async () => {
    const loader = new SkillLoader();
    const registry = createMockRegistry();

    const result = await loader.loadFromDirectory(testDir, registry as any);

    expect(result.loaded).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("reports error for directory without chainclaw-skill.json", async () => {
    const skillDir = join(testDir, "bad-skill");
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, "package.json"), JSON.stringify({ main: "index.js" }));

    const loader = new SkillLoader();
    const registry = createMockRegistry();

    const result = await loader.loadFromDirectory(testDir, registry as any);

    expect(result.loaded).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.dir).toBe("bad-skill");
    expect(result.errors[0]!.error).toContain("chainclaw-skill.json");
  });

  it("reports error for invalid manifest", async () => {
    const skillDir = join(testDir, "invalid-manifest");
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, "chainclaw-skill.json"), JSON.stringify({ name: "Bad Name!" }));
    writeFileSync(join(skillDir, "package.json"), JSON.stringify({ main: "index.js" }));

    const loader = new SkillLoader();
    const registry = createMockRegistry();

    const result = await loader.loadFromDirectory(testDir, registry as any);

    expect(result.loaded).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.dir).toBe("invalid-manifest");
  });

  it("loads a valid skill package with bare SkillDefinition export", async () => {
    const skillDir = join(testDir, "good-skill");
    mkdirSync(skillDir);

    writeFileSync(
      join(skillDir, "chainclaw-skill.json"),
      JSON.stringify({
        name: "good-skill",
        version: "1.0.0",
        description: "A good skill",
        author: "tester",
      }),
    );
    writeFileSync(join(skillDir, "package.json"), JSON.stringify({ main: "index.mjs" }));
    writeFileSync(
      join(skillDir, "index.mjs"),
      `export default {
        name: "good-skill",
        description: "A good skill",
        parameters: { parse: (p) => p },
        execute: async () => ({ success: true, message: "hello" }),
      };`,
    );

    const loader = new SkillLoader();
    const registry = createMockRegistry();

    const result = await loader.loadFromDirectory(testDir, registry as any);

    expect(result.loaded).toEqual(["good-skill"]);
    expect(result.errors).toHaveLength(0);
    expect(registry.register).toHaveBeenCalledTimes(1);
  });

  it("wraps loaded skills in sandbox (timeout enforced)", async () => {
    const skillDir = join(testDir, "slow-skill");
    mkdirSync(skillDir);

    writeFileSync(
      join(skillDir, "chainclaw-skill.json"),
      JSON.stringify({
        name: "slow-skill",
        version: "1.0.0",
        description: "A slow skill",
        author: "tester",
      }),
    );
    writeFileSync(join(skillDir, "package.json"), JSON.stringify({ main: "index.mjs" }));
    writeFileSync(
      join(skillDir, "index.mjs"),
      `export default {
        name: "slow-skill",
        description: "Slow",
        parameters: { parse: (p) => p },
        execute: () => new Promise((resolve) => setTimeout(() => resolve({ success: true, message: "late" }), 500)),
      };`,
    );

    const loader = new SkillLoader({ sandbox: { timeoutMs: 50 } });
    const registry = createMockRegistry();

    await loader.loadFromDirectory(testDir, registry as any);

    // The registered skill should be sandboxed — execute should time out
    const registered = registry.register.mock.calls[0]![0] as any;
    const result = await registered.execute({}, {
      userId: "u1",
      walletAddress: null,
      chainIds: [1],
      sendReply: async () => {},
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("timed out");
  });
});
