import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createHealthServer, type HealthDeps } from "../health.js";
import type { AddressInfo } from "node:net";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function makeDeps(overrides?: Partial<HealthDeps>): HealthDeps {
  return {
    skillRegistry: {
      list: vi.fn(() => [{ name: "balance" }, { name: "swap" }]),
    } as any,
    agentRuntime: { handleMessage: vi.fn() },
    channels: ["telegram", "discord"],
    startedAt: Date.now() - 60000, // 60 seconds ago
    ...overrides,
  };
}

async function fetchJson(port: number, path: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  const body = await response.json();
  return { status: response.status, body };
}

describe("createHealthServer", () => {
  let server: ReturnType<typeof createHealthServer>;
  let port: number;
  let deps: HealthDeps;

  beforeAll(async () => {
    deps = makeDeps();
    server = createHealthServer(0, deps);
    // Wait for server to start
    await new Promise<void>((resolve) => {
      server.httpServer.on("listening", resolve);
    });
    port = (server.httpServer.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
  });

  it("GET /health returns 200 with status and uptime", async () => {
    const { status, body } = await fetchJson(port, "/health");
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("GET /health includes skill count and channel list", async () => {
    const { body } = await fetchJson(port, "/health");
    expect(body.skills).toBe(2);
    expect(body.channels).toEqual(["telegram", "discord"]);
  });

  it("GET /health shows agent status", async () => {
    const { body } = await fetchJson(port, "/health");
    expect(body.agent).toBe("active");
  });

  it("GET /ready returns 200 when skills > 0 and channels > 0", async () => {
    const { status, body } = await fetchJson(port, "/ready");
    expect(status).toBe(200);
    expect(body.ready).toBe(true);
  });

  it("GET /unknown returns 404", async () => {
    const { status, body } = await fetchJson(port, "/unknown");
    expect(status).toBe(404);
    expect(body.error).toBe("Not found");
  });
});

describe("createHealthServer - not ready", () => {
  let server: ReturnType<typeof createHealthServer>;
  let port: number;

  beforeAll(async () => {
    const deps = makeDeps({
      skillRegistry: { list: vi.fn(() => []) } as any,
      channels: [],
    });
    server = createHealthServer(0, deps);
    await new Promise<void>((resolve) => {
      server.httpServer.on("listening", resolve);
    });
    port = (server.httpServer.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
  });

  it("GET /ready returns 503 when no skills and no channels", async () => {
    const { status, body } = await fetchJson(port, "/ready");
    expect(status).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.checks.skills).toBe(false);
    expect(body.checks.channels).toBe(false);
  });
});
