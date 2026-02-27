import {
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { getLogger } from "@chainclaw/core";
import type { SolanaSigner, SolanaSignerTransactionParams } from "../solana-signer.js";

const logger = getLogger("solana-signer");
const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

export class LocalSolanaSigner implements SolanaSigner {
  readonly type = "local" as const;
  readonly isAutomatic = true;
  readonly publicKey: string;

  private keypair: Keypair;
  private rpcUrl: string;

  constructor(keypair: Keypair, rpcUrl?: string) {
    this.keypair = keypair;
    this.publicKey = keypair.publicKey.toBase58();
    this.rpcUrl = rpcUrl ?? DEFAULT_RPC;
  }

  async signAndSendTransaction(params: SolanaSignerTransactionParams): Promise<string> {
    const rpcUrl = params.rpcUrl ?? this.rpcUrl;
    const connection = new Connection(rpcUrl, "confirmed");

    if (params.transaction instanceof VersionedTransaction) {
      logger.debug("Signing versioned transaction");
      params.transaction.sign([this.keypair]);
      const rawTransaction = params.transaction.serialize();
      const signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      // Wait for confirmation
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      );

      logger.info({ signature }, "Versioned transaction confirmed");
      return signature;
    }

    // Legacy Transaction
    logger.debug("Signing legacy transaction");
    const signature = await sendAndConfirmTransaction(
      connection,
      params.transaction,
      [this.keypair],
      { commitment: "confirmed" },
    );

    logger.info({ signature }, "Legacy transaction confirmed");
    return signature;
  }
}
