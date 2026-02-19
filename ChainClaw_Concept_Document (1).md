# ⛓️ ChainClaw

### *The OpenClaw for Your On-Chain Life*

---

**Concept Document** · Version 1.0 · February 2026
**Confidential** · Prepared by Gopi

---

## Executive Summary

**ChainClaw** is a self-hosted, open-source, crypto-native AI agent that gives users an always-on DeFi operations assistant they can message from Telegram, Discord, or WhatsApp. It combines the viral local-first agent model pioneered by OpenClaw with deep on-chain execution capabilities, enabling natural language commands to trigger complex multi-step DeFi workflows across multiple chains.

The crypto AI agent landscape is fragmented: general-purpose agents like OpenClaw lack deep DeFi integration, while existing DeFi bots lack intelligence and natural language interfaces. Coinbase just shipped Agentic Wallets (Feb 2026), providing the financial rails for autonomous agents, but nobody has built the open-source, self-custody agent that stitches it all together with OpenClaw-level UX.

ChainClaw fills this gap. It is the missing layer between frontier LLMs and on-chain execution — a purpose-built DeFi operations agent with safety-first design, featuring built-in contract risk scoring and transaction simulation.

| Pillar | Description |
|---|---|
| **Self-Custody** | Your keys stay on your hardware. No deposits into protocol contracts. Hardware wallet support. |
| **Natural Language** | DM your agent complex multi-step instructions in plain English. It plans, simulates, and executes. |
| **Safety-First** | Transaction simulation, spending limits, contract allowlists, and built-in risk scoring before execution. |
| **Extensible** | Community-built Skills marketplace for DeFi strategies, alerts, tax tracking, and more. |

---

## Market Opportunity

### The Convergence Moment

Three forces are converging in February 2026 that create a unique window of opportunity:

- **OpenClaw proved the model.** A self-hosted AI agent that acts on your behalf, accessible via messaging apps, reached 200K+ GitHub stars in weeks. The market has validated that people want agents that execute, not just advise.
- **Coinbase shipped the financial rails.** Agentic Wallets and the x402 protocol (50M+ transactions) provide plug-and-play wallet infrastructure for AI agents. The plumbing is ready.
- **DeFi still lacks an intelligent interface.** Despite billions in TVL, interacting with DeFi remains a multi-tab, multi-click, multi-chain nightmare. Natural language execution is the missing UX layer.

### The Gap in the Market

| Category | Examples | What's Missing |
|---|---|---|
| **General AI Agents** | OpenClaw, custom bots | No deep DeFi execution, no chain adapters, no wallet management |
| **Trading Bots** | 3Commas, CryptoHero, Autonio | Rule-based, no natural language, no multi-step workflows, no self-custody |
| **DeFAI Protocols** | Fetch.ai, Virtuals, ai16z | Token-centric, speculative, not practical daily-use agents |
| **MCP Servers** | defi-trading-mcp | Basic tools, no persistent agent, no memory, no safety layer |
| **Wallet Infra** | Coinbase AgentKit / Awal | Rails only — needs an agent built on top |

**ChainClaw occupies the empty center of this map** — a purpose-built, self-hosted, open-source DeFi agent that combines intelligent natural language processing with deep on-chain execution and safety-first design.

### Target Users

- **DeFi power users** who manage positions across 3+ chains and are tired of the multi-tab workflow
- **Crypto-native developers** who want an extensible agent framework to build on
- **DAOs and treasury managers** who need programmable, auditable on-chain operations
- **OpenClaw users** looking for a specialized DeFi agent that goes deeper than general-purpose skills

---

## Product Vision

ChainClaw is a 24/7 DeFi operations agent that lives on your hardware and takes orders via your messaging apps. You tell it what you want in plain English. It plans, simulates, and executes multi-step on-chain workflows while keeping your keys under your control.

### Core Interaction Model

The primary interface is conversational. Users DM ChainClaw on Telegram, Discord, WhatsApp, or Signal — the same surfaces they already use for crypto alpha.

> **Example Commands**
>
> *"Bridge 5 ETH to Arbitrum, swap half to USDC, deposit into Aave, alert me if lending rate drops below 3%"*
>
> *"Find the best yield for my stables across Base, Optimism, and Mainnet. Move funds there. Rebalance weekly."*
>
> *"Monitor my Uniswap LP. If impermanent loss exceeds 5%, pull liquidity and notify me."*
>
> *"DCA $200/week into ETH every Monday at 6am UTC from my USDC on Base."*
>
> *"Is this token safe? Check 0x3f5... on Base before I ape."*

### Architecture Overview

ChainClaw runs as a persistent Node.js service on user-controlled hardware (Mac Mini, Linux server, VPS, or Docker container). It connects to messaging platforms via the Gateway layer and routes requests through an intelligent Agent Runtime.

```
┌──────────────────────────────────────────────────────────────────┐
│                      ChainClaw Gateway                           │
│              (Node.js · Runs on your hardware)                   │
├──────────────────┬──────────────────┬────────────────────────────┤
│    CHANNELS      │  AGENT RUNTIME   │     ON-CHAIN LAYER         │
│    ────────      │  ─────────────   │     ──────────────         │
│                  │                  │                            │
│    Telegram      │  LLM Brain       │  Chain Adapters            │
│    Discord       │  (Claude / GPT / │  (EVM, Solana, Base,       │
│    WhatsApp      │   Local Ollama)  │   Arb, Optimism...)        │
│    Signal        │       ↕          │       ↕                    │
│    WebChat       │  Intent Parser   │  Tx Simulator              │
│                  │       ↕          │  (Tenderly / Anvil fork)   │
│                  │  Skill Engine    │       ↕                    │
│                  │       ↕          │  Safety Layer              │
│                  │  Memory Store    │  (Risk engine + guardrails) │
│                  │                  │       ↕                    │
│                  │                  │  Wallet Manager            │
│                  │                  │  (Local / Awal / Ledger /  │
│                  │                  │   Safe multisig)           │
└──────────────────┴──────────────────┴────────────────────────────┘
```

### Key Components

#### 1. Gateway + Messaging Layer

Modeled after OpenClaw's proven gateway architecture. The gateway handles authentication, rate limiting, message routing, and channel management. Initial launch targets Telegram as the primary channel (crypto's native messaging surface) with Discord as secondary.

#### 2. Agent Runtime + LLM Integration

The Agent Runtime connects to frontier LLMs (Claude, GPT-4, DeepSeek) or local models via Ollama. It maintains persistent memory, conversation context, and user preferences across sessions. The Intent Parser translates natural language into structured transaction plans.

#### 3. Chain Adapters

Modular chain adapters handle RPC connections, transaction construction, gas estimation, and nonce management. Launch chains: **Ethereum Mainnet, Base, Arbitrum, Optimism.** Expansion to Solana and additional L2s post-launch.

#### 4. Wallet Layer

Flexible wallet integration supporting multiple custody models:

- **Local private keys** — encrypted on-device, never transmitted
- **Coinbase Agentic Wallets** — via AgentKit/x402 for managed custody with guardrails
- **Hardware wallets** — Ledger/Trezor for high-value operations requiring physical confirmation
- **Safe multisig** — for DAO/team treasury operations

#### 5. Safety Engine (The Unfair Advantage)

Every transaction passes through a multi-layer safety pipeline before execution:

1. **Intent Validation** — LLM confirms the parsed intent matches user's request
2. **Contract Risk Scoring** — built-in analytics engine flags suspicious contracts, honeypots, and rug risks using on-chain pattern analysis
3. **Transaction Simulation** — dry-run on forked state (Tenderly/Anvil) to preview outcomes
4. **Guardrails Check** — spending limits, slippage tolerance, contract allowlists
5. **Confirmation Gate** — optional human approval for transactions above configured threshold

**The built-in safety engine is ChainClaw's moat.** No other open-source DeFi agent ships with integrated contract risk scoring, transaction simulation, and multi-layer guardrails out of the box. Safety isn't a bolted-on feature — it's embedded in the transaction pipeline.

---

## Skills Ecosystem

Skills are modular, community-built capabilities that extend ChainClaw's functionality. Like OpenClaw's ClawHub, but purpose-built for DeFi operations. This is the viral multiplier — the mechanism that turns users into builders and evangelists.

### Launch Skills (Built-in)

| Skill | Description |
|---|---|
| **swap** | Token swaps via DEX aggregators (1inch, Paraswap). Finds best route and price. |
| **bridge** | Cross-chain transfers via Li.Fi / Socket. Automatic route optimization. |
| **lend** | Supply/withdraw on Aave, Compound. Rate comparison across protocols. |
| **portfolio** | Real-time portfolio dashboard across all connected chains and wallets. |
| **alert** | Price alerts, whale movement alerts, position monitoring with custom triggers. |
| **risk-check** | Token/contract risk scoring using on-chain analysis. Honeypot detection, rug analysis. |
| **dca** | Dollar-cost averaging with configurable schedule, amount, and gas optimization. |

### Community Skills (Post-Launch)

The Skills Registry allows community developers to publish, share, and monetize their own skills:

- **yield-optimizer** — auto-rotates between lending protocols for highest APY
- **lp-manager** — concentrated liquidity management for Uniswap v3/v4 positions
- **tax-tracker** — logs every transaction for tax reporting (Koinly/CoinTracker export)
- **whale-watcher** — monitors large wallet movements and alerts on significant activity
- **gas-optimizer** — batches and times transactions for lowest gas cost
- **portfolio-rebalancer** — maintains target asset allocations with configurable drift tolerance
- **airdrop-hunter** — executes qualifying interactions for potential airdrop eligibility
- **governance-voter** — monitors DAO proposals and votes based on configured preferences

### Skill Security

Learning from OpenClaw's security challenges (400+ malicious skills found on ClawHub, Cisco found data exfiltration in third-party skills), ChainClaw implements a rigorous skill security model:

- **Sandboxed execution** — skills run in isolated containers with no access outside their declared scope
- **Permission declarations** — skills must declare which chains, contracts, and token amounts they access
- **Code signing** — verified publisher identities for all registry skills
- **Automated security scanning** — static analysis for known exploit patterns, dependency audits
- **Community audit bounties** — reward security researchers for finding vulnerabilities in published skills

---

## Competitive Advantages

### 1. Built-in Safety Engine

ChainClaw ships with an integrated risk analytics layer that provides real-time contract risk scoring, token safety analysis, and wallet reputation checks directly in the transaction pipeline. This combines on-chain pattern analysis, honeypot detection, and community-sourced threat intelligence. No other open-source DeFi agent includes this depth of safety infrastructure out of the box.

### 2. Purpose-Built for DeFi

General agents like OpenClaw can technically do DeFi through bolted-on skills, but a specialized agent will always outperform on depth of integration, safety, and UX. ChainClaw understands DeFi primitives natively — slippage, impermanent loss, gas optimization, MEV protection, cross-chain bridging. This domain knowledge is embedded in the intent parser, not layered on top.

### 3. Self-Custody by Default

Unlike DeFAI protocols that require depositing into their smart contracts, ChainClaw keeps keys on the user's hardware. This dramatically reduces counterparty risk and aligns with the ethos of crypto-native users who chose DeFi specifically to avoid custodial intermediaries.

### 4. Open Source + Local-First

Following the OpenClaw playbook that proved this model works. Open source creates trust, community contribution, and viral growth. Local-first execution provides privacy and eliminates subscription lock-in. Users bring their own LLM API key or run local models.

### 5. Security-First Design

OpenClaw's biggest vulnerability became our biggest opportunity. With 30,000+ exposed instances and widespread credential leaks, the market is primed for a DeFi agent that takes security seriously from day one. Transaction simulation, sandboxed skills, and hardware wallet support are not roadmap items — they're launch features.

---

## Go-to-Market Strategy

### The OpenClaw Viral Playbook, Adapted

OpenClaw grew from 0 to 200K+ GitHub stars in weeks. The playbook is well-documented and repeatable. ChainClaw adapts it with crypto-native distribution.

#### Phase 1: Build in Public (Weeks 1–4)

- Daily X/Twitter thread documenting development. Share architecture decisions, show real terminal output, be transparent about challenges.
- Ship a working Telegram bot in Week 2 that can check balances and execute a basic swap. The first demo video is the most important marketing asset.
- Target crypto developer communities: DeFi Discord servers, Ethereum dev channels, Base ecosystem.

#### Phase 2: Developer Launch (Weeks 5–8)

- Open-source the repository with comprehensive documentation and a 5-minute Docker setup.
- Launch the Skills Registry with 7 built-in skills and an SDK for community contributions.
- Publish on HackerNews, r/ethereum, r/defi. Reach out to crypto YouTubers and DeFi protocol marketing teams.
- GitHub stars goal: 10K in first week. The "show don't tell" demo of an agent executing a multi-step DeFi workflow while you watch on Telegram is inherently viral.

#### Phase 3: Ecosystem Growth (Weeks 9–12)

- Partner with DeFi protocols for co-marketing (Aave, Uniswap, Li.Fi) — ChainClaw drives TVL to their platforms.
- Launch community skill-building hackathon with bounties for best DeFi skills.
- Pursue Coinbase developer program partnership — ChainClaw is a showcase for Agentic Wallets.
- Explore DigitalOcean/Hetzner 1-click deploy partnerships (as OpenClaw did).

### Distribution Channels

| Channel | Tactic | Why It Works |
|---|---|---|
| **Crypto Twitter** | Build-in-public thread, demo videos, memes | CT is where DeFi users discover tools. Viral demos spread fast. |
| **GitHub** | Open source, great README, easy setup | Stars = social proof. Contributors = evangelists. |
| **DeFi Protocols** | Partnership integrations, co-marketing | ChainClaw drives TVL to their platforms. |
| **Telegram Groups** | Direct presence in DeFi alpha groups | Users already live here. Zero friction to try. |

---

## Development Roadmap

A 12-week sprint from zero to public launch. The guiding principle is: ship fast, ship ugly, iterate with community feedback.

| Timeline | Phase | Deliverables |
|---|---|---|
| **Weeks 1–2** | Foundation | Gateway + Telegram bot, chain adapters (Base + ETH), local wallet integration, basic balance check + swap skill |
| **Weeks 3–4** | Intelligence | LLM integration (Claude API + Ollama), NL intent parser, transaction simulation via Tenderly, skill framework v1 |
| **Weeks 5–6** | DeFi Skills | Aave lend/borrow, Uniswap swap + LP, cross-chain bridge (Li.Fi), yield comparison, portfolio dashboard, DCA automation |
| **Weeks 7–8** | Safety + Edge | Risk analytics engine integration, guardrails system, tx logging for tax/audit, multi-chain expansion (Arbitrum, Optimism), Coinbase Agentic Wallet support |
| **Weeks 9–10** | Viral Infra | Skills Registry + SDK, documentation site, Docker 1-click setup, onboarding wizard, demo videos |
| **Weeks 11–12** | Public Launch | Open-source on GitHub, CT launch thread, HN + Reddit posts, protocol partnership outreach, community hackathon announcement |

---

## Monetization Strategy

ChainClaw launches as a free, open-source project. Revenue comes from ecosystem services, not from gating the core product. This mirrors the proven open-source business model (Red Hat, Docker, Hashicorp).

### Revenue Streams

1. **Managed Hosting** — 1-click cloud deployment with security hardening, monitoring, and automatic updates. $29–$99/month. (Similar to DigitalOcean's $24/mo OpenClaw deploy.)
2. **Premium Safety API** — Advanced risk scoring, real-time threat intelligence, MEV protection. Free tier for basic checks; paid tier for institutional-grade analytics.
3. **Skills Marketplace Commission** — Revenue share on paid community skills (10–20% take rate). Skill developers monetize their strategies; ChainClaw takes a cut.
4. **Enterprise / DAO Tier** — Multi-agent deployment, role-based access, audit logging, compliance features, and dedicated support for institutional users.

### Token Strategy

No token at launch. Ship the product first, build genuine usage, then evaluate a governance token for Skills Registry curation and protocol fee distribution. Launching a token early would signal "DeFAI cash grab" and undermine credibility with the developer community.

---

## Risk Analysis

| Risk | Impact | Mitigation |
|---|---|---|
| **Security breach / wallet drain** | Critical. One public incident could kill adoption. | Simulation-first design, hardware wallet support, spending limits, sandboxed skills, security audit before launch. |
| **Coinbase builds the agent too** | High. Coinbase has distribution and trust. | Open-source + self-custody differentiates. Coinbase's agent would likely be custodial. Being first matters. |
| **OpenClaw adds DeFi skills** | Medium. General skills won't match purpose-built depth. | Specialization wins. MetaMask beat general browser extensions. ChainClaw's safety layer is hard to replicate as a skill. |
| **Regulatory pressure on AI agents** | Medium-long term. Self-custody model may face scrutiny. | Compliance features built in (tx logging, audit trails). Geographic restrictions if needed. Self-hosted model puts liability on user. |
| **Prompt injection attacks** | High. Malicious on-chain data could manipulate agent. | Strict input sanitization, separate contexts for user input vs on-chain data, allowlisted interactions only. |
| **Founder bandwidth** | High. Multiple concurrent projects dilute focus. | 90-day commitment to ChainClaw as sole project. Community contributors from Week 4. Clear milestones. |

---

## Technical Stack

| Component | Technology |
|---|---|
| **Runtime** | Node.js / TypeScript (matches OpenClaw ecosystem for potential interop) |
| **LLM Integration** | Anthropic Claude API, OpenAI GPT-4, Ollama (local), DeepSeek |
| **Blockchain** | viem + wagmi (EVM), Coinbase AgentKit, ethers.js fallback |
| **Wallet** | Local encrypted keystore, Coinbase Agentic Wallets (x402), Ledger HID |
| **DeFi Aggregation** | 1inch API, Paraswap, Li.Fi (bridging), Aave SDK, Uniswap SDK |
| **Tx Simulation** | Tenderly Simulation API, Foundry Anvil (local fork) |
| **Safety / Analytics** | GoPlus Security API, custom on-chain risk engine, community threat feeds |
| **Messaging** | Telegram Bot API (primary), Discord.js, WhatsApp Business API |
| **Data / Memory** | SQLite (local), Redis (caching), vector store for conversation memory |
| **Deployment** | Docker Compose, Nix flake, one-line install script |

---

## Next Steps

The window is open. OpenClaw validated the model. Coinbase shipped the rails. The crypto community is hungry for an intelligent DeFi agent. The question is not whether someone will build the "OpenClaw for DeFi" — it's whether we build it first.

1. **Secure naming, domain, GitHub org, and social handles** (learn from Steinberger's rebrand chaos)
2. **Begin build-in-public thread on X:** "Building the OpenClaw for DeFi. Day 1."
3. **Ship first working Telegram bot** (balance check + swap) within 14 days
4. **Commit to 90-day singular focus** — this project only
5. **Record and post the first demo video** the moment the swap skill works

---

> *"The best time to build the OpenClaw for DeFi was last week. The second best time is today."*
