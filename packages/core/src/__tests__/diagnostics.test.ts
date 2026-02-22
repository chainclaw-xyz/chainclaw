import { describe, it, expect, beforeEach } from "vitest";
import { DiagnosticCollector } from "../diagnostics.js";
import { triggerHook, createHookEvent, clearHooks } from "../hooks.js";

describe("DiagnosticCollector", () => {
  let collector: DiagnosticCollector;

  beforeEach(() => {
    clearHooks();
    collector = new DiagnosticCollector();
  });

  it("starts with empty counters", () => {
    const snap = collector.getSnapshot();
    expect(Object.keys(snap.counters)).toHaveLength(0);
    expect(snap.lastEventAt).toBeNull();
    expect(snap.uptime).toBeGreaterThanOrEqual(0);
  });

  it("counts tx events", async () => {
    await triggerHook(createHookEvent("tx", "confirmed", { hash: "0x123" }));
    await triggerHook(createHookEvent("tx", "failed", { error: "reverted" }));

    expect(collector.get("tx:confirmed")).toBe(1);
    expect(collector.get("tx:failed")).toBe(1);
  });

  it("counts cron events", async () => {
    await triggerHook(createHookEvent("cron", "job_started", { jobId: "1" }));
    await triggerHook(createHookEvent("cron", "job_finished", { jobId: "1" }));

    expect(collector.get("cron:job_started")).toBe(1);
    expect(collector.get("cron:job_finished")).toBe(1);
  });

  it("updates lastEventAt on each event", async () => {
    expect(collector.getSnapshot().lastEventAt).toBeNull();

    await triggerHook(createHookEvent("channel", "connected", {}));
    const snap = collector.getSnapshot();
    expect(snap.lastEventAt).toBeGreaterThan(0);
  });

  it("getSnapshot returns all counters", async () => {
    await triggerHook(createHookEvent("tx", "confirmed", {}));
    await triggerHook(createHookEvent("tx", "confirmed", {}));
    await triggerHook(createHookEvent("channel", "error", {}));

    const snap = collector.getSnapshot();
    expect(snap.counters["tx:confirmed"]).toBe(2);
    expect(snap.counters["channel:error"]).toBe(1);
  });

  it("reset clears all state", async () => {
    await triggerHook(createHookEvent("tx", "confirmed", {}));
    collector.reset();

    const snap = collector.getSnapshot();
    expect(Object.keys(snap.counters)).toHaveLength(0);
    expect(snap.lastEventAt).toBeNull();
  });

  it("manual increment works", () => {
    collector.increment("custom:metric", 5);
    expect(collector.get("custom:metric")).toBe(5);
  });
});
