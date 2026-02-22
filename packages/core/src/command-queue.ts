import { getLogger } from "./logger.js";

const logger = getLogger("command-queue");

// ─── Types ──────────────────────────────────────────────────

export class CommandLaneClearedError extends Error {
  constructor(lane: string) {
    super(`Lane "${lane}" was cleared while task was queued`);
    this.name = "CommandLaneClearedError";
  }
}

interface QueueEntry<T> {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  enqueuedAt: number;
}

interface LaneState {
  queue: QueueEntry<unknown>[];
  activeCount: number;
  maxConcurrent: number;
}

// ─── Command Queue (singleton) ──────────────────────────────

const lanes = new Map<string, LaneState>();

function getLane(name: string): LaneState {
  let lane = lanes.get(name);
  if (!lane) {
    lane = { queue: [], activeCount: 0, maxConcurrent: 1 };
    lanes.set(name, lane);
  }
  return lane;
}

function pump(name: string): void {
  const lane = lanes.get(name);
  if (!lane) return;

  while (lane.queue.length > 0 && lane.activeCount < lane.maxConcurrent) {
    const entry = lane.queue.shift()!;
    lane.activeCount++;

    const waitMs = Date.now() - entry.enqueuedAt;
    if (waitMs > 2000) {
      logger.warn({ lane: name, waitMs }, "Task waited long in queue");
    }

    entry
      .task()
      .then((result) => entry.resolve(result))
      .catch((err) => entry.reject(err))
      .finally(() => {
        lane.activeCount--;
        pump(name);
      });
  }
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Set the max concurrency for a lane.
 */
export function setLaneConcurrency(lane: string, maxConcurrent: number): void {
  getLane(lane).maxConcurrent = Math.max(1, maxConcurrent);
}

/**
 * Enqueue a task in a named lane.
 * The returned promise resolves/rejects when the task completes.
 */
export function enqueueInLane<T>(
  lane: string,
  task: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const state = getLane(lane);
    state.queue.push({
      task: task as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
      enqueuedAt: Date.now(),
    });
    pump(lane);
  });
}

/**
 * Enqueue a task in the default "main" lane.
 */
export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  return enqueueInLane("main", task);
}

/**
 * Get the number of queued (waiting) tasks in a lane.
 */
export function getLaneSize(lane?: string): number {
  if (lane) return getLane(lane).queue.length;
  let total = 0;
  for (const state of lanes.values()) total += state.queue.length;
  return total;
}

/**
 * Get the total number of active (executing) tasks across all lanes.
 */
export function getActiveCount(): number {
  let total = 0;
  for (const state of lanes.values()) total += state.activeCount;
  return total;
}

/**
 * Get total queued + active tasks across all lanes.
 */
export function getTotalPending(): number {
  return getLaneSize() + getActiveCount();
}

/**
 * Clear all queued (not active) tasks in a lane, rejecting them.
 */
export function clearLane(lane: string): number {
  const state = lanes.get(lane);
  if (!state) return 0;
  const count = state.queue.length;
  for (const entry of state.queue) {
    entry.reject(new CommandLaneClearedError(lane));
  }
  state.queue = [];
  return count;
}

/**
 * Wait for all active tasks to complete (up to timeoutMs).
 * Does NOT clear queues — just waits for in-flight work to finish.
 */
export function waitForDrain(timeoutMs: number): Promise<{ drained: boolean }> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    const check = () => {
      if (getActiveCount() === 0) {
        resolve({ drained: true });
        return;
      }
      if (Date.now() >= deadline) {
        resolve({ drained: false });
        return;
      }
      setTimeout(check, 50);
    };

    check();
  });
}

/**
 * Reset all lanes. For testing only.
 */
export function resetAllLanes(): void {
  for (const [name, state] of lanes) {
    for (const entry of state.queue) {
      entry.reject(new CommandLaneClearedError(name));
    }
  }
  lanes.clear();
}
