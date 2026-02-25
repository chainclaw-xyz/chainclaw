import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscordAdapter } from "../discord.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Mock discord.js ──────────────────────────────────────────

const mockLogin = vi.fn();
const mockDestroy = vi.fn();
const mockUsersFetch = vi.fn();
const mockRestPut = vi.fn();

// Track event handlers registered via client.on()
const eventHandlers: Record<string, (...args: unknown[]) => Promise<void>> = {};

vi.mock("discord.js", () => {
  // Use classes instead of arrow functions — arrow functions can't be constructors
  class MockClient {
    user = { id: "bot-123", tag: "ChainClaw#1234" };
    users = { fetch: mockUsersFetch };
    on(event: string, handler: (...args: unknown[]) => Promise<void>) {
      eventHandlers[event] = handler;
    }
    login = mockLogin;
    destroy = mockDestroy;
  }

  class MockREST {
    setToken() { return this; }
    put = mockRestPut;
  }

  class MockSlashCommandBuilder {
    setName() { return this; }
    setDescription() { return this; }
    addStringOption(fn: (opt: MockSlashCommandBuilder) => MockSlashCommandBuilder) { fn(this); return this; }
    setRequired() { return this; }
    addChoices() { return this; }
    toJSON() { return {}; }
  }

  class MockActionRowBuilder {
    addComponents() { return this; }
  }

  class MockButtonBuilder {
    setCustomId() { return this; }
    setLabel() { return this; }
    setStyle() { return this; }
  }

  return {
    Client: MockClient,
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 2,
      DirectMessages: 4,
      MessageContent: 8,
    },
    REST: MockREST,
    Routes: {
      applicationCommands: vi.fn(() => "/mock-route"),
    },
    SlashCommandBuilder: MockSlashCommandBuilder,
    ActionRowBuilder: MockActionRowBuilder,
    ButtonBuilder: MockButtonBuilder,
    ButtonStyle: { Success: 3, Danger: 4 },
    ComponentType: { Button: 2 },
  };
});

// ─── Mock router ──────────────────────────────────────────────

const mockHandleStart = vi.fn();
const mockHandleHelp = vi.fn();
const mockHandleWallet = vi.fn();
const mockHandleBalance = vi.fn();
const mockHandleClear = vi.fn();
const mockHandleMessage = vi.fn();

vi.mock("../router.js", () => {
  class MockCommandRouter {
    handleStart = mockHandleStart;
    handleHelp = mockHandleHelp;
    handleWallet = mockHandleWallet;
    handleBalance = mockHandleBalance;
    handleClear = mockHandleClear;
    handleMessage = mockHandleMessage;
  }
  return { CommandRouter: MockCommandRouter };
});

// ─── Mock rate limiter ────────────────────────────────────────

const mockIsLimited = vi.fn(() => false);

vi.mock("../rate-limiter.js", () => {
  class MockRateLimiter {
    isLimited = mockIsLimited;
  }
  return { RateLimiter: MockRateLimiter };
});

// ─── Helpers ──────────────────────────────────────────────────

function createMockDeps() {
  return {
    walletManager: {} as any,
    chainManager: {} as any,
    skillRegistry: {} as any,
  };
}

function createMockInteraction(commandName: string, options?: Record<string, string | null>) {
  return {
    isChatInputCommand: () => true,
    user: { id: "user-456" },
    channelId: "channel-789",
    channel: {
      send: vi.fn(async () => ({
        awaitMessageComponent: vi.fn(),
        edit: vi.fn(),
      })),
    },
    commandName,
    options: {
      getString: vi.fn((name: string) => options?.[name] ?? null),
    },
    deferReply: vi.fn(),
    reply: vi.fn(),
    followUp: vi.fn(),
    deferred: true,
    replied: false,
  };
}

function createMockMessage(content: string, opts?: { bot?: boolean; guild?: object | null; mentionsBot?: boolean }) {
  return {
    author: { id: "user-456", bot: opts?.bot ?? false },
    guild: opts?.guild ?? null, // null = DM
    content,
    channelId: "channel-789",
    channel: { sendTyping: vi.fn() },
    reply: vi.fn(),
    mentions: { has: vi.fn(() => opts?.mentionsBot ?? false) },
  };
}

// ─── Tests ────────────────────────────────────────────────────

describe("DiscordAdapter", () => {
  let adapter: DiscordAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear tracked event handlers
    for (const key of Object.keys(eventHandlers)) {
      delete eventHandlers[key];
    }
    mockLogin.mockResolvedValue("token");
    mockRestPut.mockResolvedValue(undefined);
    adapter = new DiscordAdapter("test-token", "test-client-id");
    await adapter.start(createMockDeps() as any);
  });

  // ─── Lifecycle ──────────────────────────────────────────

  it("registers slash commands and logs in on start", () => {
    expect(mockRestPut).toHaveBeenCalled();
    expect(mockLogin).toHaveBeenCalledWith("test-token");
  });

  it("stop destroys client and sets disconnected status", async () => {
    await adapter.stop();
    expect(mockDestroy).toHaveBeenCalled();
    expect(adapter.getStatus().connected).toBe(false);
  });

  it("getStatus returns status snapshot", () => {
    const status = adapter.getStatus();
    expect(status).toEqual({
      connected: false,
      lastMessageAt: null,
      lastError: null,
    });
  });

  it("ready event sets connected to true", async () => {
    expect(eventHandlers["ready"]).toBeDefined();
    await eventHandlers["ready"]();
    expect(adapter.getStatus().connected).toBe(true);
  });

  // ─── Slash commands ─────────────────────────────────────

  it("dispatches /start to router.handleStart", async () => {
    const interaction = createMockInteraction("start");
    await eventHandlers["interactionCreate"](interaction);
    expect(mockHandleStart).toHaveBeenCalled();
  });

  it("dispatches /help to router.handleHelp", async () => {
    const interaction = createMockInteraction("help");
    await eventHandlers["interactionCreate"](interaction);
    expect(mockHandleHelp).toHaveBeenCalled();
  });

  it("dispatches /balance to router.handleBalance", async () => {
    const interaction = createMockInteraction("balance");
    await eventHandlers["interactionCreate"](interaction);
    expect(mockHandleBalance).toHaveBeenCalled();
  });

  it("dispatches /clear to router.handleClear", async () => {
    const interaction = createMockInteraction("clear");
    await eventHandlers["interactionCreate"](interaction);
    expect(mockHandleClear).toHaveBeenCalled();
  });

  it("dispatches /wallet with onImportMessage hook", async () => {
    const interaction = createMockInteraction("wallet", { action: "import", value: "0xkey" });
    await eventHandlers["interactionCreate"](interaction);
    expect(mockHandleWallet).toHaveBeenCalledWith(
      expect.any(Object),
      ["import", "0xkey"],
      expect.objectContaining({ onImportMessage: expect.any(Function) }),
    );
  });

  // ─── Ephemeral wallet responses ─────────────────────────

  it("defers /wallet replies as ephemeral", async () => {
    const interaction = createMockInteraction("wallet", { action: "list" });
    await eventHandlers["interactionCreate"](interaction);
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
  });

  it("defers non-wallet replies as non-ephemeral", async () => {
    const interaction = createMockInteraction("balance");
    await eventHandlers["interactionCreate"](interaction);
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
  });

  // ─── Rate limiting ──────────────────────────────────────

  it("rate-limited user gets ephemeral rejection on slash command", async () => {
    mockIsLimited.mockReturnValueOnce(true);
    const interaction = createMockInteraction("start");
    await eventHandlers["interactionCreate"](interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true }),
    );
    expect(mockHandleStart).not.toHaveBeenCalled();
  });

  it("rate-limited user gets rejection on DM message", async () => {
    mockIsLimited.mockReturnValueOnce(true);
    const message = createMockMessage("hello");
    await eventHandlers["messageCreate"](message);
    expect(message.reply).toHaveBeenCalledWith(
      expect.stringContaining("too fast"),
    );
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  // ─── DM / @mention NL handler ───────────────────────────

  it("DM messages are forwarded to router.handleMessage", async () => {
    const message = createMockMessage("check my balance");
    await eventHandlers["messageCreate"](message);
    expect(mockHandleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-456", platform: "discord" }),
      "check my balance",
    );
  });

  it("@mention messages strip mention prefix", async () => {
    const message = createMockMessage("<@bot-123> check my balance", {
      guild: { id: "guild-1" },
      mentionsBot: true,
    });
    await eventHandlers["messageCreate"](message);
    expect(mockHandleMessage).toHaveBeenCalledWith(
      expect.any(Object),
      "check my balance",
    );
  });

  it("bot messages are ignored", async () => {
    const message = createMockMessage("hello", { bot: true });
    await eventHandlers["messageCreate"](message);
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  it("non-DM non-mention messages are ignored", async () => {
    const message = createMockMessage("random chat", { guild: { id: "guild-1" }, mentionsBot: false });
    await eventHandlers["messageCreate"](message);
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  it("empty text after stripping mention is ignored", async () => {
    const message = createMockMessage("<@bot-123>", {
      guild: { id: "guild-1" },
      mentionsBot: true,
    });
    await eventHandlers["messageCreate"](message);
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  // ─── Typing indicator ──────────────────────────────────

  it("sends typing indicator on DM message", async () => {
    const message = createMockMessage("hello");
    await eventHandlers["messageCreate"](message);
    expect(message.channel.sendTyping).toHaveBeenCalled();
  });

  // ─── Notify ─────────────────────────────────────────────

  it("notify sends DM to user via client.users.fetch", async () => {
    const mockSend = vi.fn();
    mockUsersFetch.mockResolvedValue({ send: mockSend });
    await adapter.notify("user-789", "Price alert!");
    expect(mockUsersFetch).toHaveBeenCalledWith("user-789");
    expect(mockSend).toHaveBeenCalledWith("Price alert!");
  });

  it("notify delegates to notifier when set", async () => {
    const notifier = vi.fn(async () => {});
    adapter.setNotifier(notifier);
    await adapter.notify("user-789", "Alert!");
    expect(notifier).toHaveBeenCalledWith("user-789", "Alert!");
    expect(mockUsersFetch).not.toHaveBeenCalled();
  });

  it("notify throws when client not initialized", async () => {
    await adapter.stop();
    await expect(adapter.notify("user-789", "Alert!")).rejects.toThrow("Discord client not initialized");
  });

  it("notify propagates fetch errors for DM-disabled users", async () => {
    mockUsersFetch.mockRejectedValue(new Error("Cannot send messages to this user"));
    await expect(adapter.notify("user-789", "Alert!")).rejects.toThrow("Cannot send messages to this user");
  });

  // ─── Non-chat-input interactions ignored ────────────────

  it("ignores non-chat-input interactions", async () => {
    const interaction = { isChatInputCommand: () => false };
    await eventHandlers["interactionCreate"](interaction);
    expect(mockHandleStart).not.toHaveBeenCalled();
  });

  // ─── Formatter integration ─────────────────────────────────

  it("formats Telegram markdown to Discord markdown in DM replies", async () => {
    mockHandleMessage.mockImplementation(async (ctx: any) => {
      await ctx.sendReply("Token *USDC* is _safe_");
    });
    const message = createMockMessage("check USDC");
    await eventHandlers["messageCreate"](message);
    expect(message.reply).toHaveBeenCalledWith("Token **USDC** is _safe_");
  });

  it("formats Telegram markdown in slash command replies", async () => {
    mockHandleStart.mockImplementation(async (ctx: any) => {
      await ctx.sendReply("Welcome to *ChainClaw*!");
    });
    const interaction = createMockInteraction("start");
    await eventHandlers["interactionCreate"](interaction);
    expect(interaction.followUp).toHaveBeenCalledWith("Welcome to **ChainClaw**!");
  });

  it("formats notify DM messages", async () => {
    const mockSend = vi.fn();
    mockUsersFetch.mockResolvedValue({ send: mockSend });
    await adapter.notify("user-789", "*Price Alert*: ETH above $5000");
    expect(mockSend).toHaveBeenCalledWith("**Price Alert**: ETH above $5000");
  });
});
