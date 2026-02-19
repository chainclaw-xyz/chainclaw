export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls: LLMToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMProvider {
  name: string;
  chat(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse>;
}
