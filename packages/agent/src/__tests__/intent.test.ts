import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { LLMProvider, LLMMessage, LLMTool, LLMResponse } from "../llm/types.js";
import { IntentParser } from "../intent/parser.js";
import type { SkillDefinition } from "@chainclaw/skills";

// Mock LLM provider that returns pre-configured tool call responses
function createMockLLM(
  responseMap: Record<string, { intents: unknown[]; clarificationNeeded: boolean; conversationalReply?: string }>,
): LLMProvider {
  return {
    name: "mock",
    async chat(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
      const userMessage = messages.filter((m) => m.role === "user").pop()?.content ?? "";

      // Find matching response by checking if user message contains any key
      let responseData: (typeof responseMap)[string] | undefined;
      for (const [key, value] of Object.entries(responseMap)) {
        if (userMessage.toLowerCase().includes(key.toLowerCase())) {
          responseData = value;
          break;
        }
      }

      if (responseData) {
        return {
          content: "",
          toolCalls: [
            {
              name: "parse_intent",
              arguments: responseData,
            },
          ],
        };
      }

      // Fallback: return text response (simulating LLM not using tool)
      return {
        content: "I'm not sure what you mean.",
        toolCalls: [],
      };
    },
  };
}

const mockSkills: SkillDefinition[] = [
  {
    name: "balance",
    description: "Check token balances",
    parameters: z.object({}),
    async execute() {
      return { success: true, message: "ok" };
    },
  },
  {
    name: "swap",
    description: "Swap tokens",
    parameters: z.object({}),
    async execute() {
      return { success: true, message: "ok" };
    },
  },
];

describe("IntentParser", () => {
  it("parses a balance request", async () => {
    const llm = createMockLLM({
      balance: {
        intents: [{ action: "balance", params: {}, confidence: 0.95 }],
        clarificationNeeded: false,
      },
    });

    const parser = new IntentParser(llm, mockSkills);
    const result = await parser.parse("What's my balance?");

    expect(result.intents).toHaveLength(1);
    expect(result.intents[0].action).toBe("balance");
    expect(result.intents[0].confidence).toBe(0.95);
    expect(result.clarificationNeeded).toBe(false);
  });

  it("parses a swap request with params", async () => {
    const llm = createMockLLM({
      swap: {
        intents: [
          {
            action: "swap",
            params: { fromToken: "ETH", toToken: "USDC", amount: "1", chainId: 8453 },
            confidence: 0.9,
          },
        ],
        clarificationNeeded: false,
      },
    });

    const parser = new IntentParser(llm, mockSkills);
    const result = await parser.parse("Swap 1 ETH for USDC on Base");

    expect(result.intents).toHaveLength(1);
    expect(result.intents[0].action).toBe("swap");
    expect(result.intents[0].params).toEqual({
      fromToken: "ETH",
      toToken: "USDC",
      amount: "1",
      chainId: 8453,
    });
  });

  it("handles multi-step intents", async () => {
    const llm = createMockLLM({
      bridge: {
        intents: [
          { action: "bridge", params: { amount: "5", token: "ETH", toChain: 42161 }, confidence: 0.9 },
          { action: "swap", params: { fromToken: "ETH", toToken: "USDC", amount: "2.5", chainId: 42161 }, confidence: 0.85 },
        ],
        clarificationNeeded: false,
      },
    });

    const parser = new IntentParser(llm, mockSkills);
    const result = await parser.parse("Bridge 5 ETH to Arbitrum then swap half to USDC");

    expect(result.intents).toHaveLength(2);
    expect(result.intents[0].action).toBe("bridge");
    expect(result.intents[1].action).toBe("swap");
  });

  it("handles conversational messages", async () => {
    const llm = createMockLLM({
      hello: {
        intents: [{ action: "unknown", params: {}, confidence: 1.0 }],
        clarificationNeeded: false,
        conversationalReply: "Hey! I'm ChainClaw. How can I help?",
      },
    });

    const parser = new IntentParser(llm, mockSkills);
    const result = await parser.parse("Hello!");

    expect(result.intents).toHaveLength(1);
    expect(result.intents[0].action).toBe("unknown");
    expect(result.conversationalReply).toContain("ChainClaw");
  });

  it("handles LLM text fallback gracefully", async () => {
    const llm = createMockLLM({}); // No matching responses → text fallback

    const parser = new IntentParser(llm, mockSkills);
    const result = await parser.parse("something totally unrecognized");

    expect(result.intents).toHaveLength(1);
    expect(result.intents[0].action).toBe("unknown");
    expect(result.conversationalReply).toBeTruthy();
  });

  it("handles LLM errors gracefully", async () => {
    const llm: LLMProvider = {
      name: "failing",
      async chat() {
        throw new Error("API rate limit exceeded");
      },
    };

    const parser = new IntentParser(llm, mockSkills);
    const result = await parser.parse("Check my balance");

    expect(result.clarificationNeeded).toBe(true);
    expect(result.clarificationQuestion).toContain("trouble");
  });
});
