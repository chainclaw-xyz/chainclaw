# ⛓️ ChainClaw

### *Shopify for AI Trading Agents*

---

**Concept Document** · Version 2.0 · February 2026
**Confidential** · Prepared by Gopi

---

## Executive Summary

**ChainClaw** is an open-source platform for building, running, and monetizing autonomous DeFi agents. Users create AI-powered trading agents, customize them with skills and proprietary knowledge, backtest them against historical data, and publish them to a marketplace where others can subscribe and let those agents trade on their behalf.

The platform runs local-first on open-source LLMs (Llama, Mistral, DeepSeek via Ollama), eliminating the $50–200+/month API cost that makes autonomous agents impractical for retail users. All trading executes in the subscriber's own self-custody wallet — agents never hold user funds.

ChainClaw is three things in one:

1. **An open-source DeFi agent framework** — the "OpenClaw for DeFi" that anyone can self-host and use for free
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

Four forces are converging in February 2026 that create a unique window:

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

Traditional copy-trading has a fundamental flaw: when a whale trader buys $1M of ETH, your $500 account copies the identical trade. The context is completely wrong — your risk tolerance, portfolio composition, and position sizing are all different.

ChainClaw agents work differently. A subscriber doesn't copy trades — they subscribe to a **strategy and decision-making framework**. The agent adapts that intelligence to the subscriber's own portfolio size, risk parameters, current positions, and market conditions. The creator publishes the intelligence. The subscriber's local agent applies it to their specific situation.

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

> **Example Commands**
>
> *"Bridge 5 ETH to Arbitrum, swap half to USDC, deposit into Aave, alert me if lending rate drops below 3%"*
>
> *"Find the best yield for my stables across Base, Optimism, and Mainnet. Move funds there. Rebalance weekly."*
>
> *"Show me the top performing agents this month. Subscribe me to the best yield optimizer with max $5K exposure."*
>
> *"How is my subscribed agent performing? Show me its reasoning for the last 3 trades."*
>
> *"Is this token safe? Check 0x3f5... on Base before I ape."*

---

## Architecture Overview

ChainClaw runs as a persistent service on user-controlled hardware. It connects to messaging platforms via the Gateway, routes requests through the Agent Runtime, and executes on-chain through the DeFi execution layer.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        ChainClaw Gateway                              │
│                (Node.js · Runs on your hardware)                      │
├──────────────┬───────────────────┬────────────────────────────────────┤
│  CHANNELS    │  AGENT RUNTIME    │  ON-CHAIN LAYER                    │
│  ────────    │  ─────────────    │  ──────────────                    │
│              │                   │                                    │
│  Telegram    │  LLM Engine       │  Chain Adapters                    │
│  Discord     │  (Ollama local /  │  (EVM, Solana, Base, Arb, OP...)  │
│  WebChat     │   Claude / GPT /  │         ↕                         │
│              │   DeepSeek)       │  Tx Simulator                     │
│              │       ↕           │  (Tenderly / Anvil fork)          │
│              │  Intent Parser    │         ↕                         │
│              │       ↕           │  Safety Layer                     │
│              │  Skill Engine     │  (Risk engine + guardrails)       │
│              │       ↕           │         ↕                         │
│              │  Memory Store     │  Wallet Manager                   │
│              │       ↕           │  (Local / Awal / Ledger / Safe)   │
│              │  Strategy Sub     │         ↕                         │
│              │  Manager          │  Backtesting Engine               │
│              │                   │  (Historical replay + scoring)    │
├──────────────┴───────────────────┴────────────────────────────────────┤
│                      MARKETPLACE LAYER                                │
│  Agent Registry · Performance Leaderboards · Subscription Billing     │
│  Creator Dashboard · Verified On-Chain Track Records                  │
└───────────────────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. Gateway + Messaging Layer

Handles authentication, rate limiting, message routing, and channel management. Telegram is the primary channel (crypto's native messaging surface) with Discord and WebChat as secondary options.

#### 2. Agent Runtime + LLM Engine

The runtime connects to local LLMs via Ollama (Llama 3.1, Mistral, DeepSeek) as the default, with optional cloud LLM support (Claude, GPT-4) for users who prefer it. Persistent memory, conversation context, and user preferences carry across sessions. The Intent Parser translates natural language into structured transaction plans.

#### 3. Chain Adapters

Modular adapters handle RPC connections, transaction construction, gas estimation, and nonce management. Launch chains: **Ethereum Mainnet, Base, Arbitrum, Optimism.** Expansion to Solana and additional L2s post-launch.

#### 4. Wallet Layer

Flexible wallet integration supporting multiple custody models:

- **Local private keys** — encrypted on-device, never transmitted
- **Coinbase Agentic Wallets** — via AgentKit/x402 for managed custody with guardrails
- **Hardware wallets** — Ledger/Trezor for high-value operations requiring physical confirmation
- **Safe multisig** — for DAO/team treasury operations

#### 5. Safety Engine

Every transaction passes through a multi-layer safety pipeline:

1. **Intent Validation** — LLM confirms the parsed intent matches user's request
2. **Contract Risk Scoring** — built-in analytics engine flags suspicious contracts, honeypots, and rug risks
3. **Transaction Simulation** — dry-run on forked state (Tenderly/Anvil) to preview outcomes
4. **Guardrails Check** — spending limits, slippage tolerance, contract allowlists
5. **Confirmation Gate** — optional human approval for transactions above configured threshold

#### 6. Backtesting Engine

Historical market replay system that validates agent strategies against real on-chain data before they go live. Creators must demonstrate backtested performance before publishing to the marketplace. Subscribers can verify claims independently.

#### 7. Strategy Subscription Manager

Handles the lifecycle of agent subscriptions — discovery, activation, parameter customization, performance monitoring, and billing. Subscribers can blend multiple agents, set per-agent exposure limits, and override any agent decision.

---

## Agent Marketplace

The marketplace is ChainClaw's core business and primary viral mechanic. It's where agent intelligence becomes a tradeable asset.

### How the Marketplace Works

**For Creators:**
1. Build an agent using the ChainClaw SDK — define skills, strategy logic, and risk parameters
2. Feed it proprietary knowledge — trading signals, on-chain analytics, research, pattern recognition rules
3. Backtest against 12+ months of historical data across target chains
4. Publish to the marketplace with a pricing model (free, monthly subscription, or performance fee)
5. Agent's live performance is tracked and verified on-chain — no fake results

**For Subscribers:**
1. Browse agents filtered by performance, risk profile, chain, strategy type, and track record duration
2. Review the agent's full trade history, reasoning traces, and risk metrics
3. Subscribe — the agent begins executing in the subscriber's own wallet with their configured limits
4. Monitor performance in real-time via Telegram DM or the web dashboard
5. Cancel, switch, or blend agents at any time

### Marketplace Agent Categories

| Category | Description | Example Agents |
|---|---|---|
| **Yield Optimizers** | Auto-rotate capital across lending protocols for highest APY | "StableMaxx" — optimizes USDC yield across Aave, Compound, Morpho |
| **Active Traders** | Execute directional trades based on signals and analysis | "MomentumAlpha" — trades ETH/BTC momentum breakouts on Base |
| **LP Managers** | Manage concentrated liquidity positions | "RangeRider" — rebalances Uniswap v3 positions to maximize fees |
| **DCA Strategists** | Intelligent dollar-cost averaging with timing optimization | "SmartDCA" — accumulates ETH with gas and volatility-aware timing |
| **Risk Managers** | Monitor and protect existing positions | "ShieldBot" — monitors liquidation risk and auto-deleverages |
| **Airdrop Hunters** | Execute qualifying interactions for potential airdrops | "DropSeeker" — systematic protocol interaction for airdrop eligibility |
| **Multi-Strategy** | Blend multiple approaches into a single agent | "DeFiPilot" — balanced mix of yield, trading, and risk management |

### Trust and Verification

The marketplace's credibility depends on verified, trustworthy performance data:

- **On-chain verification** — every agent trade is logged on-chain, creating an immutable track record
- **Standardized metrics** — all agents report the same set of performance metrics (total return, max drawdown, Sharpe ratio, win rate, avg trade duration)
- **Minimum track record** — agents must run for 30+ days with real capital before appearing in marketplace rankings
- **Reasoning transparency** — subscribers can inspect the full chain-of-thought reasoning for any trade the agent made
- **Independent backtesting** — subscribers can re-run any agent's strategy against historical data to verify claims

### Cold Start Strategy

The marketplace needs quality agents before subscribers arrive. The cold start solution:

1. **Seed with internal agents** — build 5–10 agents in-house using different LLMs and strategies: "Claude Conservative," "DeepSeek Aggressive," "Llama Balanced," "Mistral Contrarian"
2. **Run them with real capital** — small positions, real trades, real P&L
3. **Publish weekly results** — "Week 4: Claude's yield strategy up 8%, DeepSeek's momentum play down 2%, Llama's balanced approach up 3%." This is both marketing content and marketplace inventory
4. **Multi-LLM competition as content engine** — the performance comparison between different LLMs generates weekly engagement that markets itself on Crypto Twitter

---

## Local-First LLM Strategy

### The Cost Problem

Running an autonomous DeFi agent on frontier API models is expensive. An agent that monitors positions, analyzes market conditions, and makes decisions 24/7 could cost $50–200+/month in API calls to Claude or GPT-4. This kills adoption for retail users and makes the marketplace economics impossible — subscribers can't pay $29/month for a strategy if the underlying LLM costs more than that.

### The Solution: Open-Source Models + Fine-Tuning

ChainClaw runs on local open-source LLMs by default, with cloud APIs as an optional upgrade:

| Tier | Model | Cost | Best For |
|---|---|---|---|
| **Free (Default)** | Llama 3.1 8B / Mistral 7B via Ollama | $0 (your hardware) | Basic strategies, yield optimization, portfolio management |
| **Low Cost** | DeepSeek API | ~$2–5/month | Complex multi-step reasoning, active trading strategies |
| **Premium** | Claude / GPT-4 API | $50–200/month | Maximum reasoning quality, institutional use |
| **ChainClaw DeFi Model** | Fine-tuned 7B model (see below) | $0 (your hardware) | Purpose-built DeFi reasoning at local-model cost |

The killer tier is the last one — a small model fine-tuned specifically for DeFi decision-making that outperforms GPT-4 on this narrow task at zero marginal cost.

### The Fine-Tuned DeFi Model (Long-Term Moat)

A 7B parameter model fine-tuned on DeFi-specific reasoning and outcome data can outperform general-purpose frontier models on trading decisions because it learns the domain deeply rather than knowing everything broadly.

#### Data Requirements

**Layer 1: On-Chain Transaction Data (The Foundation)**

Historical transactions across major protocols — swaps, lending events, LP lifecycle data, bridge transactions, liquidation events. Each transaction paired with market context at execution time and outcome data (P&L at 1hr, 24hr, 7d).

| Data Type | Source | Volume Target |
|---|---|---|
| DEX swap history | Dune Analytics, The Graph | 50M+ transactions |
| Lending protocol events | Aave/Compound subgraphs, Dune | 10M+ events |
| LP position lifecycle | Uniswap/Curve subgraphs | 5M+ positions |
| Liquidation events | Protocol event logs | 1M+ events |
| Bridge transactions | Li.Fi API, socket data | 5M+ transactions |

**Layer 2: Market Context Data (The Signal)**

Price feeds (OHLCV at 1min–1d granularity), TVL changes per protocol and pool, gas prices across chains, funding rates, stablecoin flows, whale wallet movements. This provides the "why" behind on-chain activity.

| Data Type | Source | Granularity |
|---|---|---|
| Price feeds (top 500 tokens) | CoinGecko, Binance API | 1min / 5min / 1hr / 1d |
| Protocol TVL | DeFiLlama API | Hourly |
| Gas prices per chain | Etherscan, Dune | Per-block |
| Funding rates | Coinglass, Binance Futures | Hourly |
| Whale movements | On-chain analysis, Arkham | Real-time |

**Layer 3: Outcome-Labeled Decision Data (The Gold)**

The highest-value training data. Decisions paired with context and measured outcomes:

```
{
  "context": {
    "portfolio": { "ETH": 5.2, "USDC": 3400, "AAVE_DEPOSIT": 2000 },
    "market": { "ETH_price": 2150, "24h_change": "-3.2%", "gas": "12gwei" },
    "signals": { "TVL_trend": "declining", "funding_rate": "negative" }
  },
  "reasoning": "ETH showing weakness with declining TVL and negative funding.
                Reduce exposure by 20%, move to stables, increase Aave deposit
                for yield while waiting for reversal signals.",
  "decision": "Swap 1 ETH → USDC, deposit 2000 USDC into Aave",
  "outcome": {
    "pnl_24h": "+1.8%",
    "pnl_7d": "+4.2%",
    "vs_hold": "+3.1%",
    "quality": "good"
  }
}
```

**Layer 4: DeFi Knowledge Corpus (The Understanding)**

Protocol documentation, audit reports (Trail of Bits, OpenZeppelin, Spearbit), governance proposals and discussions, exploit post-mortems (Rekt.news), and DeFi educational content. ~50–100M tokens of cleaned text.

**Layer 5: Reasoning Traces (The Secret Weapon)**

Chain-of-thought reasoning for DeFi decisions generated by Claude/GPT-4 analyzing historical scenarios, then paired with actual outcomes. This teaches the fine-tuned model *how to think* about DeFi, not just what to do.

#### Fine-Tuning Approach

**Phase 1 — RAG + Local Model (Launch, Week 1):**
No fine-tuning needed. Index the DeFi knowledge corpus into a vector store. At decision time, retrieve relevant context (similar historical scenarios, protocol docs, current market data) and let the base Llama/Mistral model reason with that context. Gets 70% of the way with zero training cost. Ship this first.

**Phase 2 — QLoRA Fine-Tune (Month 2–3):**
Once 10K–50K reasoning traces with outcome labels are collected. Fine-tune Llama 3.1 8B or Mistral 7B using QLoRA on a single A100 or 4090. Cost: ~$50–200 per training run on RunPod or Lambda. The model learns DeFi-specific reasoning patterns, not just trading rules.

**Phase 3 — Continuous Learning via Marketplace Data (Month 4+):**
Every agent decision on the platform generates new training data. Weekly retraining cycles on the latest outcomes. A/B test model versions against each other. Specialized models emerge: one for yield farming, one for active trading, one for conservative management. **The marketplace becomes the data flywheel — more agents and subscribers generate more labeled decisions, which improve the base model, which attracts more users.**

#### The Data Moat

After 6 months of marketplace operation, ChainClaw will have millions of labeled DeFi decisions with full context, reasoning traces, and verified outcomes. This dataset is:

- **Impossible to replicate** without running a similar marketplace at scale
- **Continuously improving** as the platform grows
- **Multi-strategy** covering yield, trading, LP management, and risk scenarios
- **Cross-market** spanning bull, bear, and sideways conditions

This is the long-term defensible moat. The open-source framework can be forked. The fine-tuned model trained on proprietary marketplace data cannot.

---

## Skills Ecosystem

Skills are modular capabilities that agent creators use to build their agents. ChainClaw ships with core skills and provides an SDK for creating custom ones.

### Core Skills (Built-in)

| Skill | Description |
|---|---|
| **swap** | Token swaps via DEX aggregators (1inch, Paraswap). Best route and price discovery. |
| **bridge** | Cross-chain transfers via Li.Fi / Socket. Automatic route optimization. |
| **lend** | Supply/withdraw on Aave, Compound, Morpho. Rate comparison across protocols. |
| **lp-manage** | Uniswap v3/v4 concentrated liquidity — create, rebalance, withdraw positions. |
| **portfolio** | Real-time portfolio view across all connected chains and wallets. |
| **alert** | Price alerts, whale movement alerts, position monitoring with custom triggers. |
| **risk-check** | Token/contract risk scoring. Honeypot detection, rug analysis. |
| **dca** | Dollar-cost averaging with configurable schedule, amount, and gas optimization. |
| **backtest** | Replay strategy against historical on-chain data with standardized reporting. |

### Custom Skills (Creator SDK)

Agent creators extend ChainClaw with proprietary skills:

- Custom signal processing (Twitter sentiment, on-chain whale tracking, funding rate analysis)
- Proprietary trading logic (mean reversion, momentum breakout, statistical arbitrage)
- Protocol-specific integrations (Pendle yield tokenization, GMX perps, Eigenlayer restaking)
- Data connectors (private alpha feeds, Telegram group parsing, news sentiment APIs)

### Skill Security

Learning from OpenClaw's security challenges (400+ malicious skills found on ClawHub):

- **Sandboxed execution** — skills run in isolated containers with no access outside declared scope
- **Permission declarations** — skills must declare which chains, contracts, and token amounts they access
- **Code signing** — verified publisher identities for all registry skills
- **Automated security scanning** — static analysis for exploit patterns, dependency audits
- **Community audit bounties** — rewards for finding vulnerabilities in published skills

---

## Competitive Advantages

### 1. Agent Marketplace with Verified Performance

No other DeFi agent platform offers a marketplace where strategies are published, subscribed to, and verified with on-chain track records. This creates network effects — more creators attract more subscribers, which generates more data, which improves the platform for everyone.

### 2. Zero-Cost Local Execution

Running on open-source LLMs via Ollama eliminates the API cost barrier that makes autonomous agents impractical. Users self-host for free. This is the same local-first advantage that drove OpenClaw's adoption — no subscription, just your own compute.

### 3. AI Agents > Copy-Trading

Agents adapt strategies to each subscriber's context (portfolio size, risk tolerance, current positions). Copy-trading just mirrors trades. This is a fundamentally better product for the end user.

### 4. The Data Flywheel

Every marketplace transaction generates labeled training data. Over time, ChainClaw's fine-tuned DeFi model improves from this proprietary dataset — creating a moat that open-source framework forks cannot replicate.

### 5. Self-Custody by Default

Unlike DeFAI protocols that require deposits, ChainClaw executes in the subscriber's own wallet. This reduces counterparty risk and aligns with crypto-native values.

### 6. Open Source + Security-First

The framework is open source for trust and community growth. But security is a launch feature, not a roadmap item — transaction simulation, sandboxed skills, hardware wallet support, and spending limits from Day 1.

---

## Go-to-Market Strategy

### Phase 1: Build in Public — The Agent (Weeks 1–4)

- Daily X/Twitter thread documenting development from Day 1
- Ship a working Telegram bot in Week 2 — balance check + swap using local Ollama model
- First demo video: DM the agent on Telegram, watch it execute a swap with a local LLM, zero API cost. This is the viral moment.
- Target crypto developer communities: DeFi Discord servers, Ethereum dev channels, Base ecosystem

### Phase 2: Open Source Launch — The Framework (Weeks 5–8)

- Open-source the repository with comprehensive documentation and 5-minute Docker setup
- Launch with 9 built-in skills and the creator SDK for custom skill development
- Publish on HackerNews, r/ethereum, r/defi
- GitHub stars goal: 10K in first week
- Seed the multi-LLM competition: deploy internal agents (Claude vs DeepSeek vs Llama) with real capital, publish weekly results on CT

### Phase 3: Marketplace Launch (Weeks 9–14)

- Launch the agent marketplace with 5–10 internally-built agents as initial inventory
- Performance leaderboards with verified on-chain track records
- Subscription billing (crypto-native — USDC payments)
- Creator onboarding program — invite 20–30 expert traders to build and publish agents
- Partner with DeFi protocols for co-marketing (Aave, Uniswap, Li.Fi) — ChainClaw drives TVL to their platforms

### Phase 4: Data Flywheel (Month 4+)

- Begin collecting labeled decision data from marketplace activity
- First fine-tuning run on the ChainClaw DeFi Model
- Release the fine-tuned model as open-source (the base model, not the training data)
- Launch premium backtesting infrastructure for creators
- Explore managed hosting partnerships (DigitalOcean, Hetzner 1-click deploy)

### Viral Mechanics at Each Phase

| Phase | Viral Mechanic |
|---|---|
| **Agent Launch** | "Open-source DeFi agent that runs free on local LLMs" — CT goes crazy for zero-cost narrative |
| **Framework Launch** | Creators post their custom agents: "I built an agent that farms yield across 5 chains while I sleep" |
| **Marketplace Launch** | Weekly leaderboards: "Top agent this month returned 23%" — recurring content loop |
| **Data Flywheel** | "ChainClaw DeFi Model beats GPT-4 on trading decisions at 1/100th cost" — benchmark moment |

### Distribution Channels

| Channel | Tactic | Why It Works |
|---|---|---|
| **Crypto Twitter** | Build-in-public thread, weekly LLM competition results, demo videos | CT is where DeFi users discover tools. Performance data gets engagement. |
| **GitHub** | Open source, great README, one-command setup | Stars = social proof. Contributors = evangelists. |
| **DeFi Protocols** | Partnership integrations, co-marketing | ChainClaw drives TVL to their platforms. |
| **Telegram Groups** | Direct presence in DeFi alpha groups | Users already live here. Zero friction to try. |
| **Alpha / Signal Groups** | Convert signal providers into agent creators | Existing distribution + monetization incentive. |

---

## Development Roadmap

| Timeline | Phase | Deliverables |
|---|---|---|
| **Weeks 1–2** | Foundation | Gateway + Telegram bot, chain adapters (Base + ETH), local wallet integration, Ollama + Llama setup, basic swap + balance skills |
| **Weeks 3–4** | Intelligence | LLM intent parser, RAG with DeFi knowledge corpus, transaction simulation via Tenderly, skill framework v1, basic guardrails |
| **Weeks 5–6** | DeFi Skills | Aave lend/borrow, Uniswap swap + LP management, cross-chain bridge (Li.Fi), yield comparison, portfolio dashboard, DCA automation |
| **Weeks 7–8** | Creator Tools | Agent builder SDK, backtesting engine against historical data, agent performance tracking + logging, multi-chain expansion (Arbitrum, Optimism) |
| **Weeks 9–10** | Marketplace v1 | Agent registry, subscription system (USDC billing), performance leaderboards, creator dashboard, 5–10 seed agents with real track records |
| **Weeks 11–12** | Public Launch | Open-source on GitHub, CT launch thread, HN + Reddit posts, protocol partnerships, creator onboarding program |
| **Month 4** | Fine-Tuning v1 | First QLoRA fine-tune on collected reasoning traces + outcome data. Release ChainClaw DeFi Model. |
| **Month 5–6** | Scale | Managed hosting option, premium backtesting infra, continuous model retraining from marketplace data, Solana chain support |

---

## Monetization Strategy

ChainClaw's core framework is free and open source. Revenue comes from the marketplace and ecosystem services.

### Revenue Streams

1. **Marketplace Commission (Primary)** — 15–20% of agent subscription fees. Creators set pricing (free, monthly sub, or performance fee). ChainClaw takes a cut of paid subscriptions. This scales directly with marketplace activity.

2. **Managed Hosting** — 1-click cloud deployment for creators who don't want to self-host. Security hardening, monitoring, automatic updates. $29–$99/month.

3. **Premium Backtesting** — Advanced historical replay infrastructure with tick-level data, multi-chain simulation, and detailed analytics. Free tier covers basic backtesting; paid tier for institutional-grade analysis.

4. **Featured Listings** — Promoted placement in marketplace rankings for agent creators who want more visibility. Similar to app store featured placements.

5. **Enterprise / DAO Tier** — Multi-agent deployment, role-based access, audit logging, compliance features, and dedicated support for institutional users.

### Unit Economics

| Metric | Assumption |
|---|---|
| Average agent subscription | $25/month |
| Platform take rate | 17.5% |
| Revenue per subscription | $4.38/month |
| Target: 1,000 active subscriptions (Month 6) | $4,375/month |
| Target: 10,000 active subscriptions (Month 12) | $43,750/month |
| + Managed hosting (200 creators × $49) | $9,800/month |
| **Month 12 target revenue** | **~$53,500/month** |

### Token Strategy

No token at launch. Ship the product, build genuine usage, then evaluate a governance token for marketplace curation, fee distribution, and creator incentives. Launching a token early would undermine credibility.

---

## Risk Analysis

| Risk | Impact | Mitigation |
|---|---|---|
| **Security breach / wallet drain** | Critical. One incident kills trust. | Simulation-first design, hardware wallet support, spending limits, sandboxed skills, security audit before launch. |
| **Bad agent performance hurts subscribers** | High. Users lose money, blame platform. | Mandatory backtesting, minimum track record before ranking, prominent risk warnings, subscriber-controlled guardrails and limits. |
| **Marketplace cold start** | High. No agents = no subscribers. | Seed with 5–10 internal agents (multi-LLM competition). Weekly performance content drives attention before marketplace has critical mass. |
| **Coinbase builds competing agent marketplace** | High. Coinbase has distribution. | Open-source + self-custody differentiates. Move fast. Coinbase's version would likely be custodial and centralized. |
| **Regulatory pressure on AI trading agents** | Medium-long term. | Agents are tools, not advisors. Compliance features built in (tx logging, audit trails). Self-hosted model puts liability on user, not platform. |
| **Prompt injection / adversarial attacks** | High. Malicious data could manipulate agent decisions. | Strict input sanitization, separate contexts for user input vs on-chain data, allowlisted interactions, reasoning trace auditing. |
| **LLM quality insufficient for trading** | Medium. Local models may underperform. | RAG bridges the gap at launch. Fine-tuning improves over time. Cloud LLM fallback always available. |
| **Creator fraud / fake performance** | Medium. Fake track records erode trust. | All performance verified on-chain. Mandatory real-capital track record. Community reporting. |

---

## Technical Stack

| Component | Technology |
|---|---|
| **Runtime** | Node.js / TypeScript |
| **LLM Engine** | Ollama (local: Llama 3.1, Mistral, DeepSeek) + optional cloud APIs (Claude, GPT-4) |
| **Fine-Tuning** | QLoRA on Llama/Mistral base, RunPod/Lambda for training compute |
| **RAG / Knowledge** | Vector store (ChromaDB / Qdrant), DeFi knowledge corpus |
| **Blockchain** | viem + wagmi (EVM), Coinbase AgentKit, ethers.js fallback |
| **Wallet** | Local encrypted keystore, Coinbase Agentic Wallets (x402), Ledger HID |
| **DeFi Aggregation** | 1inch API, Paraswap, Li.Fi (bridging), Aave SDK, Uniswap SDK |
| **Tx Simulation** | Tenderly Simulation API, Foundry Anvil (local fork) |
| **Safety / Analytics** | GoPlus Security API, custom on-chain risk engine, community threat feeds |
| **Backtesting** | Custom replay engine, Dune Analytics (historical data), DeFiLlama (TVL/price feeds) |
| **Messaging** | Telegram Bot API (primary), Discord.js |
| **Data / Memory** | SQLite (local), Redis (caching), vector store for conversation memory |
| **Marketplace** | USDC payments on Base, on-chain track record verification, creator/subscriber dashboards |
| **Deployment** | Docker Compose, Nix flake, one-line install script |

---

## Next Steps

1. **Secure naming, domain, GitHub org, and social handles** — learn from Steinberger's rebrand chaos
2. **Set up the clean repo** — public from commit one, port working agent code into it
3. **Get the agent running with Ollama + Llama locally** — prove the zero-cost thesis from Day 1
4. **Post "Day 1" on X** — start the build-in-public thread
5. **Ship first demo video within 14 days** — DM the agent on Telegram, watch it swap using a local LLM
6. **Deploy 5 internal agents with different LLMs** — start the multi-LLM competition and begin collecting training data
7. **Begin scraping and indexing the DeFi knowledge corpus** — protocol docs, audit reports, Rekt.news, DeFiLlama data
8. **Commit to 90-day singular focus** — this project only

---

> *"The marketplace becomes the moat. Every agent decision is training data. Every subscriber is a signal. The model gets smarter, the agents get better, and the flywheel compounds."*
