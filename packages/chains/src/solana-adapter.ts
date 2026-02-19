import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getLogger, type TokenBalance } from "@chainclaw/core";
import type { ChainAdapter } from "./adapter.js";

const logger = getLogger("solana-adapter");

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

export function createSolanaAdapter(rpcUrl?: string): ChainAdapter {
  const connection = new Connection(rpcUrl || DEFAULT_RPC);

  return {
    chainId: 900,

    async getBalance(address: string): Promise<TokenBalance> {
      logger.debug({ address }, "Fetching SOL balance");
      const pubkey = new PublicKey(address);
      const balance = await connection.getBalance(pubkey);
      return {
        symbol: "SOL",
        name: "Solana",
        address: null,
        decimals: 9,
        balance: balance.toString(),
        formatted: (balance / LAMPORTS_PER_SOL).toFixed(9),
        chainId: 900,
      };
    },

    async getTokenBalances(address: string): Promise<TokenBalance[]> {
      logger.debug({ address }, "Fetching SPL token balances");
      // Basic SPL token balance fetching — can be expanded later
      try {
        const pubkey = new PublicKey(address);
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
          pubkey,
          { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") },
        );

        return tokenAccounts.value
          .filter((account) => {
            const info = account.account.data.parsed?.info;
            return info && Number(info.tokenAmount?.uiAmount) > 0;
          })
          .map((account) => {
            const info = account.account.data.parsed.info;
            return {
              symbol: info.mint.slice(0, 6), // Shortened mint as symbol fallback
              name: info.mint,
              address: info.mint,
              decimals: info.tokenAmount.decimals,
              balance: info.tokenAmount.amount,
              formatted: info.tokenAmount.uiAmountString,
              chainId: 900,
            };
          });
      } catch (err) {
        logger.warn({ err, address }, "Failed to fetch SPL token balances");
        return [];
      }
    },

    async getGasPrice(): Promise<bigint> {
      // Solana uses priority fees; return base fee estimate
      const fees = await connection.getRecentPrioritizationFees();
      const avgFee = fees.length > 0
        ? fees.reduce((sum, f) => sum + f.prioritizationFee, 0) / fees.length
        : 5000;
      return BigInt(Math.ceil(avgFee));
    },

    async getBlockNumber(): Promise<bigint> {
      const slot = await connection.getSlot();
      return BigInt(slot);
    },
  };
}
