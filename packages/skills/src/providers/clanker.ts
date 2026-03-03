import { getLogger, fetchWithRetry } from "@chainclaw/core";
import type { TokenLaunchProvider, LaunchParams, LaunchResult } from "../token-launch-types.js";

const logger = getLogger("provider-clanker");

const CLANKER_ENDPOINT = "https://www.clanker.world/api/tokens/deploy";

// Clanker supports Base (8453), Unichain (130), and Arbitrum (42161)
const CLANKER_CHAINS = [8453, 130, 42161];

interface ClankerDeployResponse {
  success: boolean;
  expectedAddress?: string;
  error?: string;
  message?: string;
}

export class ClankerProvider implements TokenLaunchProvider {
  readonly name = "clanker";
  readonly supportedChains: number[] = CLANKER_CHAINS;

  constructor(private apiKey?: string) {}

  async launch(
    params: LaunchParams,
    walletAddress: string,
    _privateKey: string,
  ): Promise<LaunchResult> {
    if (!this.apiKey) {
      return {
        tokenAddress: "",
        message: "Clanker API key not configured. Set CLANKER_API_KEY in your .env to use this provider.",
      };
    }

    const { name, symbol, description, imageUrl, chainId } = params;

    // 32-char unique request key to ensure idempotency
    const requestKey = crypto.randomUUID().replace(/-/g, "");

    const payload = {
      token: {
        name,
        symbol,
        ...(imageUrl ? { image: imageUrl } : {}),
        ...(description ? { description } : {}),
        tokenAdmin: walletAddress,
        requestKey,
      },
      rewards: [
        {
          admin: walletAddress,
          recipient: walletAddress,
          allocation: 100,
        },
      ],
      chainId,
    };

    logger.info({ name, symbol, chainId, walletAddress }, "Deploying token via Clanker");

    const response = await fetchWithRetry(CLANKER_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Clanker API error (${response.status}): ${text}`);
    }

    const json = (await response.json()) as ClankerDeployResponse;

    if (!json.success || !json.expectedAddress) {
      throw new Error(`Clanker deployment failed: ${json.error ?? json.message ?? "Unknown error"}`);
    }

    logger.info({ expectedAddress: json.expectedAddress, chainId }, "Clanker token deployment queued");

    return {
      tokenAddress: json.expectedAddress,
      message: `Token deployment queued on Clanker. Expected address: \`${json.expectedAddress}\`\nDeployment is async — check back in a few minutes.`,
    };
  }
}
