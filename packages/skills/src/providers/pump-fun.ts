import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { getLogger, fetchWithRetry } from "@chainclaw/core";
import type { TokenLaunchProvider, LaunchParams, LaunchResult } from "../token-launch-types.js";

const logger = getLogger("provider-pump-fun");

// pump.fun uses chainId 900 (Solana mainnet sentinel in ChainClaw)
const PUMP_FUN_CHAIN_ID = 900;

const IPFS_ENDPOINT = "https://pump.fun/api/ipfs";
const PUMPPORTAL_ENDPOINT = "https://pumpportal.fun/api/trade-local";

interface PumpFunIpfsResponse {
  metadataUri: string;
}

export class PumpFunProvider implements TokenLaunchProvider {
  readonly name = "pump.fun";
  readonly supportedChains: number[] = [PUMP_FUN_CHAIN_ID];

  /**
   * Launch a new token on pump.fun.
   * Steps:
   * 1. Generate an ephemeral Keypair for the token mint
   * 2. (Optional) fetch image bytes from imageUrl
   * 3. Upload metadata to pump.fun IPFS
   * 4. POST to pumpportal.fun local API → get serialized VersionedTransaction
   * 5. Sign the tx with mintKeypair
   * 6. Return the signed tx + mint address for the caller to broadcast
   *
   * The caller (token-launch skill) should broadcast via solanaExecutor.executePrebuilt()
   * so that simulation, guardrails and logging are applied.
   */
  async launch(
    params: LaunchParams,
    walletAddress: string,
    _privateKey: string,
  ): Promise<LaunchResult & { signedTx?: VersionedTransaction }> {
    const { name, symbol, description, imageUrl, twitter, telegram, website, initialBuySol = "0.1" } = params;

    // 1. Ephemeral mint keypair
    const mintKeypair = Keypair.generate();
    const mintAddress = mintKeypair.publicKey.toBase58();
    logger.info({ mintAddress, name, symbol }, "Launching pump.fun token");

    // 2. Upload metadata to IPFS (multipart form)
    const metadataUri = await this.uploadMetadata({
      name, symbol, description, twitter, telegram, website, imageUrl,
    });
    logger.debug({ metadataUri }, "Metadata uploaded to IPFS");

    // 3. Build create transaction via pumpportal local API
    // `publicKey` is the buyer wallet — required so pumpportal can build the
    // correct transaction with the right fee-payer and initial-buy instruction.
    const tradePayload = {
      publicKey: walletAddress,
      action: "create",
      tokenMetadata: {
        name,
        symbol,
        uri: metadataUri,
      },
      mint: mintAddress,
      denominatedInSol: "true",
      amount: parseFloat(initialBuySol),
      slippage: 10,
      priorityFee: 0.0005,
      pool: "pump",
    };

    logger.debug({ walletAddress }, "Requesting pre-built pump.fun tx");

    const txResponse = await fetchWithRetry(PUMPPORTAL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tradePayload),
    });

    if (!txResponse.ok) {
      const text = await txResponse.text().catch(() => "");
      throw new Error(`pump.fun create API error (${txResponse.status}): ${text}`);
    }

    // Response is the raw serialized transaction bytes
    const rawBytes = await txResponse.arrayBuffer();
    const txBytes = new Uint8Array(rawBytes);

    if (txBytes.length === 0) {
      throw new Error("pump.fun returned empty transaction");
    }

    // Deserialize and sign with mint keypair
    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign([mintKeypair]);

    logger.info({ mintAddress }, "pump.fun tx built and signed with mint keypair");

    return {
      tokenAddress: mintAddress,
      message: `Token mint address: \`${mintAddress}\``,
      signedTx: tx,
    };
  }

  private async uploadMetadata(meta: {
    name: string;
    symbol: string;
    description?: string;
    twitter?: string;
    telegram?: string;
    website?: string;
    imageUrl?: string;
  }): Promise<string> {
    const form = new FormData();
    form.append("name", meta.name);
    form.append("symbol", meta.symbol);
    if (meta.description) form.append("description", meta.description);
    if (meta.twitter) form.append("twitter", meta.twitter);
    if (meta.telegram) form.append("telegram", meta.telegram);
    if (meta.website) form.append("website", meta.website);

    if (meta.imageUrl) {
      try {
        const imgResponse = await fetchWithRetry(meta.imageUrl, {});
        if (imgResponse.ok) {
          const blob = await imgResponse.blob();
          form.append("file", blob, "image.png");
        }
      } catch (err) {
        logger.warn({ err, imageUrl: meta.imageUrl }, "Failed to fetch image for IPFS upload; skipping");
      }
    }

    const response = await fetchWithRetry(IPFS_ENDPOINT, {
      method: "POST",
      body: form,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`pump.fun IPFS upload error (${response.status}): ${text}`);
    }

    const json = (await response.json()) as PumpFunIpfsResponse;
    if (!json.metadataUri) {
      throw new Error("pump.fun IPFS upload did not return metadataUri");
    }
    return json.metadataUri;
  }
}
