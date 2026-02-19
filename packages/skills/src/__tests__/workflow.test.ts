import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWorkflowSkill } from "../workflow.js";
import type { SkillExecutionContext } from "../types.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function mockContext(): SkillExecutionContext {
  return {
    userId: "user-1",
    walletAddress: "0xABCdef1234567890abcdef1234567890ABCDEF12",
    chainIds: [1],
    sendReply: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockRegistry(skills: Record<string, any> = {}) {
  return {
    get: vi.fn((name: string) => skills[name] ?? null),
    list: vi.fn(() => Object.values(skills)),
    register: vi.fn(),
  };
}

describe("createWorkflowSkill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes all steps in order", async () => {
    const mockSkillA = {
      name: "skillA",
      execute: vi.fn().mockResolvedValue({ success: true, message: "A done" }),
    };
    const mockSkillB = {
      name: "skillB",
      execute: vi.fn().mockResolvedValue({ success: true, message: "B done" }),
    };
    const registry = createMockRegistry({ skillA: mockSkillA, skillB: mockSkillB });

    const skill = createWorkflowSkill(registry as any);
    const result = await skill.execute(
      { steps: [{ skill: "skillA", params: {} }, { skill: "skillB", params: {} }] },
      mockContext(),
    );
    expect(result.success).toBe(true);
    expect(mockSkillA.execute).toHaveBeenCalledOnce();
    expect(mockSkillB.execute).toHaveBeenCalledOnce();
    expect(result.message).toContain("Workflow Complete");
  });

  it("stops on first failure and reports partial completion", async () => {
    const mockSkillA = {
      name: "skillA",
      execute: vi.fn().mockResolvedValue({ success: true, message: "A done" }),
    };
    const mockSkillB = {
      name: "skillB",
      execute: vi.fn().mockResolvedValue({ success: false, message: "B failed" }),
    };
    const mockSkillC = {
      name: "skillC",
      execute: vi.fn().mockResolvedValue({ success: true, message: "C done" }),
    };
    const registry = createMockRegistry({ skillA: mockSkillA, skillB: mockSkillB, skillC: mockSkillC });

    const skill = createWorkflowSkill(registry as any);
    const result = await skill.execute(
      { steps: [{ skill: "skillA", params: {} }, { skill: "skillB", params: {} }, { skill: "skillC", params: {} }] },
      mockContext(),
    );
    expect(result.success).toBe(false);
    expect(mockSkillC.execute).not.toHaveBeenCalled();
    expect(result.message).toContain("Workflow Stopped");
    expect(result.message).toContain("1/3");
  });

  it("unknown skill name fails the step", async () => {
    const registry = createMockRegistry({});
    const ctx = mockContext();
    const skill = createWorkflowSkill(registry as any);
    const result = await skill.execute(
      { steps: [{ skill: "nonexistent", params: {} }] },
      ctx,
    );
    expect(result.success).toBe(false);
    // Detailed error goes to sendReply; summary goes to result.message
    expect(ctx.sendReply).toHaveBeenCalledWith(expect.stringContaining("Unknown skill"));
    expect((result.data as any).results[0].message).toContain("Unknown skill");
  });

  it("child skill throws — caught, step marked failed", async () => {
    const throwingSkill = {
      name: "throws",
      execute: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const registry = createMockRegistry({ throws: throwingSkill });

    const ctx = mockContext();
    const skill = createWorkflowSkill(registry as any);
    const result = await skill.execute(
      { steps: [{ skill: "throws", params: {} }] },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(ctx.sendReply).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect((result.data as any).results[0].message).toContain("boom");
  });

  it("prevents nested workflow", async () => {
    const workflowSelf = { name: "workflow", execute: vi.fn() };
    const registry = createMockRegistry({ workflow: workflowSelf });

    const ctx = mockContext();
    const skill = createWorkflowSkill(registry as any);
    const result = await skill.execute(
      { steps: [{ skill: "workflow", params: {} }] },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(ctx.sendReply).toHaveBeenCalledWith(expect.stringContaining("Cannot nest workflows"));
    expect(workflowSelf.execute).not.toHaveBeenCalled();
  });

  it("empty steps array fails validation", async () => {
    const registry = createMockRegistry({});
    const skill = createWorkflowSkill(registry as any);
    await expect(skill.execute({ steps: [] }, mockContext())).rejects.toThrow();
  });

  it("exceeds 10 steps fails validation", async () => {
    const registry = createMockRegistry({});
    const skill = createWorkflowSkill(registry as any);
    const steps = Array.from({ length: 11 }, (_, i) => ({ skill: `s${i}`, params: {} }));
    await expect(skill.execute({ steps }, mockContext())).rejects.toThrow();
  });
});
