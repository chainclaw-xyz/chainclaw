import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getLogger } from "@chainclaw/core";
import type { SkillRegistry } from "@chainclaw/skills";
import type { ChannelHealthMonitor } from "@chainclaw/gateway";

const logger = getLogger("health");

export interface HealthDeps {
  skillRegistry: SkillRegistry;
  agentRuntime: unknown;
  channels: string[];
  startedAt: number;
  healthMonitor?: ChannelHealthMonitor;
}

export interface HealthServer {
  httpServer: ReturnType<typeof createServer>;
  close: () => void;
}

export function createHealthServer(port: number, deps: HealthDeps, host: string = "127.0.0.1"): HealthServer {
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Content-Type", "application/json");

    if (req.method === "GET" && req.url === "/health") {
      const channelHealth = deps.healthMonitor
        ? Object.fromEntries(
            deps.healthMonitor.getAllSnapshots().map((s) => [s.channelId, {
              connected: s.status.connected,
              lastMessageAt: s.status.lastMessageAt,
              lastError: s.status.lastError,
              checkedAt: s.checkedAt,
            }]),
          )
        : undefined;

      res.writeHead(200);
      res.end(
        JSON.stringify({
          status: "ok",
          uptime: Math.floor((Date.now() - deps.startedAt) / 1000),
          skills: deps.skillRegistry.list().length,
          channels: deps.channels,
          channelHealth,
          agent: deps.agentRuntime ? "active" : "disabled",
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    if (req.method === "GET" && req.url === "/ready") {
      const ready = deps.skillRegistry.list().length > 0 && deps.channels.length > 0;
      res.writeHead(ready ? 200 : 503);
      res.end(
        JSON.stringify({
          ready,
          checks: {
            skills: deps.skillRegistry.list().length > 0,
            channels: deps.channels.length > 0,
            agent: !!deps.agentRuntime,
          },
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(port, host, () => {
    logger.info({ port, host }, "Health check server listening");
  });

  return {
    httpServer,
    close: () => httpServer.close(),
  };
}
