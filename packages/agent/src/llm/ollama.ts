import { getLogger, fetchWithRetry } from "@chainclaw/core";
import type { LLMProvider, LLMMessage, LLMTool, LLMResponse } from "./types.js";

const logger = getLogger("llm-ollama");

const DEFAULT_MODEL = "llama3.1";

interface OllamaResponse {
  message: { role: string; content: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> };
  done: boolean;
  eval_count?: number;
  prompt_eval_count?: number;
}

export function createOllamaProvider(
  baseUrl: string,
  model?: string,
): LLMProvider {
  const modelId = model || DEFAULT_MODEL;
  const url = baseUrl.replace(/\/$/, "");

  logger.info({ model: modelId, baseUrl: url }, "Ollama provider initialized");

  return {
    name: "ollama",

    async chat(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
      const ollamaMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const ollamaTools = tools?.map((t) => ({
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

      const body: Record<string, unknown> = {
        model: modelId,
        messages: ollamaMessages,
        stream: false,
      };
      if (ollamaTools && ollamaTools.length > 0) {
        body.tools = ollamaTools;
      }

      const response = await fetchWithRetry(`${url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama API error ${response.status}: ${text}`);
      }

      const data = (await response.json()) as OllamaResponse;

      const content = data.message.content ?? "";
      const toolCalls: LLMResponse["toolCalls"] = [];

      if (data.message.tool_calls) {
        for (const tc of data.message.tool_calls) {
          toolCalls.push({
            name: tc.function.name,
            arguments: tc.function.arguments,
          });
        }
      }

      logger.debug(
        {
          inputTokens: data.prompt_eval_count,
          outputTokens: data.eval_count,
          toolCalls: toolCalls.length,
        },
        "Chat response received",
      );

      return {
        content,
        toolCalls,
        usage:
          data.prompt_eval_count != null
            ? {
                inputTokens: data.prompt_eval_count,
                outputTokens: data.eval_count ?? 0,
              }
            : undefined,
      };
    },
  };
}
