import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "../rate-limiter.js";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under limit", () => {
    const limiter = new RateLimiter(5, 60_000);
    for (let i = 0; i < 5; i++) {
      expect(limiter.isLimited("user-1")).toBe(false);
    }
  });

  it("blocks at limit+1", () => {
    const limiter = new RateLimiter(3, 60_000);
    expect(limiter.isLimited("user-1")).toBe(false); // 1
    expect(limiter.isLimited("user-1")).toBe(false); // 2
    expect(limiter.isLimited("user-1")).toBe(false); // 3
    expect(limiter.isLimited("user-1")).toBe(true);  // 4 -> limited
  });

  it("resets after window expires", () => {
    const limiter = new RateLimiter(2, 1_000);
    expect(limiter.isLimited("user-1")).toBe(false); // 1
    expect(limiter.isLimited("user-1")).toBe(false); // 2
    expect(limiter.isLimited("user-1")).toBe(true);  // 3 -> limited

    vi.advanceTimersByTime(1_100);

    expect(limiter.isLimited("user-1")).toBe(false); // old timestamps expired
  });

  it("isolates per userId", () => {
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.isLimited("user-a")).toBe(false);
    expect(limiter.isLimited("user-a")).toBe(false);
    expect(limiter.isLimited("user-a")).toBe(true); // user-a limited

    expect(limiter.isLimited("user-b")).toBe(false); // user-b still has quota
    expect(limiter.isLimited("user-b")).toBe(false);
  });

  it("accepts custom limit and window parameters", () => {
    const limiter = new RateLimiter(1, 500);
    expect(limiter.isLimited("user-1")).toBe(false);
    expect(limiter.isLimited("user-1")).toBe(true);

    vi.advanceTimersByTime(600);
    expect(limiter.isLimited("user-1")).toBe(false);
  });
});
