import OpenAI from "openai";
import { getLogger } from "@chainclaw/core";
import type { LLMProvider, LLMMessage, LLMTool, LLMResponse } from "./types.js";

const logger = getLogger("llm-openai");

const DEFAULT_MODEL = "gpt-4o";

export function createOpenAIProvider(
  apiKey: string,
  model?: string,
): LLMProvider {
  const client = new OpenAI({ apiKey });
  const modelId = model || DEFAULT_MODEL;

  logger.info({ model: modelId }, "OpenAI provider initialized");

  return {
    name: "openai",

    async chat(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
      const openaiMessages: OpenAI.ChatCompletionMessageParam[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const openaiTools: OpenAI.ChatCompletionTool[] | undefined = tools?.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));

      logger.debug(
        { messageCount: messages.length, toolCount: tools?.length ?? 0 },
        "Sending chat request",
      );

      const response = await client.chat.completions.create({
        model: modelId,
        messages: openaiMessages,
        tools: openaiTools,
        max_tokens: 4096,
      });

      const choice = response.choices[0];
      const content = choice?.message?.content ?? "";
      const toolCalls: LLMResponse["toolCalls"] = [];

      if (choice?.message?.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          if (tc.type === "function") {
            toolCalls.push({
              name: tc.function.name,
              arguments: JSON.parse(tc.function.arguments),
            });
          }
        }
      }

      logger.debug(
        {
          inputTokens: response.usage?.prompt_tokens,
          outputTokens: response.usage?.completion_tokens,
          toolCalls: toolCalls.length,
        },
        "Chat response received",
      );

      return {
        content,
        toolCalls,
        usage: response.usage
          ? {
              inputTokens: response.usage.prompt_tokens,
              outputTokens: response.usage.completion_tokens,
            }
          : undefined,
      };
    },
  };
}
