import type { Config } from "@chainclaw/core";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAIProvider } from "./openai.js";
import { createOllamaProvider } from "./ollama.js";
import type { LLMProvider } from "./types.js";

export type { LLMProvider, LLMMessage, LLMTool, LLMToolCall, LLMResponse } from "./types.js";

export function createLLMProvider(config: Config): LLMProvider {
  switch (config.llmProvider) {
    case "anthropic": {
      if (!config.anthropicApiKey) {
        throw new Error("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic");
      }
      return createAnthropicProvider(config.anthropicApiKey, config.llmModel);
    }
    case "openai": {
      if (!config.openaiApiKey) {
        throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER=openai");
      }
      return createOpenAIProvider(config.openaiApiKey, config.llmModel);
    }
    case "ollama": {
      const baseUrl = config.ollamaBaseUrl || "http://localhost:11434";
      return createOllamaProvider(baseUrl, config.llmModel);
    }
    default:
      throw new Error(`Unknown LLM provider: ${config.llmProvider}`);
  }
}
