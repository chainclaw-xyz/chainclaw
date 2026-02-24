# ChainClaw

Self-hosted, open-source, crypto-native AI agent for DeFi operations. Talk to your wallets in plain English across Telegram, Discord, or a built-in web chat.

ChainClaw wires an LLM-powered intent parser to a pipeline of real DeFi skills — swap, bridge, lend, DCA, alerts, risk checks, portfolio tracking, autonomous trading agents — with every transaction going through simulation, guardrails, and risk analysis before broadcast. Keys never leave your machine.

## Quick Start

```bash
git clone https://github.com/chainclaw-xyz/chainclaw.git
cd chainclaw
npm install

cp .env.example .env
# Edit .env — set WALLET_PASSWORD, a channel token, and an LLM provider

npx turbo build
node apps/server/dist/index.js
```

Or with Docker:

```bash
cp .env.example .env
# Edit .env
docker compose up -d
```

Health check: `http://localhost:9090/health`

## Skills

| Skill | Description |
|-------|-------------|
| `balance` | Check token balances across all connected chains |
| `portfolio` | Multi-chain portfolio overview with USD values |
| `swap` | Swap tokens via 1inch DEX aggregation |
| `bridge` | Bridge tokens across chains via Li.Fi |
| `lend` | Lend/borrow via Aave V3 (supply, withdraw, borrow, repay) |
| `dca` | Dollar-cost averaging with recurring schedules |
| `alert` | Price and position alerts with channel notifications |
| `risk_check` | Token/contract safety analysis via GoPlus Security API |
| `history` | Transaction history with text, CSV, and JSON export |
| `workflow` | Chain multiple skills into a single multi-step workflow |
| `yield_finder` | Find best DeFi yields across protocols via DeFiLlama |
| `limit_order` | Limit orders via CoW Protocol (Ethereum + Gnosis) |
| `whale_watch` | Monitor whale addresses and track large movements |
| `snipe` | Token snipe trading with safety checks and liquidity verification |
| `airdrop_tracker` | Check airdrop eligibility across major protocols |
| `backtest` | Backtest trading strategies against historical data |
| `agent` | Start, stop, and monitor autonomous trading agents |

All skills work through slash commands (`/balance`, `/swap`) or natural language ("Swap 1 ETH to USDC on Base"). The LLM intent parser routes natural language to the right skill automatically.

Without an LLM provider configured, ChainClaw runs in command-only mode — slash commands work, natural language is disabled.

## Supported Chains

| Chain | Chain ID | Skills |
|-------|----------|--------|
| Ethereum | 1 | All |
| Base | 8453 | All |
| Arbitrum One | 42161 | All |
| Optimism | 10 | All |
| Solana | 900 | Balance, portfolio |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Channels: Telegram (grammY) │ Discord (discord.js) │ WebChat│
└───────────────────────┬──────────────────────────────────────┘
                        │
               ┌────────▼────────┐
               │  CommandRouter  │  /start /help /balance /wallet ...
               │  + AgentRuntime │  NL → IntentParser → skill dispatch
               └────────┬────────┘
                        │
               ┌────────▼────────┐
               │  SkillRegistry  │  17 built-in + community skills
               └────────┬────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
    ChainManager   WalletManager   TransactionExecutor
    (EVM + Solana) (AES-256-GCM)   ┌──────────────────┐
                   LocalSigner     │ simulate (Tenderly)│
                                   │ risk check (GoPlus) │
                                   │ guardrails (limits)  │
                                   │ MEV protection       │
                                   │ sign + broadcast     │
                                   │ tx log (SQLite)      │
                                   └──────────────────────┘
```

## Project Structure

```
chainclaw/
├── apps/
│   └── server/              # Entry point — wires everything together
├── packages/
│   ├── core/                # Config (Zod), logger (Pino), shared types
│   ├── chains/              # EVM + Solana adapters, chain registry
│   ├── wallet/              # Encrypted wallets, signing (Local signer; Ledger/Coinbase/Safe planned)
│   ├── pipeline/            # Tx executor, simulator, guardrails, risk engine, MEV, tx log
│   ├── skills/              # Built-in skill implementations (17 skills)
│   ├── skills-sdk/          # SDK for building community skills
│   ├── agent/               # LLM providers (Anthropic/OpenAI/Ollama), intent parser, memory
│   ├── agent-sdk/           # Autonomous agent framework, backtest engine
│   ├── cron/                # Scheduled jobs (DCA, alerts, whale watch polling)
│   ├── gateway/             # Telegram, Discord, WebChat adapters, rate limiter
│   ├── e2e/                 # E2E tests against Anvil-forked mainnet
│   └── docs/                # VitePress documentation site
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── turbo.json
```

## Wallet Types

| Signer | Description | Status |
|--------|-------------|--------|
| `LocalSigner` | Private keys stored locally, encrypted with AES-256-GCM | Stable |
| `LedgerSigner` | Hardware wallet — transactions confirmed on device | Planned |
| `CoinbaseSigner` | Server-side wallet via Coinbase AgentKit | Planned |
| `SafeSigner` | Gnosis Safe multisig — propose, collect signatures, execute | Planned |

## Transaction Safety

Every on-chain transaction passes through a multi-layer safety pipeline before broadcast:

1. **Simulation** — Tenderly fork simulation shows balance changes, gas estimate, and revert detection before signing
2. **Risk Analysis** — GoPlus Security API checks for honeypots, owner privileges, mint functions, blacklists, buy/sell taxes, holder concentration
3. **Guardrails** — Per-user spending limits (daily/weekly/per-tx), slippage tolerance, confirmation gates for large transactions
4. **MEV Protection** — Ethereum mainnet transactions route through Flashbots Protect to prevent sandwich attacks
5. **Audit Log** — Every transaction is logged with full metadata (intent, simulation result, risk score, outcome)

## Configuration

Copy `.env.example` to `.env` and configure:

### Required

```env
WALLET_PASSWORD=your-secure-password    # Min 8 chars, encrypts wallet keys

# At least one channel:
TELEGRAM_BOT_TOKEN=                     # From @BotFather
DISCORD_BOT_TOKEN=                      # From Discord Developer Portal
DISCORD_CLIENT_ID=
WEB_CHAT_ENABLED=false                  # Set true for built-in web UI
```

### LLM Provider

```env
LLM_PROVIDER=anthropic                  # anthropic | openai | ollama
ANTHROPIC_API_KEY=                      # Required for Anthropic
OPENAI_API_KEY=                         # Required for OpenAI
OLLAMA_BASE_URL=http://localhost:11434  # For local models (zero-cost)
```

### Optional

```env
# RPC endpoints (defaults to public RPCs)
ETH_RPC_URL=
BASE_RPC_URL=
ARBITRUM_RPC_URL=
OPTIMISM_RPC_URL=
SOLANA_RPC_URL=

# Transaction simulation
TENDERLY_API_KEY=
TENDERLY_ACCOUNT=
TENDERLY_PROJECT=

# Live swap execution (quotes work without it)
1INCH_API_KEY=

# Coinbase AgentKit
COINBASE_API_KEY_NAME=
COINBASE_API_KEY_SECRET=

# Community skills directory
SKILLS_DIR=./data/skills

# Logging
LOG_LEVEL=info                          # fatal | error | warn | info | debug | trace
```

## Building Community Skills

Use `@chainclaw/skills-sdk` to build and distribute custom skills:

```typescript
import { defineSkill } from "@chainclaw/skills-sdk";
import { z } from "zod";

export default defineSkill(
  {
    name: "my-skill",
    version: "1.0.0",
    description: "Does something useful",
    author: "you",
    permissions: ["read_balance"],
  },
  () => ({
    name: "my-skill",
    description: "Does something useful",
    parameters: z.object({
      token: z.string(),
    }),
    async execute(params, context) {
      const parsed = z.object({ token: z.string() }).parse(params);
      return {
        success: true,
        message: `Processed ${parsed.token}`,
      };
    },
  }),
);
```

Place skill packages in the `SKILLS_DIR` directory. ChainClaw loads them at startup with sandboxed execution — skills declare permissions and run in isolated contexts.

## Building Autonomous Agents

Use `@chainclaw/agent-sdk` to define trading strategies that run autonomously:

```typescript
import type { AgentDefinition, StrategyContext, StrategyDecision } from "@chainclaw/agent-sdk";

const myAgent: AgentDefinition = {
  name: "my-dca-agent",
  version: "1.0.0",
  description: "Weekly DCA into ETH",
  author: "you",
  category: "dca",
  skills: ["swap"],

  riskParams: {
    maxPositionSizeUsd: 200,
    maxDrawdownPercent: 50,
    maxDailyTradesCount: 5,
    maxDailyExposureUsd: 300,
    allowedChainIds: [1],
    allowedTokens: ["ETH"],
  },

  strategy: {
    evaluationIntervalMs: 7 * 24 * 60 * 60 * 1000, // Weekly
    watchlist: ["ETH"],

    evaluate: async (context: StrategyContext): Promise<StrategyDecision[]> => {
      const price = context.prices["ETH"];
      if (!price) return [];

      return [{
        action: "buy",
        token: "ETH",
        amountUsd: 100,
        chainId: 1,
        reasoning: `DCA: buying $100 of ETH at $${price.toFixed(2)}`,
        signals: [{
          token: "ETH",
          strength: "buy",
          confidence: 0.8,
          reasoning: "Dollar-cost averaging — time-based entry",
          timestamp: context.timestamp,
        }],
      }];
    },
  },
};
```

Agents can be backtested against historical data before going live. Use the `backtest` skill via chat to validate strategy performance.

## Docker

```bash
# Basic
docker compose up -d

# With TLS via Caddy reverse proxy
DOMAIN=chainclaw.example.com docker compose --profile tls up -d
```

The Docker image uses a multi-stage build (Node 20 slim) with built-in health checks. Data persists in Docker volumes (`chainclaw-data`, `chainclaw-skills`).

| Port | Service |
|------|---------|
| 8080 | WebChat (WebSocket) |
| 9090 | Health check |

## Development

```bash
npm install
npx turbo build
npx turbo test
```

Run a specific package's tests:

```bash
npx vitest run --config packages/pipeline/vitest.config.ts
npx vitest run --config packages/skills/vitest.config.ts
npx vitest run --config apps/server/vitest.config.ts
```

### Test Suite

421 tests across 60 test files:

| Category | Tests | Coverage |
|----------|-------|----------|
| Unit | 348 | Every package in isolation — skills, pipeline, wallet crypto, chain adapters, intent parsing, agent SDK, cron |
| Integration | 67 | Full-stack flows — boot, wallet lifecycle, command routing, skill pipeline, NL-to-skill, background services |
| Journey | 6 | Persona-based: beginner onboarding, active DeFi trader, portfolio manager, agent creator, DAO treasury |

Integration tests use a harness that mirrors the production boot sequence with real internal components, mocking only external boundaries (RPCs, HTTP APIs, LLM).

### E2E Tests

E2E tests run against a real Anvil-forked Ethereum mainnet — no mocks:

```bash
# Requires Foundry (anvil) and a private RPC endpoint
FORK_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY npm run test:e2e
```

Without `FORK_RPC_URL`, the suite skips gracefully. Tests cover balance reads (native ETH + ERC20) and full transaction execution through the pipeline (simulate → guardrails → sign → broadcast → confirm).

## Cloud Plugin

Install `@chainclaw/cloud-plugin` to add the **marketplace** skill — browse, subscribe to, and rank community agents. See [chainclaw-xyz/cloud](https://github.com/chainclaw-xyz/cloud) for details.

## Tech Stack

| | |
|---|---|
| Runtime | Node.js >= 20, TypeScript 5.7 |
| Monorepo | Turborepo |
| EVM | viem |
| Solana | @solana/web3.js |
| Database | better-sqlite3 (in-process, zero-config) |
| Validation | Zod |
| Telegram | grammY |
| Discord | discord.js |
| LLM | Anthropic SDK, OpenAI SDK, Ollama |
| Testing | Vitest |
| Docker | Multi-stage build, Caddy for TLS |

## License

MIT
