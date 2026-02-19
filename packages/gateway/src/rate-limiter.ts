/**
 * Simple in-memory sliding-window rate limiter.
 * Tracks timestamps per userId and rejects if more than `limit` messages
 * arrive within `windowMs`.
 */
export class RateLimiter {
  private store = new Map<string, number[]>();

  constructor(
    private limit: number = 10,
    private windowMs: number = 60_000,
  ) {}

  isLimited(userId: string): boolean {
    const now = Date.now();
    const timestamps = this.store.get(userId) ?? [];
    const recent = timestamps.filter((t) => now - t < this.windowMs);
    recent.push(now);
    this.store.set(userId, recent);
    return recent.length > this.limit;
  }
}
