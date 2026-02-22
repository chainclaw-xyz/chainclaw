import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerHook,
  unregisterHook,
  clearHooks,
  triggerHook,
  createHookEvent,
  getRegisteredHookKeys,
  HookEvents,
} from "../hooks.js";

describe("Hook System", () => {
  beforeEach(() => {
    clearHooks();
  });

  describe("registerHook / unregisterHook", () => {
    it("registers and triggers a handler", async () => {
      const handler = vi.fn();
      registerHook("tx:before_simulate", handler);

      const event = createHookEvent("tx", "before_simulate", { txId: "123" });
      await triggerHook(event);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(event);
    });

    it("unregisters a handler", async () => {
      const handler = vi.fn();
      registerHook("tx:before_simulate", handler);
      unregisterHook("tx:before_simulate", handler);

      await triggerHook(createHookEvent("tx", "before_simulate"));
      expect(handler).not.toHaveBeenCalled();
    });

    it("supports multiple handlers for the same event", async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      registerHook("tx:confirmed", handler1);
      registerHook("tx:confirmed", handler2);

      await triggerHook(createHookEvent("tx", "confirmed"));

      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });
  });

  describe("triggerHook", () => {
    it("dispatches to both specific and category handlers", async () => {
      const specificHandler = vi.fn();
      const categoryHandler = vi.fn();

      registerHook("tx:before_broadcast", specificHandler);
      registerHook("tx", categoryHandler);

      await triggerHook(createHookEvent("tx", "before_broadcast"));

      expect(specificHandler).toHaveBeenCalledOnce();
      expect(categoryHandler).toHaveBeenCalledOnce();
    });

    it("does not dispatch to unrelated handlers", async () => {
      const handler = vi.fn();
      registerHook("alert:triggered", handler);

      await triggerHook(createHookEvent("tx", "confirmed"));
      expect(handler).not.toHaveBeenCalled();
    });

    it("catches and isolates handler errors", async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error("boom"));
      const goodHandler = vi.fn();

      registerHook("tx:failed", errorHandler);
      registerHook("tx:failed", goodHandler);

      // Should not throw
      await triggerHook(createHookEvent("tx", "failed"));

      expect(errorHandler).toHaveBeenCalledOnce();
      expect(goodHandler).toHaveBeenCalledOnce();
    });
  });

  describe("createHookEvent", () => {
    it("creates a properly structured event", () => {
      const event = createHookEvent("alert", "triggered", { alertId: "a1" });

      expect(event.type).toBe("alert");
      expect(event.action).toBe("triggered");
      expect(event.key).toBe("alert:triggered");
      expect(event.timestamp).toBeGreaterThan(0);
      expect(event.data).toEqual({ alertId: "a1" });
    });

    it("defaults data to empty object", () => {
      const event = createHookEvent("lifecycle", "startup");
      expect(event.data).toEqual({});
    });
  });

  describe("clearHooks / getRegisteredHookKeys", () => {
    it("clears all hooks", () => {
      registerHook("tx:confirmed", vi.fn());
      registerHook("alert:triggered", vi.fn());
      expect(getRegisteredHookKeys()).toHaveLength(2);

      clearHooks();
      expect(getRegisteredHookKeys()).toHaveLength(0);
    });
  });

  describe("HookEvents constants", () => {
    it("has expected event keys", () => {
      expect(HookEvents.TX_BEFORE_SIMULATE).toBe("tx:before_simulate");
      expect(HookEvents.ALERT_TRIGGERED).toBe("alert:triggered");
      expect(HookEvents.CHANNEL_CONNECTED).toBe("channel:connected");
      expect(HookEvents.CRON_JOB_STARTED).toBe("cron:job_started");
      expect(HookEvents.LIFECYCLE_STARTUP).toBe("lifecycle:startup");
    });
  });
});
