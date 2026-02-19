/**
 * Fake LLMProvider that returns canned responses.
 * Implements the LLMProvider interface from @chainclaw/agent.
 */
import type { LLMProvider, LLMMessage, LLMTool, LLMResponse } from "@chainclaw/agent";

export class MockLLMProvider implements LLMProvider {
  name = "mock";
  private queue: LLMResponse[] = [];

  /** Enqueue a raw LLM response */
  enqueue(response: LLMResponse): void {
    this.queue.push(response);
  }

  /** Enqueue a parse_intent tool call for a skill action */
  enqueueIntent(action: string, params: Record<string, unknown> = {}): void {
    this.queue.push({
      content: "",
      toolCalls: [
        {
          name: "parse_intent",
          arguments: {
            intents: [{ action, params, confidence: 0.95, rawText: "" }],
            clarificationNeeded: false,
          },
        },
      ],
    });
  }

  /** Enqueue a conversational (no skill) response */
  enqueueConversational(text: string): void {
    this.queue.push({
      content: "",
      toolCalls: [
        {
          name: "parse_intent",
          arguments: {
            intents: [{ action: "unknown", params: {}, confidence: 0, rawText: "" }],
            clarificationNeeded: false,
            conversationalReply: text,
          },
        },
      ],
    });
  }

  /** Enqueue a clarification response */
  enqueueClarification(question: string): void {
    this.queue.push({
      content: "",
      toolCalls: [
        {
          name: "parse_intent",
          arguments: {
            intents: [],
            clarificationNeeded: true,
            clarificationQuestion: question,
          },
        },
      ],
    });
  }

  async chat(_messages: LLMMessage[], _tools?: LLMTool[]): Promise<LLMResponse> {
    const response = this.queue.shift();
    if (!response) {
      throw new Error("MockLLMProvider: No responses queued. Call enqueueIntent() or enqueueConversational() first.");
    }
    return response;
  }
}
