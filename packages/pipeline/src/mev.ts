import { getLogger, fetchWithRetry } from "@chainclaw/core";
import type { Hex } from "viem";

const logger = getLogger("mev-protection");

/**
 * MEV protection via Flashbots Protect RPC on Ethereum mainnet.
 * Sends transactions through Flashbots Protect to prevent front-running and sandwich attacks.
 */
export class MevProtection {
  private flashbotsRpcUrl = "https://rpc.flashbots.net";

  /**
   * Check if MEV protection is available for the given chain.
   * Currently only Ethereum mainnet is supported.
   */
  isSupported(chainId: number): boolean {
    return chainId === 1;
  }

  /**
   * Send a signed transaction through Flashbots Protect RPC.
   * Returns the transaction hash if successful.
   */
  async sendProtectedTransaction(
    signedTx: Hex,
  ): Promise<string | null> {
    try {
      const response = await fetchWithRetry(this.flashbotsRpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_sendRawTransaction",
          params: [signedTx],
        }),
      }, { maxAttempts: 2 });

      if (!response.ok) {
        logger.error({ status: response.status }, "Flashbots RPC error");
        return null;
      }

      const data = (await response.json()) as {
        result?: string;
        error?: { message: string };
      };

      if (data.error) {
        logger.error({ error: data.error.message }, "Flashbots submission error");
        return null;
      }

      logger.info({ hash: data.result }, "Transaction sent via Flashbots Protect");
      return data.result ?? null;
    } catch (err) {
      logger.error({ err }, "Failed to send via Flashbots Protect");
      return null;
    }
  }

  /**
   * Get the Flashbots Protect RPC URL for use as an RPC override.
   */
  getProtectedRpcUrl(): string {
    return this.flashbotsRpcUrl;
  }
}
