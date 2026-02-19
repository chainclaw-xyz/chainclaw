import { getLogger } from "@chainclaw/core";
import type { SkillRegistry, SkillExecutionContext } from "@chainclaw/skills";
import type { LLMProvider } from "./llm/types.js";
import { IntentParser } from "./intent/parser.js";
import type { ParsedIntents } from "./intent/types.js";
import { ConversationMemory } from "./memory/conversation.js";
import { PreferencesStore } from "./memory/preferences.js";
import type Database from "better-sqlite3";

const logger = getLogger("runtime");

export interface AgentResponse {
  text: string;
  needsConfirmation?: boolean;
  confirmationData?: unknown;
}

export class AgentRuntime {
  private intentParser: IntentParser;
  private memory: ConversationMemory;
  private preferences: PreferencesStore;
  private skillRegistry: SkillRegistry;

  constructor(
    llm: LLMProvider,
    db: Database.Database,
    skillRegistry: SkillRegistry,
  ) {
    this.memory = new ConversationMemory(db);
    this.preferences = new PreferencesStore(db);
    this.skillRegistry = skillRegistry;
    this.intentParser = new IntentParser(llm, skillRegistry.list());
  }

  async handleMessage(
    userId: string,
    message: string,
    context: {
      walletAddress: string | null;
      chainIds: number[];
      sendReply: (text: string) => Promise<void>;
      requestConfirmation?: (prompt: string) => Promise<boolean>;
    },
  ): Promise<AgentResponse> {
    logger.info({ userId, message: message.substring(0, 100) }, "Processing message");

    // Save user message to memory
    this.memory.addMessage(userId, "user", message);

    // Get conversation history for context
    const history = this.memory.getMessagesForLLM(userId, 10);

    // Parse intent(s)
    const parsed = await this.intentParser.parse(message, history.slice(0, -1));

    // Handle the parsed result
    const response = await this.executeIntents(parsed, userId, context);

    // Save assistant response to memory
    this.memory.addMessage(userId, "assistant", response.text);

    return response;
  }

  private async executeIntents(
    parsed: ParsedIntents,
    userId: string,
    context: {
      walletAddress: string | null;
      chainIds: number[];
      sendReply: (text: string) => Promise<void>;
      requestConfirmation?: (prompt: string) => Promise<boolean>;
    },
  ): Promise<AgentResponse> {
    // Handle clarification needed
    if (parsed.clarificationNeeded && parsed.clarificationQuestion) {
      return { text: parsed.clarificationQuestion };
    }

    // Handle conversational reply (no skill needed)
    if (parsed.conversationalReply && parsed.intents.every((i) => i.action === "unknown")) {
      return { text: parsed.conversationalReply };
    }

    // Execute each intent in sequence
    const results: string[] = [];

    for (const intent of parsed.intents) {
      if (intent.action === "unknown") {
        continue;
      }

      const skill = this.skillRegistry.get(intent.action);
      if (!skill) {
        results.push(`I don't have a "${intent.action}" skill yet. This will be available in a future update.`);
        continue;
      }

      const prefs = this.preferences.get(userId);

      const skillContext: SkillExecutionContext = {
        userId,
        walletAddress: context.walletAddress,
        chainIds: context.chainIds,
        sendReply: context.sendReply,
        requestConfirmation: context.requestConfirmation,
        preferences: {
          defaultChainId: prefs.defaultChainId,
          slippageTolerance: prefs.slippageTolerance,
          confirmationThreshold: prefs.confirmationThreshold,
        },
      };

      try {
        logger.info({ action: intent.action, params: intent.params }, "Executing skill");
        const result = await skill.execute(intent.params, skillContext);
        results.push(result.message);
      } catch (err) {
        logger.error({ err, action: intent.action }, "Skill execution failed");
        results.push(`Failed to execute ${intent.action}: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    }

    if (results.length === 0) {
      return {
        text: parsed.conversationalReply || "I'm not sure how to help with that. Try asking about your balance, swaps, or type /help for available commands.",
      };
    }

    return { text: results.join("\n\n") };
  }

  getPreferences(userId: string) {
    return this.preferences.get(userId);
  }

  updatePreferences(userId: string, prefs: Partial<{ defaultChainId: number; slippageTolerance: number; confirmationThreshold: number }>) {
    return this.preferences.set(userId, prefs);
  }

  clearHistory(userId: string): void {
    this.memory.clear(userId);
  }
}
