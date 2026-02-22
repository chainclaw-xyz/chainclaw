import { describe, it, expect, afterEach } from "vitest";
import {
  enqueue,
  enqueueInLane,
  setLaneConcurrency,
  getLaneSize,
  getActiveCount,
  getTotalPending,
  clearLane,
  waitForDrain,
  resetAllLanes,
  CommandLaneClearedError,
} from "../command-queue.js";

afterEach(() => {
  resetAllLanes();
});

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("enqueue", () => {
  it("executes a task and returns result", async () => {
    const result = await enqueue(async () => 42);
    expect(result).toBe(42);
  });

  it("propagates task errors", async () => {
    await expect(
      enqueue(async () => { throw new Error("boom"); }),
    ).rejects.toThrow("boom");
  });
});

describe("lane concurrency", () => {
  it("serializes tasks in a lane with concurrency 1", async () => {
    const order: number[] = [];
    setLaneConcurrency("serial", 1);

    const p1 = enqueueInLane("serial", async () => {
      await delay(30);
      order.push(1);
    });
    const p2 = enqueueInLane("serial", async () => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it("runs tasks concurrently when concurrency > 1", async () => {
    const running: number[] = [];
    let maxConcurrent = 0;
    setLaneConcurrency("parallel", 3);

    const tasks = Array.from({ length: 3 }, (_, i) =>
      enqueueInLane("parallel", async () => {
        running.push(i);
        maxConcurrent = Math.max(maxConcurrent, running.length);
        await delay(30);
        running.splice(running.indexOf(i), 1);
      }),
    );

    await Promise.all(tasks);
    expect(maxConcurrent).toBeGreaterThan(1);
  });
});

describe("lane isolation", () => {
  it("different lanes execute independently", async () => {
    setLaneConcurrency("a", 1);
    setLaneConcurrency("b", 1);

    const order: string[] = [];

    const pa = enqueueInLane("a", async () => {
      await delay(30);
      order.push("a");
    });
    const pb = enqueueInLane("b", async () => {
      order.push("b");
    });

    await Promise.all([pa, pb]);
    // b should complete before a since they're in different lanes
    expect(order[0]).toBe("b");
  });
});

describe("getLaneSize / getActiveCount / getTotalPending", () => {
  it("tracks queue sizes", async () => {
    setLaneConcurrency("sized", 1);

    let resolveFirst!: () => void;
    const blocker = new Promise<void>((r) => { resolveFirst = r; });

    const p1 = enqueueInLane("sized", () => blocker);
    const p2 = enqueueInLane("sized", async () => "done");

    // p1 is active, p2 is queued
    await delay(10);
    expect(getActiveCount()).toBeGreaterThanOrEqual(1);
    expect(getLaneSize("sized")).toBe(1);
    expect(getTotalPending()).toBeGreaterThanOrEqual(2);

    resolveFirst();
    await Promise.all([p1, p2]);
  });
});

describe("clearLane", () => {
  it("rejects queued tasks with CommandLaneClearedError", async () => {
    setLaneConcurrency("clearable", 1);

    let resolveBlocker!: () => void;
    const blocker = new Promise<void>((r) => { resolveBlocker = r; });

    const p1 = enqueueInLane("clearable", () => blocker);
    const p2 = enqueueInLane("clearable", async () => "should not run");

    await delay(10);
    const cleared = clearLane("clearable");
    expect(cleared).toBe(1);

    await expect(p2).rejects.toBeInstanceOf(CommandLaneClearedError);

    resolveBlocker();
    await p1;
  });
});

describe("waitForDrain", () => {
  it("resolves immediately when no active tasks", async () => {
    const { drained } = await waitForDrain(100);
    expect(drained).toBe(true);
  });

  it("waits for active tasks to finish", async () => {
    const p = enqueue(async () => {
      await delay(50);
      return "done";
    });

    const { drained } = await waitForDrain(2000);
    expect(drained).toBe(true);
    await p;
  });

  it("returns false on timeout", async () => {
    let resolveBlocker!: () => void;
    const blocker = new Promise<void>((r) => { resolveBlocker = r; });

    const p = enqueue(() => blocker);

    const { drained } = await waitForDrain(100);
    expect(drained).toBe(false);

    resolveBlocker();
    await p;
  });
});
