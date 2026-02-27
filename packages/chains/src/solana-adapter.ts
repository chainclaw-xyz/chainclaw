import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getLogger, type TokenBalance } from "@chainclaw/core";
import type { ChainAdapter } from "./adapter.js";

const logger = getLogger("solana-adapter");

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

interface ParsedTokenInfo {
  mint: string;
  tokenAmount: {
    amount: string;
    decimals: number;
    uiAmount: number;
    uiAmountString: string;
  };
}

// Known SPL token metadata (mint → symbol, name)
// Avoids cross-package dependency on @chainclaw/skills
const SOLANA_KNOWN_TOKENS: Record<string, { symbol: string; name: string }> = {
  "So11111111111111111111111111111111111111112": { symbol: "wSOL", name: "Wrapped SOL" },
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": { symbol: "USDC", name: "USD Coin" },
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": { symbol: "USDT", name: "Tether USD" },
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": { symbol: "BONK", name: "Bonk" },
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN": { symbol: "JUP", name: "Jupiter" },
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": { symbol: "RAY", name: "Raydium" },
  "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE": { symbol: "ORCA", name: "Orca" },
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So": { symbol: "mSOL", name: "Marinade staked SOL" },
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn": { symbol: "JitoSOL", name: "Jito Staked SOL" },
  "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1": { symbol: "bSOL", name: "BlazeStake Staked SOL" },
  "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3": { symbol: "PYTH", name: "Pyth Network" },
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm": { symbol: "WIF", name: "dogwifhat" },
  "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ": { symbol: "W", name: "Wormhole" },
  "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof": { symbol: "RENDER", name: "Render Token" },
  "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux": { symbol: "HNT", name: "Helium" },
};

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
      try {
        const pubkey = new PublicKey(address);
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
          pubkey,
          { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") },
        );

        return tokenAccounts.value
          .filter((account) => {
            const info = (account.account.data as { parsed?: { info?: ParsedTokenInfo } }).parsed?.info;
            return info && Number(info.tokenAmount?.uiAmount) > 0;
          })
          .map((account) => {
            const info = (account.account.data as { parsed: { info: ParsedTokenInfo } }).parsed.info;
            const known = SOLANA_KNOWN_TOKENS[info.mint];
            return {
              symbol: known?.symbol ?? info.mint.slice(0, 6),
              name: known?.name ?? info.mint,
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
      // Solana uses priority fees; return average from recent transactions
      try {
        const fees = await connection.getRecentPrioritizationFees();
        const avgFee = fees.length > 0
          ? fees.reduce((sum, f) => sum + f.prioritizationFee, 0) / fees.length
          : 5000;
        return BigInt(Math.ceil(avgFee));
      } catch {
        return 5000n; // fallback: 5000 micro-lamports
      }
    },

    async getBlockNumber(): Promise<bigint> {
      const slot = await connection.getSlot();
      return BigInt(slot);
    },
  };
}
