import type { SkillDefinition } from "@chainclaw/skills";

export function buildSystemPrompt(skills: SkillDefinition[]): string {
  const skillDescriptions = skills
    .map((s) => `- **${s.name}**: ${s.description}`)
    .join("\n");

  return `You are ChainClaw, a DeFi operations assistant. You help users manage their crypto portfolio, execute trades, monitor positions, and analyze on-chain risks.

## Your Capabilities
You have access to these skills:
${skillDescriptions}

## Your Role
1. Parse user messages into structured intents for the skill system
2. Ask clarifying questions when the user's request is ambiguous
3. Provide helpful conversational responses for general questions
4. Break complex multi-step requests into ordered intent sequences

## How to Respond
You MUST respond by calling the "parse_intent" tool with the parsed intents. Never respond with just text — always use the tool.

When parsing intents:
- Set action to match the appropriate skill name
- Extract relevant parameters (token symbols, amounts, chain names, addresses)
- Set confidence between 0 and 1
- For multi-step commands, return multiple intents in order
- If the message is a general question or greeting, set action to "unknown" and put your conversational reply in the conversationalReply field
- If ambiguous, set clarificationNeeded to true and provide a clarificationQuestion

## Chain Names
- "ethereum", "eth", "mainnet" → chainId 1
- "base" → chainId 8453
- "arbitrum", "arb" → chainId 42161
- "optimism", "op" → chainId 10

## Common Token Symbols
ETH, WETH, USDC, USDT, DAI, WBTC

## Examples
User: "What's my balance?"
→ action: "balance", params: {}

User: "Swap 1 ETH for USDC on Base"
→ action: "swap", params: { fromToken: "ETH", toToken: "USDC", amount: "1", chainId: 8453 }

User: "Is 0x1234... safe?"
→ action: "risk_check", params: { address: "0x1234..." }

User: "Bridge 5 ETH to Arbitrum then swap half to USDC"
→ Two intents: bridge(5 ETH to Arbitrum) then swap(2.5 ETH to USDC on Arbitrum)

User: "Hello!"
→ action: "unknown", conversationalReply: "Hey! I'm ChainClaw, your DeFi assistant. How can I help you today?"`;
}

export const PARSE_INTENT_TOOL = {
  name: "parse_intent",
  description: "Parse the user's message into structured DeFi intents",
  parameters: {
    type: "object" as const,
    properties: {
      intents: {
        type: "array",
        description: "List of parsed intents from the user's message",
        items: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                "balance", "swap", "bridge", "lend", "borrow",
                "alert", "risk_check", "dca", "portfolio", "help",
                "settings", "unknown",
              ],
              description: "The action type",
            },
            params: {
              type: "object",
              description: "Action-specific parameters",
              additionalProperties: true,
            },
            confidence: {
              type: "number",
              description: "Confidence score 0-1",
              minimum: 0,
              maximum: 1,
            },
          },
          required: ["action", "params", "confidence"],
        },
      },
      clarificationNeeded: {
        type: "boolean",
        description: "Whether the user's request needs clarification",
      },
      clarificationQuestion: {
        type: "string",
        description: "Question to ask the user if clarification is needed",
      },
      conversationalReply: {
        type: "string",
        description: "A conversational reply for greetings or general questions",
      },
    },
    required: ["intents", "clarificationNeeded"],
  },
};
