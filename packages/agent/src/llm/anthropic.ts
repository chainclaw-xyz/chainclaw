import Anthropic from "@anthropic-ai/sdk";
import { getLogger } from "@chainclaw/core";
import type { LLMProvider, LLMMessage, LLMTool, LLMResponse } from "./types.js";

const logger = getLogger("llm-anthropic");

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export function createAnthropicProvider(
  apiKey: string,
  model?: string,
): LLMProvider {
  const client = new Anthropic({ apiKey });
  const modelId = model || DEFAULT_MODEL;

  logger.info({ model: modelId }, "Anthropic provider initialized");

  return {
    name: "anthropic",

    async chat(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
      // Separate system message from conversation
      const systemMessage = messages.find((m) => m.role === "system");
      const conversationMessages = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      const anthropicTools = tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Tool["input_schema"],
      }));

      logger.debug(
        { messageCount: conversationMessages.length, toolCount: tools?.length ?? 0 },
        "Sending chat request",
      );

      const response = await client.messages.create({
        model: modelId,
        max_tokens: 4096,
        system: systemMessage?.content,
        messages: conversationMessages,
        tools: anthropicTools,
      });

      // Extract text content and tool calls
      let content = "";
      const toolCalls: LLMResponse["toolCalls"] = [];

      for (const block of response.content) {
        if (block.type === "text") {
          content += block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          });
        }
      }

      logger.debug(
        {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          toolCalls: toolCalls.length,
        },
        "Chat response received",
      );

      return {
        content,
        toolCalls,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },
  };
}
