import { z } from "zod";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

loadDotenv({ path: resolve(process.cwd(), ".env") });

const configSchema = z.object({
  // Telegram
  telegramBotToken: z.string().optional(),

  // Discord
  discordBotToken: z.string().optional(),
  discordClientId: z.string().optional(),

  // Web Chat
  webChatEnabled: z.boolean().default(false),
  webChatPort: z.number().default(8080),

  // Wallet
  walletPassword: z.string().min(8, "WALLET_PASSWORD must be at least 8 characters"),
  walletDir: z.string().default("./data/wallets"),

  // RPC Endpoints
  ethRpcUrl: z.string().url().default("https://eth.llamarpc.com"),
  baseRpcUrl: z.string().url().default("https://mainnet.base.org"),
  arbitrumRpcUrl: z.string().url().default("https://arb1.arbitrum.io/rpc"),
  optimismRpcUrl: z.string().url().default("https://mainnet.optimism.io"),

  // LLM
  llmProvider: z.enum(["anthropic", "openai", "ollama"]).default("anthropic"),
  anthropicApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  ollamaBaseUrl: z.string().url().optional(),
  llmModel: z.string().optional(),

  // Tenderly (for tx simulation)
  tenderlyApiKey: z.string().optional(),
  tenderlyAccount: z.string().optional(),
  tenderlyProject: z.string().optional(),

  // DEX Aggregator
  oneInchApiKey: z.string().optional(),

  // Coinbase (AgentKit)
  coinbaseApiKeyName: z.string().optional(),
  coinbaseApiKeySecret: z.string().optional(),

  // Logging
  logLevel: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // Data
  dataDir: z.string().default("./data"),

  // Health Check
  healthCheckPort: z.number().default(9090),

  // Community Skills
  skillsDir: z.string().optional(),

  // Solana
  solanaRpcUrl: z.string().url().optional(),

  // Data Pipeline
  dataPipelineEnabled: z.boolean().default(false),
  outcomeLabelIntervalMs: z.number().default(300_000),
  reasoningEnrichmentEnabled: z.boolean().default(false),
});

export type Config = z.infer<typeof configSchema>;

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const result = configSchema.safeParse({
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
    discordBotToken: process.env.DISCORD_BOT_TOKEN || undefined,
    discordClientId: process.env.DISCORD_CLIENT_ID || undefined,
    webChatEnabled: process.env.WEB_CHAT_ENABLED === "true",
    webChatPort: process.env.WEB_CHAT_PORT ? Number(process.env.WEB_CHAT_PORT) : 8080,
    walletPassword: process.env.WALLET_PASSWORD,
    walletDir: process.env.WALLET_DIR || "./data/wallets",
    ethRpcUrl: process.env.ETH_RPC_URL || "https://eth.llamarpc.com",
    baseRpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    arbitrumRpcUrl: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
    optimismRpcUrl: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
    llmProvider: process.env.LLM_PROVIDER || "anthropic",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    llmModel: process.env.LLM_MODEL,
    tenderlyApiKey: process.env.TENDERLY_API_KEY,
    tenderlyAccount: process.env.TENDERLY_ACCOUNT,
    tenderlyProject: process.env.TENDERLY_PROJECT,
    oneInchApiKey: process.env["1INCH_API_KEY"],
    coinbaseApiKeyName: process.env.COINBASE_API_KEY_NAME || undefined,
    coinbaseApiKeySecret: process.env.COINBASE_API_KEY_SECRET || undefined,
    logLevel: process.env.LOG_LEVEL || "info",
    dataDir: process.env.DATA_DIR || "./data",
    healthCheckPort: process.env.HEALTH_CHECK_PORT
      ? Number(process.env.HEALTH_CHECK_PORT)
      : 9090,
    skillsDir: process.env.SKILLS_DIR || undefined,
    solanaRpcUrl: process.env.SOLANA_RPC_URL || undefined,
    dataPipelineEnabled: process.env.DATA_PIPELINE_ENABLED === "true",
    outcomeLabelIntervalMs: process.env.OUTCOME_LABEL_INTERVAL_MS
      ? Number(process.env.OUTCOME_LABEL_INTERVAL_MS)
      : 300_000,
    reasoningEnrichmentEnabled:
      process.env.REASONING_ENRICHMENT_ENABLED === "true",
  });

  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  cachedConfig = result.data;
  return cachedConfig;
}

export function resetConfig(): void {
  cachedConfig = null;
}
