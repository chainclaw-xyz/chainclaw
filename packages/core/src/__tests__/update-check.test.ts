import { describe, it, expect, vi, afterEach } from "vitest";
import { UpdateChecker, compareVersions } from "../update-check.js";

vi.mock("../logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("returns positive when a > b", () => {
    expect(compareVersions("1.1.0", "1.0.0")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.1", "1.0.0")).toBeGreaterThan(0);
  });

  it("returns negative when a < b", () => {
    expect(compareVersions("1.0.0", "1.1.0")).toBeLessThan(0);
    expect(compareVersions("0.9.0", "1.0.0")).toBeLessThan(0);
  });

  it("handles versions with different segment counts", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.1", "1.0")).toBeGreaterThan(0);
  });
});

describe("UpdateChecker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));
    const checker = new UpdateChecker({ currentVersion: "1.0.0" });
    const result = await checker.checkForUpdate();
    expect(result).toBeNull();
  });

  it("returns null when API returns non-OK", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("rate limited", { status: 403 }),
    );
    const checker = new UpdateChecker({ currentVersion: "1.0.0" });
    const result = await checker.checkForUpdate();
    expect(result).toBeNull();
  });

  it("detects when an update is available", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ tag_name: "v2.0.0" }), { status: 200 }),
    );
    const checker = new UpdateChecker({ currentVersion: "1.0.0" });
    const result = await checker.checkForUpdate();
    expect(result).toEqual({ available: true, latest: "2.0.0", current: "1.0.0" });
  });

  it("reports no update when current is latest", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ tag_name: "v1.0.0" }), { status: 200 }),
    );
    const checker = new UpdateChecker({ currentVersion: "1.0.0" });
    const result = await checker.checkForUpdate();
    expect(result).toEqual({ available: false, latest: "1.0.0", current: "1.0.0" });
  });

  it("strips v prefix from tag", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ tag_name: "v1.2.3" }), { status: 200 }),
    );
    const checker = new UpdateChecker({ currentVersion: "1.2.3" });
    const result = await checker.checkForUpdate();
    expect(result?.latest).toBe("1.2.3");
  });

  it("updates status after check", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ tag_name: "v2.0.0" }), { status: 200 }),
    );
    const checker = new UpdateChecker({ currentVersion: "1.0.0" });

    // Before check
    expect(checker.getStatus().lastCheckedAt).toBeNull();

    await checker.checkForUpdate();

    // After check
    const status = checker.getStatus();
    expect(status.latest).toBe("2.0.0");
    expect(status.updateAvailable).toBe(true);
    expect(status.lastCheckedAt).toBeGreaterThan(0);
  });

  it("start and stop work without errors", () => {
    const checker = new UpdateChecker({ currentVersion: "1.0.0", checkIntervalMs: 60_000 });
    checker.start();
    checker.stop();
    checker.stop(); // idempotent
  });
});
