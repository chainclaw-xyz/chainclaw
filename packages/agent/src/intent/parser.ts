import { getLogger } from "@chainclaw/core";
import type { LLMProvider, LLMMessage } from "../llm/types.js";
import type { SkillDefinition } from "@chainclaw/skills";
import { buildSystemPrompt, PARSE_INTENT_TOOL } from "./prompt.js";
import type { ParsedIntents, Intent } from "./types.js";

const logger = getLogger("intent-parser");

export class IntentParser {
  private llm: LLMProvider;
  private systemPrompt: string;

  constructor(llm: LLMProvider, skills: SkillDefinition[]) {
    this.llm = llm;
    this.systemPrompt = buildSystemPrompt(skills);
  }

  async parse(
    userMessage: string,
    conversationHistory: LLMMessage[] = [],
  ): Promise<ParsedIntents> {
    const messages: LLMMessage[] = [
      { role: "system", content: this.systemPrompt },
      ...conversationHistory,
      { role: "user", content: userMessage },
    ];

    try {
      const response = await this.llm.chat(messages, [PARSE_INTENT_TOOL]);

      // Look for tool call
      const toolCall = response.toolCalls.find((tc) => tc.name === "parse_intent");

      if (toolCall) {
        const args = toolCall.arguments as {
          intents: Array<{ action: string; params: Record<string, unknown>; confidence: number }>;
          clarificationNeeded: boolean;
          clarificationQuestion?: string;
          conversationalReply?: string;
        };

        const intents: Intent[] = args.intents.map((i) => ({
          action: i.action as Intent["action"],
          params: i.params,
          confidence: i.confidence,
          rawText: userMessage,
        }));

        logger.info(
          {
            intentCount: intents.length,
            actions: intents.map((i) => i.action),
            clarification: args.clarificationNeeded,
          },
          "Intents parsed",
        );

        return {
          intents,
          clarificationNeeded: args.clarificationNeeded,
          clarificationQuestion: args.clarificationQuestion,
          conversationalReply: args.conversationalReply,
        };
      }

      // Fallback: LLM responded with text instead of tool call
      if (response.content) {
        logger.warn("LLM responded with text instead of tool call, treating as conversational");
        return {
          intents: [
            {
              action: "unknown",
              params: {},
              confidence: 0.5,
              rawText: userMessage,
            },
          ],
          clarificationNeeded: false,
          conversationalReply: response.content,
        };
      }

      // No usable response
      return {
        intents: [],
        clarificationNeeded: true,
        clarificationQuestion: "I didn't understand that. Could you rephrase your request?",
      };
    } catch (err) {
      logger.error({ err }, "Intent parsing failed");
      return {
        intents: [],
        clarificationNeeded: true,
        clarificationQuestion:
          "I'm having trouble processing your request. Please try again.",
      };
    }
  }
}
