# ChainClaw — *Shopify for AI Trading Agents*

### Implementation Plan & Progress

**Version 2.0 · February 2026**

---

## Executive Summary

**ChainClaw** is an open-source platform for building, running, and monetizing autonomous DeFi agents. Users create AI-powered trading agents, customize them with skills and proprietary knowledge, backtest them against historical data, and publish them to a marketplace where others can subscribe and let those agents trade on their behalf.

The platform runs local-first on open-source LLMs (Llama, Mistral, DeepSeek via Ollama), eliminating the $50–200+/month API cost that makes autonomous agents impractical for retail users. All trading executes in the subscriber's own self-custody wallet — agents never hold user funds.

ChainClaw is three things in one:

1. **An open-source DeFi agent framework** — the "OpenClaw for DeFi" that anyone can self-host for free
2. **A creator toolkit** — SDK and tools for building, backtesting, and publishing custom trading agents
3. **A marketplace** — where agent creators monetize their strategies and subscribers access proven, AI-executed trading intelligence

| Pillar | Description |
|---|---|
| **Self-Custody** | Your keys stay on your hardware. Agents execute in your wallet. No deposits into protocol contracts. |
| **Zero-Cost Agents** | Runs on local open-source LLMs via Ollama. No API subscriptions. Just your own hardware. |
| **Agent Marketplace** | Subscribe to expert-built agents ranked by verified on-chain performance. Cancel anytime. |
| **Safety-First** | Transaction simulation, spending limits, contract allowlists, and built-in risk scoring before every execution. |
| **DeFi-Native Intelligence** | Fine-tuned models optimized specifically for DeFi decision-making, trained on real on-chain outcome data. |

---

## Market Opportunity

### The Convergence Moment

Four forces are converging that create a unique window:

- **OpenClaw proved the agent model.** A self-hosted AI agent reached 200K+ GitHub stars in weeks. People want agents that execute, not just advise.
- **Coinbase shipped the financial rails.** Agentic Wallets and the x402 protocol (50M+ transactions) provide plug-and-play wallet infrastructure for AI agents.
- **Open-source LLMs reached DeFi-capable reasoning.** Llama 3.1, Mistral, and DeepSeek can handle multi-step DeFi reasoning when properly prompted — no $20/month API subscription needed.
- **Copy-trading is broken.** Existing platforms (eToro, Bybit, 3Commas) copy exact trades — they don't adapt to the subscriber's portfolio size, risk tolerance, or market context. AI agents can.

### The Gap in the Market

| Category | Examples | What's Missing |
|---|---|---|
| **General AI Agents** | OpenClaw, custom bots | No DeFi execution, no financial guardrails, no marketplace |
| **Trading Bots** | 3Commas, CryptoHero, Autonio | Rule-based, no intelligence, no natural language, no self-custody |
| **Copy-Trading** | eToro, Bybit Copy Trade | Copies exact trades, doesn't adapt to subscriber context, centralized custody |
| **DeFAI Protocols** | Fetch.ai, Virtuals, ai16z | Token-centric, speculative, not practical agents |
| **MCP Servers** | defi-trading-mcp | Basic tools, no persistent agent, no marketplace, no safety layer |
| **Wallet Infra** | Coinbase AgentKit / Awal | Rails only — needs an agent and marketplace built on top |

**ChainClaw occupies the empty center** — an open-source platform where anyone can build, publish, and subscribe to intelligent DeFi agents that execute in self-custody wallets.

### Target Users

**Agent Creators (Supply Side):**
- Expert traders who want to monetize their strategies without managing other people's money
- DeFi researchers and quant developers who build systematic strategies
- Alpha groups and signal providers who want to automate their calls into executable agents
- Developers who want to build and sell specialized DeFi tools

**Agent Subscribers (Demand Side):**
- DeFi users who want professional-grade strategy execution without the expertise
- Portfolio managers who want to automate routine operations (rebalancing, yield rotation, DCA)
- DAOs and treasuries that need programmable, auditable on-chain operations
- Passive investors who want exposure to DeFi yields without active management

---

## Product Vision

ChainClaw is a platform where AI trading agents are built, battle-tested, and traded as a service. Agent creators package their intelligence into autonomous agents. Subscribers let those agents manage their DeFi positions. The platform handles execution, safety, and trust verification.

### How It Works

```
CHAINCLAW PLATFORM
══════════════════════════════════════════════════════════════

 FOR AGENT CREATORS                 FOR SUBSCRIBERS
 ───────────────────                ─────────────────
 Build agent with SDK               Browse marketplace
       ↓                                  ↓
 Add custom skills                  Filter by performance,
 (swap, LP, arb, yield...)         risk profile, chain
       ↓                                  ↓
 Feed proprietary knowledge         Subscribe to agent
 (signals, analysis, data)         (free / monthly / perf fee)
       ↓                                  ↓
 Set risk parameters                Agent executes in YOUR
 & guardrails                      self-custody wallet
       ↓                                  ↓
 Backtest against                   Monitor performance,
 historical data                   adjust limits, cancel
       ↓                            anytime
 Publish to marketplace
 with pricing model                      ↓
       ↓                            Every trade logged &
 Earn subscription revenue          verifiable on-chain

══════════════════════════════════════════════════════════════
                    PLATFORM REVENUE
            15–20% commission on subscriptions
            Managed hosting for creators
            Premium backtesting infrastructure
            Featured agent listings
══════════════════════════════════════════════════════════════
```

### Why AI Agents Beat Copy-Trading

| | Copy-Trading | ChainClaw Agents |
|---|---|---|
| **Execution** | Mirrors exact trades | Adapts strategy to your portfolio |
| **Position sizing** | Fixed ratio of leader | Dynamic based on your risk params |
| **Custody** | Platform holds funds | Self-custody, your wallet |
| **Intelligence** | None — pure mimicry | AI reasons about your specific context |
| **Risk management** | Leader's risk = your risk | Independent guardrails per subscriber |
| **Transparency** | Trade history only | Full reasoning trace for every decision |

### Core Interaction Model

The primary interface is conversational. Users DM ChainClaw on Telegram — the same surface they already use for crypto alpha.

> *"Bridge 5 ETH to Arbitrum, swap half to USDC, deposit into Aave, alert me if lending rate drops below 3%"*
>
> *"Show me the top performing agents this month. Subscribe me to the best yield optimizer with max $5K exposure."*
>
> *"How is my subscribed agent performing? Show me its reasoning for the last 3 trades."*
>
> *"Is this token safe? Check 0x3f5... on Base before I ape."*

---

## Marketplace Agent Categories

| Category | Description | Example Agents |
|---|---|---|
| **Yield Optimizers** | Auto-rotate capital across lending protocols for highest APY | "StableMaxx" — optimizes USDC yield across Aave, Compound, Morpho |
| **Active Traders** | Execute directional trades based on signals and analysis | "MomentumAlpha" — trades ETH/BTC momentum breakouts on Base |
| **LP Managers** | Manage concentrated liquidity positions | "RangeRider" — rebalances Uniswap v3 positions to maximize fees |
| **DCA Strategists** | Intelligent dollar-cost averaging with timing optimization | "SmartDCA" — accumulates ETH with gas and volatility-aware timing |
| **Risk Managers** | Monitor and protect existing positions | "ShieldBot" — monitors liquidation risk and auto-deleverages |
| **Airdrop Hunters** | Execute qualifying interactions for potential airdrops | "DropSeeker" — systematic protocol interaction for airdrop eligibility |
| **Multi-Strategy** | Blend multiple approaches into a single agent | "DeFiPilot" — balanced mix of yield, trading, and risk management |

### Marketplace Trust & Verification

- **On-chain verification** — every agent trade is logged on-chain, creating an immutable track record
- **Standardized metrics** — total return, max drawdown, Sharpe ratio, win rate, avg trade duration
- **Minimum track record** — agents must run 30+ days with real capital before appearing in rankings
- **Reasoning transparency** — subscribers inspect the full chain-of-thought for any trade
- **Independent backtesting** — subscribers re-run any agent's strategy against historical data

### Cold Start Strategy

1. **Seed with internal agents** — build 5–10 agents using different LLMs: "Claude Conservative," "DeepSeek Aggressive," "Llama Balanced," "Mistral Contrarian"
2. **Run them with real capital** — small positions, real trades, real P&L
3. **Publish weekly results** — "Week 4: Claude's yield strategy up 8%, DeepSeek's momentum play down 2%"
4. **Multi-LLM competition as content engine** — performance comparisons generate weekly CT engagement

---

## Local-First LLM Strategy

### The Cost Problem

Running an autonomous DeFi agent on frontier API models costs $50–200+/month in API calls. This kills adoption for retail users and breaks marketplace economics — subscribers can't pay $29/month for a strategy if the underlying LLM costs more.

### The Solution: Open-Source Models + Fine-Tuning

| Tier | Model | Cost | Best For |
|---|---|---|---|
| **Free (Default)** | Llama 3.1 8B / Mistral 7B via Ollama | $0 (your hardware) | Basic strategies, yield optimization, portfolio management |
| **Low Cost** | DeepSeek API | ~$2–5/month | Complex multi-step reasoning, active trading strategies |
| **Premium** | Claude / GPT-4 API | $50–200/month | Maximum reasoning quality, institutional use |
| **ChainClaw DeFi Model** | Fine-tuned 7B model | $0 (your hardware) | Purpose-built DeFi reasoning at local-model cost |

### The Fine-Tuned DeFi Model (Long-Term Moat)

A 7B parameter model fine-tuned on DeFi-specific reasoning and outcome data can outperform general-purpose frontier models on trading decisions because it learns the domain deeply rather than knowing everything broadly.

**Fine-Tuning Phases:**

1. **RAG + Local Model (Launch):** Index DeFi knowledge corpus into vector store. Retrieve relevant context at decision time. Gets 70% of the way with zero training cost.
2. **QLoRA Fine-Tune (Month 2–3):** Once 10K–50K reasoning traces collected. Fine-tune on single A100/4090. Cost: ~$50–200 per run.
3. **Continuous Learning (Month 4+):** Every marketplace decision = new training data. Weekly retraining. Specialized models emerge per strategy type.

**The Data Moat:** After 6 months, ChainClaw will have millions of labeled DeFi decisions with context, reasoning traces, and verified outcomes. This dataset is impossible to replicate without running a similar marketplace. The open-source framework can be forked. The fine-tuned model trained on proprietary marketplace data cannot.

---

## Competitive Advantages

1. **Agent Marketplace with Verified Performance** — No other DeFi agent platform offers a marketplace with on-chain verified track records. Network effects: more creators → more subscribers → more data → better platform.
2. **Zero-Cost Local Execution** — Open-source LLMs via Ollama eliminate the API cost barrier. Self-host for free.
3. **AI Agents > Copy-Trading** — Agents adapt strategies to each subscriber's context. Fundamentally better product.
4. **The Data Flywheel** — Every marketplace transaction generates labeled training data. Fine-tuned DeFi model improves from proprietary dataset — moat forks can't replicate.
5. **Self-Custody by Default** — Executes in subscriber's own wallet. No counterparty risk.
6. **Open Source + Security-First** — Trust through transparency. Security is a launch feature: tx simulation, sandboxed skills, hardware wallets, spending limits from Day 1.

---

## Technical Architecture

**Tech Stack:** Node.js / TypeScript, Turborepo, viem, SQLite (better-sqlite3), Docker, grammY, Discord.js, Zod, Pino

```
┌──────────────────────────────────────────────────────────────────────┐
│                        ChainClaw Gateway                             │
│                (Node.js · Runs on your hardware)                     │
├──────────────┬───────────────────┬───────────────────────────────────┤
│  CHANNELS    │  AGENT RUNTIME    │  ON-CHAIN LAYER                   │
│  ────────    │  ─────────────    │  ──────────────                   │
│  Telegram    │  LLM Engine       │  Chain Adapters                   │
│  Discord     │  (Ollama local /  │  (ETH, Base, Arb, OP)            │
│  WebChat     │   Claude / GPT /  │         ↕                        │
│              │   DeepSeek)       │  Tx Simulator                    │
│              │       ↕           │  (Tenderly / Anvil fork)         │
│              │  Intent Parser    │         ↕                        │
│              │       ↕           │  Safety Layer                    │
│              │  Skill Engine     │  (Risk engine + guardrails)      │
│              │       ↕           │         ↕                        │
│              │  Memory Store     │  Wallet Manager                  │
│              │       ↕           │  (Local / Coinbase / Ledger /    │
│              │  Strategy Sub     │   Safe)                          │
│              │  Manager          │         ↕                        │
│              │                   │  Backtesting Engine              │
├──────────────┴───────────────────┴───────────────────────────────────┤
│                      MARKETPLACE LAYER                               │
│  Agent Registry · Performance Leaderboards · Subscription Billing    │
│  Creator Dashboard · Verified On-Chain Track Records                 │
└──────────────────────────────────────────────────────────────────────┘
```

### Monorepo Structure

```
chainclaw/
├── packages/
│   ├── core/           # Config, logging, shared types
│   ├── chains/         # EVM chain adapters (ETH, Base, Arbitrum, Optimism)
│   ├── wallet/         # Key management, Signer abstraction (Local/Coinbase/Ledger/Safe)
│   ├── pipeline/       # Tx simulation, guardrails, risk engine, MEV protection
│   ├── agent/          # LLM providers, intent parsing, conversation memory
│   ├── skills/         # Skill registry + 14 built-in skills
│   ├── agent-sdk/      # Agent definitions, backtesting, performance tracking
│   ├── marketplace/    # Agent registry, subscriptions, leaderboards
│   └── gateway/        # Telegram, Discord, WebChat adapters
├── apps/
│   └── server/         # Main entry point, wires everything together
├── .github/workflows/  # CI (build + test on push/PR)
├── docker-compose.yml
├── turbo.json
└── tsconfig.base.json
```

---

## Go-to-Market Strategy

### Phase 1: Build in Public — The Agent (Weeks 1–4)

- Daily X/Twitter thread documenting development from Day 1
- Ship a working Telegram bot in Week 2 — balance check + swap using local Ollama model
- First demo video: DM the agent on Telegram, watch it execute a swap with a local LLM, zero API cost
- Target crypto developer communities: DeFi Discord servers, Ethereum dev channels, Base ecosystem

### Phase 2: Open Source Launch — The Framework (Weeks 5–8)

- Open-source the repository with comprehensive documentation and 5-minute Docker setup
- Launch with 9 built-in skills and the creator SDK for custom skill development
- Publish on HackerNews, r/ethereum, r/defi
- GitHub stars goal: 10K in first week
- Seed the multi-LLM competition: deploy internal agents with real capital, publish weekly results

### Phase 3: Marketplace Launch (Weeks 9–14)

- Launch the agent marketplace with 5–10 internally-built agents as initial inventory
- Performance leaderboards with verified on-chain track records
- Subscription billing (crypto-native — USDC payments)
- Creator onboarding program — invite 20–30 expert traders to build and publish agents
- Partner with DeFi protocols for co-marketing (Aave, Uniswap, Li.Fi)

### Phase 4: Data Flywheel (Month 4+)

- Collect labeled decision data from marketplace activity
- First QLoRA fine-tune on reasoning traces + outcome data
- Release ChainClaw DeFi Model as open-source (base model, not training data)
- Launch premium backtesting infrastructure and managed hosting

### Viral Mechanics

| Phase | Viral Mechanic |
|---|---|
| **Agent Launch** | "Open-source DeFi agent that runs free on local LLMs" |
| **Framework Launch** | Creators post custom agents: "I built an agent that farms yield across 5 chains while I sleep" |
| **Marketplace Launch** | Weekly leaderboards: "Top agent this month returned 23%" |
| **Data Flywheel** | "ChainClaw DeFi Model beats GPT-4 on trading decisions at 1/100th cost" |

---

## Monetization Strategy

ChainClaw's core framework is free and open source. Revenue comes from the marketplace and ecosystem services.

| Stream | Description |
|---|---|
| **Marketplace Commission (Primary)** | 15–20% of agent subscription fees |
| **Managed Hosting** | 1-click cloud deployment: $29–$99/month |
| **Premium Backtesting** | Institutional-grade historical replay infrastructure |
| **Featured Listings** | Promoted placement in marketplace rankings |
| **Enterprise / DAO Tier** | Multi-agent deployment, audit logging, compliance features |

### Unit Economics

| Metric | Assumption |
|---|---|
| Average agent subscription | $25/month |
| Platform take rate | 17.5% |
| Revenue per subscription | $4.38/month |
| Target: 1,000 active subs (Month 6) | $4,375/month |
| Target: 10,000 active subs (Month 12) | $43,750/month |
| + Managed hosting (200 creators × $49) | $9,800/month |
| **Month 12 target revenue** | **~$53,500/month** |

**Token Strategy:** No token at launch. Ship the product, build genuine usage, then evaluate a governance token for marketplace curation, fee distribution, and creator incentives.

---

## Risk Analysis

| Risk | Impact | Mitigation |
|---|---|---|
| **Security breach / wallet drain** | Critical | Simulation-first design, hardware wallet support, spending limits, sandboxed skills, security audit before launch |
| **Bad agent performance** | High | Mandatory backtesting, minimum track record, prominent risk warnings, subscriber-controlled guardrails |
| **Marketplace cold start** | High | Seed with 5–10 internal agents (multi-LLM competition). Weekly performance content. |
| **Coinbase builds competing marketplace** | High | Open-source + self-custody differentiates. Move fast. Coinbase version would be custodial. |
| **Regulatory pressure** | Medium | Agents are tools, not advisors. Compliance features built in. Self-hosted = user liability. |
| **Prompt injection attacks** | High | Strict input sanitization, separate contexts, allowlisted interactions, reasoning trace auditing |
| **LLM quality insufficient** | Medium | RAG bridges gap at launch. Fine-tuning improves. Cloud LLM fallback always available. |
| **Creator fraud / fake performance** | Medium | All performance verified on-chain. Mandatory real-capital track record. Community reporting. |

---

## Implementation Progress

**Current Status:** Phases 1–9 complete. 12 packages building, 182 tests passing, 14 skills registered, 17 SQLite tables, 3 channels.

---

### Phase 1: Foundation & Telegram Bot ✅

**Goal:** Runnable Telegram bot with EVM chain connections and wallet management.

**Packages Created:**
- `@chainclaw/core` — Config (Zod-validated env), structured logging (Pino), shared types
- `@chainclaw/chains` — `ChainAdapter` (viem), `ChainManager`, chain registry (ETH/Base/Arb/OP)
- `@chainclaw/wallet` — `WalletManager`, AES-256-GCM encryption, key derivation
- `@chainclaw/skills` — `SkillRegistry`, `createBalanceSkill`
- `@chainclaw/gateway` — `createTelegramBot` (grammY), command router, rate limiter
- `apps/server` — Main entry point

**Key Deliverables:**
- Turborepo monorepo with shared TypeScript config
- Telegram bot with `/start`, `/help`, `/wallet`, `/balance` commands
- Chain adapters for Ethereum Mainnet (1) and Base (8453)
- Encrypted local wallet (AES-256-GCM, scrypt key derivation)
- Docker Compose for deployment
- GitHub Actions CI (build + test on push/PR)

---

### Phase 2: LLM Brain & Natural Language Understanding ✅

**Goal:** Natural language DeFi commands with LLM-powered intent parsing and conversation memory.

**Package Created:** `@chainclaw/agent` — LLM providers, intent parser, memory, preferences

**Key Deliverables:**
- Multi-provider LLM abstraction: Anthropic Claude, OpenAI GPT-4, Ollama (local models)
- Intent parser: NL → structured `Intent` objects with action, params, confidence
- SQLite conversation memory with per-user history
- User preferences store (default chain, slippage, thresholds)
- Skill engine: LLM routes intents to registered skills
- NL message handling in Telegram (not just slash commands)

**SQLite Tables:** `conversations`, `user_preferences`

---

### Phase 3: Transaction Pipeline & First DeFi Skills ✅

**Goal:** Execute real swaps on-chain via natural language with simulation and safety.

**Package Created:** `@chainclaw/pipeline` — Transaction executor, simulator, guardrails, nonce manager

**Key Deliverables:**
- Full tx pipeline: build → simulate → guardrails → confirm → sign → broadcast → monitor
- Tenderly simulation API integration (preview balance changes, gas, reverts)
- Per-user spending limits (daily/per-tx max, cooldown, slippage)
- Transaction logging with full lifecycle tracking

**SQLite Tables:** `user_limits`, `tx_log`
**Skills Added:** `swap` (1inch), `portfolio` (multi-chain aggregation)

---

### Phase 4: Safety Engine & Risk Analytics ✅

**Goal:** Multi-layer safety pipeline with contract/token risk scoring.

**Key Deliverables:**
- GoPlus Security API integration (honeypot, owner privileges, blacklist detection)
- Composite risk scoring (0–100) with human-readable reports
- Risk cache with TTL (SQLite-backed)
- Contract allowlist/blocklist per user
- MEV protection via Flashbots/private RPC endpoints

**SQLite Tables:** `risk_cache`, `contract_list`
**Skills Added:** `risk_check` (GoPlus), `history` (transaction history)

---

### Phase 5: Full DeFi Skills Suite ✅

**Goal:** Complete DeFi operations: bridging, lending, DCA, alerts, workflows, multi-chain.

**Key Deliverables:**
- Bridge skill via Li.Fi/Socket API (cross-chain routing)
- Lend/borrow skill for Aave V3 (supply, withdraw, borrow, repay)
- DCA scheduler (configurable intervals, SQLite persistence, gas-optimized)
- Alert engine (price alerts with Telegram notifications)
- Multi-step workflow engine (chain skills into sequential operations)
- Chain expansion: Arbitrum (42161), Optimism (10)

**SQLite Tables:** `dca_jobs`, `alerts`
**Skills Added:** `bridge`, `lend`, `dca`, `alert`, `workflow`

---

### Phase 6: Multi-Wallet & Additional Channels ✅

**Goal:** Hardware wallets, Coinbase AgentKit, Safe multisig, Discord, and web channels.

**Key Deliverables:**
- Signer abstraction interface with 4 implementations:
  - `LocalSigner` — Encrypted private key on disk (automatic signing)
  - `CoinbaseSigner` — Coinbase CDP/MPC wallet integration (automatic)
  - `LedgerSigner` — Hardware wallet, requires physical confirmation (manual)
  - `SafeSigner` — Gnosis Safe multisig, requires co-signer threshold (manual)
- Discord bot (discord.js) with slash commands + NL messages
- WebChat server (WebSocket) with built-in HTML UI and `/health` endpoint
- Shared `GatewayDeps` interface across all channels
- Inline keyboard confirmation flow (Telegram) with 2-minute timeout

**Gateway Channels:**
| Channel | Library | Features |
|---------|---------|----------|
| Telegram | grammY | Slash commands, NL, inline keyboards, alert push |
| Discord | discord.js | Slash commands, NL messages |
| WebChat | ws + HTTP | WebSocket JSON protocol, static HTML UI, health check |

---

### Phase 7: Agent Creator Toolkit & Backtesting ✅

**Goal:** SDK for building, testing, and running autonomous trading agents.

**Package Created:** `@chainclaw/agent-sdk` — Agent definitions, backtesting, live runner, performance tracking

**Key Deliverables:**
- `AgentDefinition` type system (name, strategy, risk params, knowledge sources)
- `StrategyConfig` with pure `evaluate()` function (portfolio, prices → decisions)
- `HistoricalDataProvider` — CoinGecko `/market_chart/range` + SQLite cache
- `BacktestEngine` — Daily-tick replay with fees/slippage, computes Sharpe/drawdown/win rate/alpha
- `AgentRunner` — Live execution via `setInterval`, dry-run and live modes
- `PerformanceTracker` — Agent instances, trades, reasoning traces, metrics
- `createSampleDcaAgent()` — Weekly DCA template for testing
- `PriceFetcher` injection pattern (breaks circular dependency with skills)

**SQLite Tables:** `historical_prices`, `agent_instances`, `agent_trades`, `reasoning_traces`
**Skills Added:** `backtest`, `agent` (start/stop/pause/monitor)

---

### Phase 8: Agent Marketplace ✅

**Goal:** Registry, subscriptions, and leaderboards for published agents.

**Package Created:** `@chainclaw/marketplace` — Agent registry, subscription manager, leaderboard service

**Key Deliverables:**
- `AgentRegistry` — Factory registry model (in-memory factories + SQLite metadata)
  - `registerFactory()`, `publish()`, `unpublish()`, `search()`, `getByCategory()`
- `SubscriptionManager` — Subscribe auto-starts agent, unsubscribe auto-stops
  - `subscribe()`, `unsubscribe()`, `getUserSubscriptions()`, `isSubscribed()`
- `LeaderboardService` — Ranks agents by return, filters by category/time window
  - `getLeaderboard()`, `getAgentRank()`, `formatLeaderboard()`
- Pricing models: free, monthly subscription, performance fee
- Built-in DCA agent published as seed marketplace content

**SQLite Tables:** `marketplace_agents`, `marketplace_subscriptions`
**Skills Added:** `marketplace` (browse, search, detail, subscribe, unsubscribe, my-agents, leaderboard)

---

### Phase 9: Skills Ecosystem & Production Launch ✅

**Goal:** Skills SDK for community extensions, sandboxed execution, health checks, Docker hardening, onboarding wizard, CI improvements, docs scaffold.

**Package Created:** `@chainclaw/skills-sdk` — Skill manifest types, defineSkill helper, sandboxed executor, filesystem skill loader

**Key Deliverables:**
- `SkillManifest` type system with permission declarations (`wallet:read`, `wallet:sign`, `network:read`, `network:write`, `storage:read`, `storage:write`, `http:outbound`)
- `defineSkill(manifest, factory)` — validates manifest via Zod, checks factory produces matching skill name
- `SandboxedExecutor` — wraps `execute()` with `Promise.race` timeout (5s default), output truncation (4096 chars), error containment
- `SkillLoader` — scans directory for community skill packages, reads `chainclaw-skill.json` manifests, dynamic-imports entry points, auto-wraps in sandbox, registers with `SkillRegistry`
- Health check HTTP server: `GET /health` (liveness), `GET /ready` (readiness) on configurable port (default 9090)
- Onboarding wizard in `/start` command: detects missing wallet/LLM and guides setup
- Docker: `HEALTHCHECK` directive, `EXPOSE 8080 9090`, Caddy TLS reverse proxy (via `--profile tls`), fixed missing `agent-sdk`/`marketplace` package copies
- CI: Docker build job added after tests pass
- VitePress docs scaffold (`@chainclaw/docs`) with nav, sidebar, and landing page
- Config: `healthCheckPort`, `skillsDir` env vars added

---

## Current Inventory

### Packages (12)
| Package | Purpose |
|---------|---------|
| `@chainclaw/core` | Config, logging, shared types |
| `@chainclaw/chains` | EVM chain adapters, registry |
| `@chainclaw/wallet` | Key management, 4 signer types |
| `@chainclaw/pipeline` | Tx simulation, guardrails, risk, MEV |
| `@chainclaw/agent` | LLM providers, intent parsing, memory |
| `@chainclaw/skills` | Skill registry + 14 skill factories |
| `@chainclaw/skills-sdk` | Community skill SDK, sandbox, loader |
| `@chainclaw/agent-sdk` | Agent definitions, backtesting, runner |
| `@chainclaw/marketplace` | Registry, subscriptions, leaderboards |
| `@chainclaw/gateway` | Telegram, Discord, WebChat |
| `@chainclaw/docs` | VitePress documentation site (scaffold) |
| `@chainclaw/server` | Main entry point |

### Skills (14)
| Skill | Description |
|-------|-------------|
| `balance` | Native + token balances across chains |
| `swap` | Token swaps via 1inch |
| `bridge` | Cross-chain bridging via Li.Fi |
| `lend` | Aave V3 supply/withdraw/borrow/repay |
| `dca` | Dollar-cost averaging scheduler |
| `alert` | Price alerts with Telegram notifications |
| `workflow` | Multi-skill pipeline orchestration |
| `portfolio` | Multi-chain portfolio with USD values |
| `risk_check` | Contract/token risk scoring via GoPlus |
| `history` | Transaction history retrieval |
| `backtest` | Strategy backtesting with metrics |
| `agent` | Live agent start/stop/pause/monitor |
| `marketplace` | Browse, subscribe, leaderboards |
| `prices` | Token price oracle (utility) |

### SQLite Tables (17)
| Table | Package | Purpose |
|-------|---------|---------|
| `conversations` | agent | Chat history |
| `user_preferences` | agent | User settings |
| `user_limits` | pipeline | Spending guardrails |
| `tx_log` | pipeline | Transaction records |
| `risk_cache` | pipeline | Risk report cache |
| `contract_list` | pipeline | Allow/block lists |
| `dca_jobs` | skills | DCA schedules |
| `alerts` | skills | Price alerts |
| `historical_prices` | agent-sdk | Price cache for backtesting |
| `agent_instances` | agent-sdk | Agent metadata |
| `agent_trades` | agent-sdk | Trade records |
| `reasoning_traces` | agent-sdk | Decision reasoning |
| `marketplace_agents` | marketplace | Published agents |
| `marketplace_subscriptions` | marketplace | User subscriptions |

### Tests (220 total)
| Package | Tests |
|---------|-------|
| core | 5 |
| chains | 6 |
| wallet | 14 |
| pipeline | 58 |
| agent | 22 |
| agent-sdk | 23 |
| marketplace | 35 |
| skills | 5 |
| skills-sdk | 18 |
| data-pipeline | 34 |

---

## Phase 10: Data Flywheel & Fine-Tuning ✅

**Status:** Complete — 13 packages, 220 tests

### Deliverables
- **`@chainclaw/data-pipeline`** — New package with 3 core components:
  - **OutcomeLabeler** — Background scheduler fills PnL on trades at 1h/24h/7d windows via price oracle
  - **ReasoningEnricher** — Uses Claude/GPT-4 to generate structured chain-of-thought from raw strategy decisions
  - **TrainingDataExporter** — Joins trades + labels + enriched reasoning, exports as JSONL (Alpaca/ChatML format)
  - **Hosting tier types** — Starter ($29), Pro ($59), Enterprise ($99) tier definitions
- **Leaderboard enhancement** — `LeaderboardService` queries live `agent_trades` for time-windowed rankings (7d/30d/90d)
- **Solana chain support** — `createSolanaAdapter()` using `@solana/web3.js`, chain registry entry (ID 900)
- **`ChainAdapter` interface widened** — `Address` → `string` to support both EVM (0x) and Solana (base58) addresses
- **Config extensions** — `solanaRpcUrl`, `dataPipelineEnabled`, `outcomeLabelIntervalMs`, `reasoningEnrichmentEnabled`
- **Server wiring** — OutcomeLabeler + ReasoningEnricher integrated with startup/shutdown lifecycle
- **Docker** — `data-pipeline` COPY lines added to Dockerfile

### New SQLite Tables
| Table | Package | Purpose |
|-------|---------|---------|
| `outcome_labels` | data-pipeline | PnL labels at 1h/24h/7d windows per trade |
| `enriched_reasoning` | data-pipeline | LLM-generated chain-of-thought per reasoning trace |

### Files Created/Modified
- New: 11 files in `packages/data-pipeline/`
- New: `packages/chains/src/solana-adapter.ts`
- Modified: `packages/core/src/config.ts`, `packages/agent-sdk/src/performance-tracker.ts`
- Modified: `packages/chains/src/adapter.ts`, `registry.ts`, `manager.ts`, `index.ts`, `package.json`
- Modified: `packages/marketplace/src/leaderboard-service.ts`, `types.ts`
- Modified: `apps/server/src/index.ts`, `apps/server/package.json`
- Modified: `.env.example`, `Dockerfile`

---

## Phase Dependency Graph

```
Phase 1 (Foundation) ✅
   └──> Phase 2 (LLM Brain) ✅
           └──> Phase 3 (Tx Pipeline) ✅
                   ├──> Phase 4 (Safety Engine) ✅
                   │       └──> Phase 5 (Full DeFi Suite) ✅
                   │               └──> Phase 7 (Agent Toolkit) ✅
                   │                       └──> Phase 8 (Marketplace) ✅
                   │                               └──> Phase 10 (Data Flywheel) ✅
                   └──> Phase 6 (Multi-Wallet + Channels) ✅
                           └──> Phase 9 (Skills Ecosystem + Launch) ✅
```

**All 10 phases complete.** 13 packages, 220 tests, 5 chains, 14 skills, 3 channels.
