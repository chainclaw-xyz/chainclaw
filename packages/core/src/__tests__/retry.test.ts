import { describe, it, expect, vi } from "vitest";
import { computeBackoff, sleepWithAbort, retryAsync } from "../retry.js";

describe("computeBackoff", () => {
  it("returns initialMs for attempt 1 (no jitter)", () => {
    const delay = computeBackoff({ initialMs: 100, jitter: 0 }, 1);
    expect(delay).toBe(100);
  });

  it("doubles each attempt with factor 2", () => {
    const d1 = computeBackoff({ initialMs: 100, factor: 2, jitter: 0 }, 1);
    const d2 = computeBackoff({ initialMs: 100, factor: 2, jitter: 0 }, 2);
    const d3 = computeBackoff({ initialMs: 100, factor: 2, jitter: 0 }, 3);
    expect(d1).toBe(100);
    expect(d2).toBe(200);
    expect(d3).toBe(400);
  });

  it("clamps to maxMs", () => {
    const delay = computeBackoff({ initialMs: 100, factor: 2, maxMs: 300, jitter: 0 }, 10);
    expect(delay).toBe(300);
  });

  it("adds jitter within expected range", () => {
    const results = new Set<number>();
    for (let i = 0; i < 50; i++) {
      results.add(computeBackoff({ initialMs: 1000, jitter: 0.5 }, 1));
    }
    // All results should be between 1000 and 1500
    for (const r of results) {
      expect(r).toBeGreaterThanOrEqual(1000);
      expect(r).toBeLessThanOrEqual(1500);
    }
    // Should have some variation (not all identical)
    expect(results.size).toBeGreaterThan(1);
  });
});

describe("sleepWithAbort", () => {
  it("resolves after delay", async () => {
    const start = Date.now();
    await sleepWithAbort(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it("rejects immediately if signal already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleepWithAbort(1000, controller.signal)).rejects.toThrow();
  });

  it("rejects when signal fires during sleep", async () => {
    const controller = new AbortController();
    const promise = sleepWithAbort(5000, controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(promise).rejects.toThrow();
  });
});

describe("retryAsync", () => {
  it("returns on first success without retry", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryAsync(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to maxAttempts", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("ok");

    const result = await retryAsync(fn, {
      maxAttempts: 3,
      initialDelayMs: 1,
      jitter: 0,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws last error when all attempts exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(
      retryAsync(fn, { maxAttempts: 2, initialDelayMs: 1, jitter: 0 }),
    ).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("respects shouldRetry predicate", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("non-retryable"));
    await expect(
      retryAsync(fn, {
        maxAttempts: 3,
        initialDelayMs: 1,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow("non-retryable");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls onRetry callback before each retry", async () => {
    const onRetry = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    await retryAsync(fn, {
      maxAttempts: 2,
      initialDelayMs: 1,
      jitter: 0,
      onRetry,
    });
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, expect.any(Number));
  });

  it("uses retryAfterMs override when provided", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValue("ok");

    const start = Date.now();
    await retryAsync(fn, {
      maxAttempts: 2,
      initialDelayMs: 5000, // would wait 5s without override
      retryAfterMs: () => 10, // override to 10ms
      jitter: 0,
    });
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("aborts on signal", async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    setTimeout(() => controller.abort(), 20);

    await expect(
      retryAsync(fn, {
        maxAttempts: 10,
        initialDelayMs: 100,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it("passes attempt number to fn", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("1"))
      .mockResolvedValue("ok");

    await retryAsync(fn, { maxAttempts: 2, initialDelayMs: 1, jitter: 0 });
    expect(fn).toHaveBeenNthCalledWith(1, 1);
    expect(fn).toHaveBeenNthCalledWith(2, 2);
  });
});
