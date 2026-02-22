/**
 * Schedule computation.
 * Ported from OpenClaw's computeNextRunAtMs — pure function, no side effects.
 */
import { Cron } from "croner";
import type { CronSchedule } from "./types.js";

/**
 * Parse an absolute time value to epoch ms.
 */
function parseAbsoluteTimeMs(at: string | number): number {
  if (typeof at === "number") return at;
  const ms = new Date(at).getTime();
  if (Number.isNaN(ms)) throw new Error(`Invalid date: ${at}`);
  return ms;
}

/**
 * Compute the next run timestamp for a schedule.
 * Returns undefined if the schedule is exhausted (e.g. one-shot in the past).
 */
export function computeNextRunAtMs(
  schedule: CronSchedule,
  nowMs: number,
): number | undefined {
  switch (schedule.kind) {
    case "at": {
      const atMs = parseAbsoluteTimeMs(schedule.at);
      return atMs > nowMs ? atMs : undefined;
    }

    case "every": {
      const everyMs = Math.max(1, Math.floor(schedule.everyMs));
      const anchor = Math.max(0, Math.floor(schedule.anchorMs ?? nowMs));

      // If now is before the anchor, the first run is at the anchor
      if (nowMs < anchor) return anchor;

      // Snap to anchor-aligned intervals
      const elapsed = nowMs - anchor;
      const steps = Math.max(1, Math.ceil(elapsed / everyMs));
      const next = anchor + steps * everyMs;

      // If we land exactly on nowMs, push to next interval
      return next <= nowMs ? next + everyMs : next;
    }

    case "cron": {
      const tz = schedule.tz ?? "UTC";
      const cron = new Cron(schedule.expr, { timezone: tz });
      const next = cron.nextRun(new Date(nowMs));
      if (!next) return undefined;

      const nextMs = next.getTime();
      // Guard: if croner returns now or past, advance 1 second and retry
      if (nextMs <= nowMs) {
        const retry = cron.nextRun(new Date(nowMs + 1000));
        return retry ? retry.getTime() : undefined;
      }
      return nextMs;
    }
  }
}
