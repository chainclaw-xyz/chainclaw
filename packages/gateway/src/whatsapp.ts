import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  type WASocket,
  type ConnectionState,
  type proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { mkdirSync } from "node:fs";
import { getLogger } from "@chainclaw/core";
import type { GatewayDeps } from "./types.js";
import type { ChannelContext } from "./types.js";
import type { ChannelAdapter, ChannelStatus, AlertNotifier } from "./channel-adapter.js";
import { CommandRouter } from "./router.js";
import { RateLimiter } from "./rate-limiter.js";
import pino from "pino";

const logger = getLogger("whatsapp");

/** WhatsApp adapter using Baileys (Web protocol). DM-only for DeFi security. */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly id = "whatsapp";
  readonly label = "WhatsApp";

  private sock: WASocket | null = null;
  private notifier: AlertNotifier | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 12;
  private shouldReconnect = true;
  private deps: GatewayDeps | null = null;
  private status: ChannelStatus = {
    connected: false,
    lastMessageAt: null,
    lastError: null,
  };

  constructor(private authDir: string) {
    mkdirSync(authDir, { recursive: true });
  }

  async start(deps: GatewayDeps): Promise<void> {
    this.deps = deps;
    this.shouldReconnect = true;
    await this.connect();
  }

  private async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    // Suppress Baileys internal logging (very noisy)
    const baileysLogger = pino({ level: "silent" });

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      logger: baileysLogger,
      printQRInTerminal: true,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    this.sock = sock;

    // Save credentials on update
    sock.ev.on("creds.update", saveCreds);

    // Connection state changes
    sock.ev.on("connection.update", (update: Partial<ConnectionState>) => {
      this.handleConnectionUpdate(update);
    });

    // Inbound messages
    sock.ev.on("messages.upsert", (upsert) => {
      if (upsert.type !== "notify") return;

      for (const msg of upsert.messages) {
        void this.handleMessage(msg);
      }
    });
  }

  private handleConnectionUpdate(update: Partial<ConnectionState>): void {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info("Scan QR code in terminal to connect WhatsApp");
    }

    if (connection === "open") {
      this.status.connected = true;
      this.status.lastError = null;
      this.reconnectAttempts = 0;
      logger.info("WhatsApp connected");
    }

    if (connection === "close") {
      this.status.connected = false;

      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const reason = (lastDisconnect?.error as Boom)?.message ?? "unknown";
      this.status.lastError = reason;

      if (statusCode === DisconnectReason.loggedOut) {
        logger.warn("WhatsApp logged out — session invalidated. Delete auth dir and restart to re-pair.");
        this.shouldReconnect = false;
        return;
      }

      if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delayMs = Math.min(2000 * Math.pow(1.8, this.reconnectAttempts - 1), 30_000);
        const jitter = delayMs * (0.75 + Math.random() * 0.5);
        logger.info(
          { attempt: this.reconnectAttempts, delayMs: Math.round(jitter), reason },
          "Reconnecting WhatsApp",
        );
        setTimeout(() => {
          void this.connect();
        }, jitter);
      } else if (this.shouldReconnect) {
        logger.error("Max reconnection attempts reached for WhatsApp");
      }
    }
  }

  private async handleMessage(msg: proto.IWebMessageInfo): Promise<void> {
    const key = msg.key;
    if (!key || !msg.message) return;

    // Skip status/broadcast messages
    if (key.remoteJid === "status@broadcast") return;

    // DM-only: skip group messages for DeFi security
    if (key.remoteJid?.endsWith("@g.us")) {
      logger.debug({ from: key.remoteJid }, "Skipping group message (DM-only mode)");
      return;
    }

    // Skip own messages
    if (key.fromMe) return;

    const text = this.extractText(msg);
    if (!text) return;

    const jid = key.remoteJid;
    if (!jid) return;
    const senderId = jid.replace("@s.whatsapp.net", "");
    const pushName = msg.pushName ?? senderId;

    this.status.lastMessageAt = Date.now();

    const rateLimiter = new RateLimiter();
    if (rateLimiter.isLimited(senderId)) {
      logger.warn({ senderId }, "Rate limited");
      await this.sendText(jid, "You're sending messages too fast. Please wait a moment.");
      return;
    }

    const ctx = this.makeContext(jid, senderId, pushName);
    const router = new CommandRouter(this.deps!);

    // Send composing presence
    await this.sock!.presenceSubscribe(jid);
    await this.sock!.sendPresenceUpdate("composing", jid);

    try {
      // Route commands
      if (text.startsWith("/")) {
        const [cmd, ...args] = text.slice(1).split(/\s+/);
        switch (cmd.toLowerCase()) {
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
    } finally {
      await this.sock!.sendPresenceUpdate("paused", jid);
    }
  }

  private extractText(msg: proto.IWebMessageInfo): string | null {
    const m = msg.message!;
    return (
      m.conversation ??
      m.extendedTextMessage?.text ??
      m.imageMessage?.caption ??
      m.videoMessage?.caption ??
      null
    );
  }

  private makeContext(jid: string, senderId: string, senderName: string): ChannelContext {
    return {
      userId: senderId,
      userName: senderName,
      channelId: jid,
      platform: "whatsapp",
      sendReply: async (text: string) => {
        await this.sendText(jid, text);
      },
    };
  }

  private async sendText(jid: string, text: string): Promise<void> {
    if (!this.sock) return;
    // WhatsApp has a ~4000 char limit per message, chunk if needed
    const chunks = this.chunkText(text, 4000);
    for (const chunk of chunks) {
      await this.sock.sendMessage(jid, { text: chunk });
    }
  }

  private chunkText(text: string, limit: number): string[] {
    if (text.length <= limit) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= limit) {
        chunks.push(remaining);
        break;
      }
      // Try to break at a newline
      let breakAt = remaining.lastIndexOf("\n", limit);
      if (breakAt <= 0) breakAt = limit;
      chunks.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).replace(/^\n/, "");
    }
    return chunks;
  }

  async stop(): Promise<void> {
    this.shouldReconnect = false;
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
      this.status.connected = false;
    }
  }

  getStatus(): ChannelStatus {
    return { ...this.status };
  }

  setNotifier(fn: AlertNotifier): void {
    this.notifier = fn;
  }

  /** Send an alert notification to a WhatsApp user by phone number. */
  async notify(userId: string, message: string): Promise<void> {
    if (this.notifier) {
      await this.notifier(userId, message);
    } else {
      const jid = userId.includes("@") ? userId : `${userId}@s.whatsapp.net`;
      await this.sendText(jid, message);
    }
  }
}
