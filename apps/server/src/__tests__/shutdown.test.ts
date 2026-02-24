import { describe, it, expect, vi } from "vitest";
import { shutdownStep } from "../shutdown.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe("shutdownStep", () => {
  it("completes a synchronous step", async () => {
    const fn = vi.fn();
    await shutdownStep(1, 3, "Test sync", fn, 5_000, Date.now());
    expect(fn).toHaveBeenCalledOnce();
  });

  it("completes an async step", async () => {
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    await shutdownStep(1, 3, "Test async", fn, 5_000, Date.now());
    expect(fn).toHaveBeenCalledOnce();
  });

  it("does not throw when the step throws", async () => {
    const fn = vi.fn(() => {
      throw new Error("boom");
    });
    // Should not throw — errors are caught and logged
    await expect(shutdownStep(1, 3, "Test throw", fn, 5_000, Date.now())).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("does not throw when an async step rejects", async () => {
    const fn = vi.fn(async () => {
      throw new Error("async boom");
    });
    await expect(shutdownStep(1, 3, "Test reject", fn, 5_000, Date.now())).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("times out a hanging async step", async () => {
    const fn = vi.fn((): Promise<void> => new Promise(() => {/* never resolves */}));
    const start = Date.now();
    await shutdownStep(1, 3, "Test hang", fn, 100, start);
    // Should complete within ~100ms + tolerance, not hang forever
    expect(Date.now() - start).toBeLessThan(500);
    expect(fn).toHaveBeenCalledOnce();
  });
});
