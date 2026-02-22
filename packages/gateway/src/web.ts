import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { getLogger } from "@chainclaw/core";
import type { GatewayDeps } from "./types.js";
import type { ChannelContext } from "./types.js";
import { CommandRouter } from "./router.js";
import { RateLimiter } from "./rate-limiter.js";

const logger = getLogger("web-chat");

// ─── Protocol types ──────────────────────────────────────────

interface InboundMessage {
  type: "message";
  text: string;
}

interface InboundConfirm {
  type: "confirm";
  id: string;
  value: boolean;
}

type InboundPayload = InboundMessage | InboundConfirm;

interface OutboundReply {
  type: "reply";
  text: string;
}

interface OutboundConfirmRequest {
  type: "confirm_request";
  id: string;
  prompt: string;
}

type OutboundPayload = OutboundReply | OutboundConfirmRequest;

// ─── Session state ───────────────────────────────────────────

interface Session {
  userId: string;
  ws: WebSocket;
  pendingConfirmations: Map<string, (value: boolean) => void>;
}

const sessions = new Map<WebSocket, Session>();
const CONFIRMATION_TIMEOUT_MS = 120_000;

// ─── WebSocket ↔ ChannelContext ──────────────────────────────

function makeWebContext(session: Session): ChannelContext {
  return {
    userId: session.userId,
    channelId: session.userId, // 1:1 session
    platform: "web",
    sendReply: async (text: string) => {
      send(session.ws, { type: "reply", text });
    },
    requestConfirmation: async (prompt: string) => {
      const id = randomUUID();
      send(session.ws, { type: "confirm_request", id, prompt });

      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          session.pendingConfirmations.delete(id);
          resolve(false);
        }, CONFIRMATION_TIMEOUT_MS);

        session.pendingConfirmations.set(id, (value) => {
          clearTimeout(timeout);
          resolve(value);
        });
      });
    },
  };
}

function send(ws: WebSocket, payload: OutboundPayload): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// ─── Server Factory ──────────────────────────────────────────

export interface WebChatOptions {
  port?: number;
  /** Path to a static HTML file to serve at GET / */
  staticHtmlPath?: string;
}

export function createWebChat(
  deps: GatewayDeps,
  options: WebChatOptions = {},
): { httpServer: ReturnType<typeof createServer>; wss: WebSocketServer } {
  const router = new CommandRouter(deps);
  const rateLimiter = new RateLimiter();
  const port = options.port ?? 8080;

  // Resolve the bundled HTML file
  const defaultHtmlPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../web-chat.html",
  );
  const htmlPath = options.staticHtmlPath ?? defaultHtmlPath;
  const htmlContent = existsSync(htmlPath) ? readFileSync(htmlPath, "utf-8") : null;

  // HTTP server for serving the HTML page and upgrading to WS
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      if (htmlContent) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(htmlContent);
      } else {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ChainClaw Web Chat - connect via WebSocket");
      }
      return;
    }

    // Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", connections: sessions.size }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    const session: Session = {
      userId: `web-${randomUUID().slice(0, 8)}`,
      ws,
      pendingConfirmations: new Map(),
    };
    sessions.set(ws, session);
    logger.info({ userId: session.userId }, "Web chat connected");

    // Send welcome
    send(ws, { type: "reply", text: "Connected to ChainClaw. Type /help for available commands." });

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    ws.on("message", async (raw) => {
      let payload: InboundPayload;
      try {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        payload = JSON.parse(String(raw)) as InboundPayload;
      } catch {
        send(ws, { type: "reply", text: "Invalid message format. Send JSON: { type: \"message\", text: \"...\" }" });
        return;
      }

      // Handle confirmation responses
      if (payload.type === "confirm") {
        const cb = session.pendingConfirmations.get(payload.id);
        if (cb) {
          session.pendingConfirmations.delete(payload.id);
          cb(payload.value);
        }
        return;
      }

      // Handle messages
      if (payload.type === "message") {
        const text = payload.text?.trim();
        if (!text) return;

        if (rateLimiter.isLimited(session.userId)) {
          send(ws, { type: "reply", text: "You're sending messages too fast. Please wait a moment." });
          return;
        }

        const ctx = makeWebContext(session);

        // Parse slash commands
        if (text.startsWith("/")) {
          const parts = text.split(/\s+/);
          const command = parts[0].slice(1).toLowerCase();
          const args = parts.slice(1);

          switch (command) {
            case "start":
              await router.handleStart(ctx);
              break;
            case "help":
              await router.handleHelp(ctx);
              break;
            case "wallet":
              await router.handleWallet(ctx, args);
              break;
            case "balance":
              await router.handleBalance(ctx);
              break;
            case "clear":
              await router.handleClear(ctx);
              break;
            default:
              await router.handleMessage(ctx, text);
          }
        } else {
          await router.handleMessage(ctx, text);
        }
      }
    });

    ws.on("close", () => {
      logger.info({ userId: session.userId }, "Web chat disconnected");
      sessions.delete(ws);
    });

    ws.on("error", (err) => {
      logger.error({ err, userId: session.userId }, "Web chat error");
    });
  });

  httpServer.listen(port, () => {
    logger.info({ port }, "Web chat server listening");
  });

  return { httpServer, wss };
}
