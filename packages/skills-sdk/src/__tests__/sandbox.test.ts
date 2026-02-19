import { describe, it, expect, vi } from "vitest";
import { SandboxedExecutor } from "../sandbox.js";
import type { SkillDefinition, SkillExecutionContext } from "@chainclaw/skills";
import type { SkillResult } from "@chainclaw/core";

// Mock @chainclaw/core logger
vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function makeSkill(executeFn: (params: unknown, ctx: SkillExecutionContext) => Promise<SkillResult>): SkillDefinition {
  return {
    name: "test-skill",
    description: "Test",
    parameters: { parse: (p: unknown) => p } as any,
    execute: executeFn,
  };
}

function makeContext(overrides?: Partial<SkillExecutionContext>): SkillExecutionContext {
  return {
    userId: "user1",
    walletAddress: "0x123",
    chainIds: [1],
    sendReply: vi.fn().mockResolvedValue(undefined),
    requestConfirmation: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("SandboxedExecutor", () => {
  it("executes a skill normally within timeout", async () => {
    const executor = new SandboxedExecutor({ timeoutMs: 5000 });
    const skill = makeSkill(async () => ({ success: true, message: "done" }));
    const wrapped = executor.wrap(skill);
    const ctx = makeContext();

    const result = await wrapped.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.message).toBe("done");
  });

  it("returns error result when skill times out", async () => {
    const executor = new SandboxedExecutor({ timeoutMs: 50 });
    const skill = makeSkill(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true, message: "late" }), 200)),
    );
    const wrapped = executor.wrap(skill);
    const ctx = makeContext();

    const result = await wrapped.execute({}, ctx);

    expect(result.success).toBe(false);
    expect(result.message).toContain("timed out");
    expect(result.message).toContain("test-skill");
  });

  it("truncates long sendReply output", async () => {
    const executor = new SandboxedExecutor({ maxOutputLength: 20 });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const skill = makeSkill(async (_params, ctx) => {
      await ctx.sendReply("This is a very long message that should get truncated");
      return { success: true, message: "ok" };
    });
    const wrapped = executor.wrap(skill);
    const ctx = makeContext({ sendReply });

    await wrapped.execute({}, ctx);

    expect(sendReply).toHaveBeenCalledWith(expect.stringContaining("...(truncated)"));
    const calledWith = sendReply.mock.calls[0]![0] as string;
    expect(calledWith.length).toBeLessThan(60); // 20 chars + truncation notice
  });

  it("truncates long requestConfirmation prompt", async () => {
    const executor = new SandboxedExecutor({ maxOutputLength: 10 });
    const requestConfirmation = vi.fn().mockResolvedValue(true);
    const skill = makeSkill(async (_params, ctx) => {
      await ctx.requestConfirmation!("Are you sure you want to do this very long operation?");
      return { success: true, message: "ok" };
    });
    const wrapped = executor.wrap(skill);
    const ctx = makeContext({ requestConfirmation });

    await wrapped.execute({}, ctx);

    expect(requestConfirmation).toHaveBeenCalledWith(expect.stringContaining("...(truncated)"));
  });

  it("catches thrown errors and returns failure result", async () => {
    const executor = new SandboxedExecutor();
    const skill = makeSkill(async () => {
      throw new Error("Skill crashed!");
    });
    const wrapped = executor.wrap(skill);
    const ctx = makeContext();

    const result = await wrapped.execute({}, ctx);

    expect(result.success).toBe(false);
    expect(result.message).toContain("Skill crashed!");
  });

  it("handles skills without requestConfirmation", async () => {
    const executor = new SandboxedExecutor();
    const skill = makeSkill(async () => ({ success: true, message: "ok" }));
    const wrapped = executor.wrap(skill);
    const ctx = makeContext({ requestConfirmation: undefined });

    const result = await wrapped.execute({}, ctx);

    expect(result.success).toBe(true);
  });
});
