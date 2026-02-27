// ─── Chain Types ────────────────────────────────────────────

export interface ChainInfo {
  id: number;
  name: string;
  shortName: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrl: string;
}

// ─── Wallet Types ───────────────────────────────────────────

export interface WalletInfo {
  address: string;
  label: string;
  isDefault: boolean;
  createdAt: string;
  chainType?: "evm" | "solana";
}

export interface WalletStore {
  wallets: StoredWallet[];
  defaultAddress: string | null;
}

export interface StoredWallet {
  address: string;
  label: string;
  encryptedKey: string;
  iv: string;
  salt: string;
  createdAt: string;
  chainType?: "evm" | "solana";
}

// ─── Token Types ────────────────────────────────────────────

export interface TokenBalance {
  symbol: string;
  name: string;
  address: string | null; // null for native token
  decimals: number;
  balance: string; // raw balance as string (bigint)
  formatted: string; // human-readable balance
  chainId: number;
}

export interface PortfolioSummary {
  address: string;
  chains: {
    chainId: number;
    chainName: string;
    tokens: TokenBalance[];
  }[];
}

// ─── Message Types ──────────────────────────────────────────

export interface IncomingMessage {
  platform: "telegram" | "discord" | "web";
  userId: string;
  chatId: string;
  text: string;
  timestamp: Date;
}

export interface OutgoingMessage {
  text: string;
  parseMode?: "Markdown" | "HTML";
  replyMarkup?: unknown;
}

// ─── Skill Types ────────────────────────────────────────────

export interface SkillContext {
  userId: string;
  walletAddress: string;
  chainId: number;
  sendReply: (msg: OutgoingMessage) => Promise<void>;
}

export interface SkillResult {
  success: boolean;
  message: string;
  data?: unknown;
}

// ─── Command Handler ────────────────────────────────────────

export type CommandHandler = (
  message: IncomingMessage,
  args: string[],
) => Promise<OutgoingMessage>;
