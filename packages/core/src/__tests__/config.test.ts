import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, resetConfig } from "../config.js";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetConfig();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  it("throws when WALLET_PASSWORD is too short", () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:ABC";
    process.env.WALLET_PASSWORD = "short";

    expect(() => loadConfig()).toThrow("Invalid configuration");
  });

  it("loads config with valid environment variables", () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:ABC";
    process.env.WALLET_PASSWORD = "testpassword123";

    const config = loadConfig();

    expect(config.telegramBotToken).toBe("123:ABC");
    expect(config.walletPassword).toBe("testpassword123");
    expect(config.logLevel).toBe("info");
    expect(config.ethRpcUrl).toContain("http");
    expect(config.baseRpcUrl).toContain("http");
  });

  it("uses default values when optional vars are not set", () => {
    process.env.WALLET_PASSWORD = "testpassword123";

    const config = loadConfig();

    expect(config.walletDir).toBe("./data/wallets");
    expect(config.dataDir).toBe("./data");
    expect(config.webChatEnabled).toBe(false);
    expect(config.webChatPort).toBe(8080);
  });

  it("loads Discord and Web Chat config", () => {
    process.env.WALLET_PASSWORD = "testpassword123";
    process.env.DISCORD_BOT_TOKEN = "discord-token";
    process.env.DISCORD_CLIENT_ID = "discord-client-id";
    process.env.WEB_CHAT_ENABLED = "true";
    process.env.WEB_CHAT_PORT = "9090";

    const config = loadConfig();

    expect(config.discordBotToken).toBe("discord-token");
    expect(config.discordClientId).toBe("discord-client-id");
    expect(config.webChatEnabled).toBe(true);
    expect(config.webChatPort).toBe(9090);
  });

  it("caches config on subsequent calls", () => {
    process.env.WALLET_PASSWORD = "testpassword123";

    const config1 = loadConfig();
    const config2 = loadConfig();

    expect(config1).toBe(config2);
  });
});
