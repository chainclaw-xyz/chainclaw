import { describe, it, expect } from "vitest";
import type { Config } from "@chainclaw/core";
import { createLLMProvider } from "../llm/index.js";

describe("createLLMProvider", () => {
  const baseConfig: Config = {
    walletPassword: "testpassword",
    walletDir: "./data/wallets",
    webChatEnabled: false,
    webChatPort: 8080,
    whatsappEnabled: false,
    whatsappAuthDir: "./data/whatsapp-auth",
    ethRpcUrl: "https://eth.llamarpc.com",
    baseRpcUrl: "https://mainnet.base.org",
    arbitrumRpcUrl: "https://arb1.arbitrum.io/rpc",
    optimismRpcUrl: "https://mainnet.optimism.io",
    llmProvider: "anthropic",
    logLevel: "info",
    dataDir: "./data",
    healthCheckPort: 9090,
    securityMode: "open",
    securityAllowlist: [],
    dataPipelineEnabled: false,
    outcomeLabelIntervalMs: 300_000,
    reasoningEnrichmentEnabled: false,
  };

  it("throws when Anthropic API key is missing", () => {
    expect(() =>
      createLLMProvider({ ...baseConfig, llmProvider: "anthropic" }),
    ).toThrow("ANTHROPIC_API_KEY is required");
  });

  it("throws when OpenAI API key is missing", () => {
    expect(() =>
      createLLMProvider({ ...baseConfig, llmProvider: "openai" }),
    ).toThrow("OPENAI_API_KEY is required");
  });

  it("creates Anthropic provider with API key", () => {
    const provider = createLLMProvider({
      ...baseConfig,
      llmProvider: "anthropic",
      anthropicApiKey: "sk-test-key",
    });
    expect(provider.name).toBe("anthropic");
  });

  it("creates OpenAI provider with API key", () => {
    const provider = createLLMProvider({
      ...baseConfig,
      llmProvider: "openai",
      openaiApiKey: "sk-test-key",
    });
    expect(provider.name).toBe("openai");
  });

  it("creates Ollama provider without API key", () => {
    const provider = createLLMProvider({
      ...baseConfig,
      llmProvider: "ollama",
      ollamaBaseUrl: "http://localhost:11434",
    });
    expect(provider.name).toBe("ollama");
  });

  it("creates Ollama provider with default URL", () => {
    const provider = createLLMProvider({
      ...baseConfig,
      llmProvider: "ollama",
    });
    expect(provider.name).toBe("ollama");
  });
});
