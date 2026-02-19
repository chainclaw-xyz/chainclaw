import type { AgentDefinition, StrategyContext, StrategyDecision } from "../types.js";

/**
 * Sample DCA agent that performs weekly dollar-cost averaging into ETH.
 * Useful for testing the backtest engine and as a template for custom agents.
 */
export function createSampleDcaAgent(options?: {
  amountPerBuy?: number;
  targetToken?: string;
  chainId?: number;
}): AgentDefinition {
  const amountPerBuy = options?.amountPerBuy ?? 100;
  const targetToken = options?.targetToken ?? "ETH";
  const chainId = options?.chainId ?? 1;

  return {
    name: "sample-dca",
    version: "1.0.0",
    description: `Weekly DCA strategy: buy $${amountPerBuy} of ${targetToken} every evaluation cycle`,
    author: "chainclaw",
    category: "dca",
    skills: ["swap"],

    knowledgeSources: [
      {
        type: "price_feed",
        name: "target_price",
        description: `Current ${targetToken} price`,
        fetch: async () => null, // Populated by runner from live/historical prices
      },
    ],

    riskParams: {
      maxPositionSizeUsd: amountPerBuy * 2,
      maxDrawdownPercent: 50,
      maxDailyTradesCount: 5,
      maxDailyExposureUsd: amountPerBuy * 3,
      allowedChainIds: [chainId],
      allowedTokens: [targetToken],
    },

    strategy: {
      evaluationIntervalMs: 7 * 24 * 60 * 60 * 1000, // Weekly
      watchlist: [targetToken],

      evaluate: async (context: StrategyContext): Promise<StrategyDecision[]> => {
        const price = context.prices[targetToken.toUpperCase()];
        if (!price) return [];

        // Simple DCA: always buy a fixed amount
        return [
          {
            action: "buy",
            token: targetToken,
            amountUsd: amountPerBuy,
            chainId,
            reasoning: `DCA: buying $${amountPerBuy} of ${targetToken} at $${price.toFixed(2)}`,
            signals: [
              {
                token: targetToken,
                strength: "buy",
                confidence: 0.8,
                reasoning: "Dollar-cost averaging — time-based entry",
                timestamp: context.timestamp,
              },
            ],
          },
        ];
      },
    },
  };
}
