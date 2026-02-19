# ChainClaw

Self-hosted crypto-native AI agent for DeFi operations. Talk to your wallets in plain English across Telegram, Discord, or a built-in web chat.

ChainClaw wires an LLM-powered intent parser to a pipeline of real DeFi skills — swap, bridge, lend, DCA, alerts, risk checks, portfolio tracking — with every transaction going through simulation, guardrails, and risk analysis before broadcast. Keys never leave your hardware.

## Quick Start

```bash
# Clone and install
git clone https://github.com/chainclaw-xyz/chainclaw.git
cd chainclaw
npm install

# Configure
cp .env.example .env
# Edit .env — set WALLET_PASSWORD, a channel token, and an LLM provider

# Build and run
npx turbo build
node apps/server/dist/index.js
```

Or with Docker:

```bash
cp .env.example .env
# Edit .env
docker compose up -d
```

## What It Does

| Skill | Description |
|-------|-------------|
| `balance` | Check token balances across all connected chains |
| `portfolio` | Portfolio overview with USD values |
| `swap` | Swap tokens via 1inch DEX aggregation |
| `bridge` | Bridge tokens across chains via Li.Fi |
| `lend` | Lend/borrow via Aave V3 (supply, withdraw, borrow, repay) |
| `dca` | Dollar-cost averaging with recurring schedules |
| `alert` | Price alerts with channel notifications |
| `risk_check` | Token/contract safety analysis via GoPlus |
| `history` | Transaction history (text, CSV, JSON export) |
| `workflow` | Chain multiple skills into a single workflow |
| `backtest` | Backtest trading strategies against historical data |
| `agent` | Start, stop, and monitor autonomous trading agents |

All skills work through slash commands (`/balance`, `/help`) or natural language ("What's my ETH balance on Base?"). The LLM intent parser routes natural language to the right skill automatically.

> **Cloud Plugin:** Install `@chainclaw/cloud-plugin` to add the **marketplace** skill — browse, subscribe to, and rank community agents. See [chainclaw-xyz/cloud](https://github.com/chainclaw-xyz/cloud) for details.

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
┌─────────────────────────────────────────────────────────┐
│  Channels: Telegram (grammY) / Discord / WebChat (ws)   │
└──────────────────────┬──────────────────────────────────┘
                       │
              ┌────────▼────────┐
              │  CommandRouter  │  /start /help /balance /wallet /clear
              │  + AgentRuntime │  "swap 1 ETH for USDC" → IntentParser → skill
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │  SkillRegistry  │  12 built-in skills
              └────────┬────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   ChainManager   WalletManager   TransactionExecutor
   (EVM+Solana)   (AES-256-GCM)  ┌──────────────────┐
                                  │ simulate (Tenderly)│
                                  │ risk check (GoPlus)│
                                  │ guardrails (limits)│
                                  │ MEV protection     │
                                  │ sign + broadcast   │
                                  │ tx log (SQLite)    │
                                  └──────────────────┘
```

**11 packages** in a Turborepo monorepo:

| Package | Role |
|---------|------|
| `@chainclaw/core` | Config (Zod-validated), logger (Pino), shared types |
| `@chainclaw/chains` | EVM + Solana adapters, ChainManager, chain registry |
| `@chainclaw/wallet` | AES-256-GCM encrypted wallet storage, transaction signing |
| `@chainclaw/pipeline` | Transaction executor, simulator, guardrails, risk engine, MEV protection, tx log |
| `@chainclaw/skills` | All 12 built-in skill implementations |
| `@chainclaw/skills-sdk` | SDK for building community skills (`defineSkill`, loader, sandbox) |
| `@chainclaw/agent` | LLM providers (Anthropic, OpenAI, Ollama), intent parser, conversation memory |
| `@chainclaw/agent-sdk` | Autonomous agent framework: runner, backtest engine, performance tracker |
| `@chainclaw/gateway` | Telegram, Discord, WebChat adapters, rate limiter, message formatter |
| `@chainclaw/server` | Entry point — wires everything together |

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

Without an LLM provider, ChainClaw runs in command-only mode — slash commands work, natural language is disabled.

### Optional

```env
# RPC endpoints (defaults to public RPCs)
ETH_RPC_URL=
BASE_RPC_URL=
ARBITRUM_RPC_URL=
OPTIMISM_RPC_URL=
SOLANA_RPC_URL=

# Transaction simulation (Tenderly)
TENDERLY_API_KEY=
TENDERLY_ACCOUNT=
TENDERLY_PROJECT=

# Live swap execution (quotes work without it)
1INCH_API_KEY=

# Logging
LOG_LEVEL=info                          # fatal/error/warn/info/debug/trace
```

## Development

```bash
npm install
npx turbo build
npx turbo test              # Run all 451 tests
```

Run a specific package's tests:

```bash
npx vitest run --config packages/skills/vitest.config.ts
npx vitest run --config apps/server/vitest.config.ts
```

### Test Suite

451 tests across 50 test files:

| Category | Tests | What it covers |
|----------|-------|----------------|
| Unit tests | 379 | Every package in isolation — skills, pipeline, wallet crypto, chain adapters, intent parsing, agent SDK |
| Integration tests | 72 | Full-stack flows through real component wiring — boot, wallet lifecycle, command routing, skill pipeline, NL-to-skill, background services, agent lifecycle |
| Journey tests | (included above) | 5 persona-based end-to-end journeys: beginner onboarding, active DeFi trader, portfolio manager, agent creator, DAO treasury (Discord) |

Integration tests use a harness that mirrors the production boot sequence with real internal components, mocking only external boundaries (RPCs, HTTP APIs, LLM).

## Docker

```bash
# Basic
docker compose up -d

# With TLS (Caddy reverse proxy)
docker compose --profile tls up -d
```

Health check at `http://localhost:9090/health`.

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
| LLM | Anthropic SDK, OpenAI SDK, Ollama (local) |
| Testing | Vitest |

## License

MIT
