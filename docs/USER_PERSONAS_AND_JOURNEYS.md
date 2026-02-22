# ChainClaw User Personas & Journeys

## Overview

ChainClaw is a self-hosted, open-source DeFi operations agent that users interact with through **Telegram**, **Discord**, or **Web Chat**. It provides 14 built-in skills across 5 chains (Ethereum, Base, Arbitrum, Optimism, Solana), an autonomous agent marketplace, and a data pipeline for continuous strategy improvement.

This document defines five user personas spanning the spectrum from crypto-curious beginner to agent developer, and maps their journeys through the product.

---

## Capability Tiers

ChainClaw's features unlock progressively based on which API keys and services the operator configures. Users on a hosted instance inherit the operator's tier.

| Tier | Required Config | Unlocked Features |
|------|----------------|-------------------|
| **Minimal** | `WALLET_PASSWORD` + RPCs + channel token | balance, portfolio, alert, risk_check, history, marketplace (browse/leaderboard) |
| **Active DeFi** | + `1INCH_API_KEY` | swap execution, bridge, lend (Aave V3), DCA execution |
| **Full NL** | + `LLM_PROVIDER` + API key | Natural language intent parsing, workflow (multi-step chains), conversational memory |
| **Power User** | + `TENDERLY_API_KEY` | Transaction simulation before every trade, full safety pipeline |
| **Agent Operator** | + `DATA_PIPELINE_ENABLED` | agent start/stop, backtest, marketplace publish, outcome labeling, training data export |

---

## Personas

### 1. Maya — The Crypto-Curious Beginner

| | |
|---|---|
| **Background** | 28-year-old marketing professional. Holds ETH on Coinbase but has never interacted with DeFi directly. Joined a crypto Telegram group where someone shared a ChainClaw bot link. |
| **Tech Comfort** | 2/5 — Uses apps daily but has never self-hosted anything |
| **DeFi Experience** | Minimal — has bought crypto on centralized exchanges only |
| **Primary Channel** | Telegram (on someone else's hosted instance) |
| **Config Tier** | Minimal (she never touches `.env`) |

**Goals**
1. Check her token balances without connecting to unfamiliar websites
2. Verify whether a token her group is shilling is safe before buying
3. Set price alerts for tokens she's watching
4. Eventually try a small swap

**Pain Points**
1. Scared of losing funds to scams or honeypot tokens
2. Intimidated by DeFi interfaces with hex addresses and gas settings
3. Doesn't understand gas fees or chain differences
4. Wants clear, human-readable explanations — not raw transaction data

> "I just want to know if this token is safe before I buy it."

---

### 2. Marcus — The Active DeFi User

| | |
|---|---|
| **Background** | 34-year-old software engineer at a fintech company. Uses DeFi daily — swaps on Uniswap, manages Aave positions, bridges between L2s. Currently juggles multiple browser tabs and wallet extensions. |
| **Tech Comfort** | 4/5 — Comfortable with CLI, Docker, and APIs |
| **DeFi Experience** | Advanced — 3+ years of active DeFi usage |
| **Primary Channel** | Telegram (self-hosted), occasionally Discord |
| **Config Tier** | Active DeFi → graduates to Full NL → Power User |

**Goals**
1. Execute DeFi operations from Telegram without switching between apps
2. Set up automated weekly DCA into ETH on Base
3. Chain multi-step operations: "Bridge to Arbitrum, swap to USDC, deposit into Aave"
4. Export transaction history for tax season

**Pain Points**
1. Context-switching between 5+ tabs and wallet extensions
2. Missing optimal gas windows while switching apps
3. No unified view of his cross-chain portfolio
4. Manually tracking DCA purchases is tedious and error-prone

> "I want to do everything I currently do across 5 browser tabs from a single Telegram chat."

---

### 3. Priya — The Portfolio Manager & Operator

| | |
|---|---|
| **Background** | 31-year-old quant at a crypto fund. Manages a $500K portfolio across multiple chains. Wants to automate routine operations while maintaining full oversight. Also operates the ChainClaw instance for her team. |
| **Tech Comfort** | 5/5 — Deploys Docker in production, writes scripts, manages infrastructure |
| **DeFi Experience** | Expert — professional-level understanding of liquidation mechanics, Sharpe ratios, risk management |
| **Primary Channel** | Web Chat (embedded in internal dashboard), Telegram for mobile alerts |
| **Config Tier** | Power User / Agent Operator (full stack) |

**Goals**
1. Simulate every transaction before execution via Tenderly
2. Subscribe to marketplace agents and evaluate them by verified backtest metrics
3. Review reasoning traces for every agent trade decision
4. Maintain a full audit trail for compliance

**Pain Points**
1. Manual rebalancing across chains is error-prone at scale
2. Cannot verify agent strategy quality before committing capital
3. Needs immutable records of every trade and its rationale
4. Key security is paramount — private keys must stay encrypted at rest

> "I need to see the simulation results and reasoning trace before any trade touches real funds."

---

### 4. Dev — The Agent Creator

| | |
|---|---|
| **Background** | 27-year-old full-stack developer and part-time DeFi enthusiast. Has built trading bots in Python before. Wants to monetize a momentum-trading strategy through ChainClaw's marketplace. |
| **Tech Comfort** | 5/5 — TypeScript fluent, open-source contributor |
| **DeFi Experience** | Advanced — builds on top of DeFi protocols |
| **Primary Channel** | Web Chat during development, Telegram for monitoring deployed agents |
| **Config Tier** | Agent Operator (full stack + data pipeline) |

**Goals**
1. Build a custom trading agent using the `AgentDefinition` SDK
2. Backtest it against historical data with Sharpe/drawdown/alpha metrics
3. Publish it to the marketplace with performance-fee pricing
4. Build and share a custom skill using the skills-sdk

**Pain Points**
1. Existing bot frameworks lack a marketplace for strategy monetization
2. No standardized backtesting framework with professional-grade metrics
3. Wants verified on-chain track records to prove strategy quality to subscribers
4. Needs a data pipeline for continuous model improvement

> "I want to publish my strategy and earn performance fees without ever touching anyone else's funds."

---

### 5. Dao — The DAO Treasury Manager

| | |
|---|---|
| **Background** | 35-year-old operations lead at a DeFi protocol DAO. Manages a $2M treasury across Ethereum, Base, and Arbitrum. Needs programmable, auditable operations for the multisig. |
| **Tech Comfort** | 3/5 — Uses tools but doesn't build them |
| **DeFi Experience** | Intermediate — understands protocols but focuses on governance and operations |
| **Primary Channel** | Discord (DAO's primary communication), Telegram for personal alerts |
| **Config Tier** | Power User |

**Goals**
1. Get a unified cross-chain view of the DAO treasury
2. Run risk reports on tokens before governance votes approve interactions
3. Set up DCA to dollar-cost average from USDC treasury into ETH
4. Export transaction history in CSV for quarterly audits

**Pain Points**
1. No single tool gives a cross-chain treasury view with USD valuations
2. Manual CSV exports for quarterly reports are painful and error-prone
3. Needs every operation to be auditable by other DAO members
4. Confirmation dialogs must respect the async nature of DAO governance discussions

> "Our treasury operations must be automated but every transaction needs to be auditable."

---

## Detailed User Journeys

### Journey 1: Maya (Beginner)

#### Discovery & Onboarding

Someone in Maya's Telegram group shares the bot link. She taps it and sends `/start`. The bot detects she has no wallet and shows the setup wizard:

```
Welcome to ChainClaw!

Let's get you started:
1. Create a wallet: /wallet create my-wallet
2. Once created, check balances: /balance

Type /help to see all available commands.
```

She runs `/wallet create my-wallet`. The bot returns her address and recovery phrase with a warning: *"Save this recovery phrase — it will NOT be shown again."* She screenshots it (not ideal, but common).

**First success:** `/balance` shows "ETH: 0.0000" across chains — the bot works.

#### Core Usage Loop

| Frequency | Action | Skill |
|-----------|--------|-------|
| Daily | Check ETH price movement via alerts | `alert` |
| Weekly | Check balances after buying on Coinbase and sending to wallet | `balance` |
| As needed | Verify tokens her group is discussing | `risk_check` |

Typical interaction:
```
Maya: Is this token safe? 0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE
Bot:  Risk Analysis for 0x3f5...6f0bE (Ethereum)
      Risk Level: HIGH
      - Honeypot risk detected
      - Owner can modify transfer fees
      - Top 10 holders control 89% of supply
      Recommendation: DO NOT interact with this token.
```

#### Feature Progression

| Week | New Feature | Trigger |
|------|------------|---------|
| 1 | `balance`, `risk_check` | Onboarding |
| 2 | `portfolio` | Wants to see USD values, not just token amounts |
| 3 | `alert` | "Tell me when ETH drops below $2000" |
| 4 | Tries `swap` | Group member shows a swap in action — if the instance has `1INCH_API_KEY`, she gets a quote + confirmation dialog; if not, quote-only |
| 6+ | Browses `marketplace` | Curious about automated agents after watching other group members |

#### Moments of Delight

- Risk check saves her from a honeypot — the explicit "DO NOT interact" warning builds trust
- Alert notification arrives on Telegram when ETH hits her target price
- Portfolio shows all chains in one view with USD values — no need for external trackers

#### Moments of Friction

- Recovery phrase shown exactly once during wallet creation — causes anxiety
- Swap returns quote-only if the instance operator hasn't set `1INCH_API_KEY` — unclear why she can't actually trade
- "Natural language processing is not configured" shown if operator didn't set up LLM — confusing for a non-technical user
- Chain IDs (1, 8453, 42161) shown instead of names (Ethereum, Base, Arbitrum) in some responses

---

### Journey 2: Marcus (Active DeFi User)

#### Discovery & Onboarding

Marcus finds ChainClaw on GitHub while browsing DeFi tooling. He clones the repo and runs `docker compose up`. Edits `.env`:

```
TELEGRAM_BOT_TOKEN=...
WALLET_PASSWORD=my-secure-password-123
1INCH_API_KEY=...
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
```

Sends `/start` to his bot — sees the full welcome with 14 skills loaded. Imports his existing wallet via `/wallet import 0xPrivateKey trading-wallet` (the bot auto-deletes the message containing the private key for security).

**First success:** "Swap 0.1 ETH to USDC on Base" — gets a quote, confirms via inline button, sees the transaction hash.

#### Core Usage Loop

| Frequency | Action | Skill |
|-----------|--------|-------|
| Daily | "Show my portfolio" — cross-chain USD values | `portfolio` |
| 2-3x/week | "Swap X ETH to USDC on Base" | `swap` |
| Weekly | DCA auto-executes $100 ETH buy | `dca` |
| Monthly | "Export my transactions as CSV" | `history` |

Typical workflow interaction:
```
Marcus: Bridge 5 ETH to Arbitrum, swap half to USDC, deposit into Aave

Bot:    Workflow Started (3 steps)
        Step 1/3: bridge...
        Bridge Quote: 5 ETH (Ethereum) → ~4.998 ETH (Arbitrum)
        [Confirm? Yes / No]

Marcus: [Yes]

Bot:    Step 1 complete. Step 2/3: swap...
        Swap Quote: 2.5 ETH → ~4,618.07 USDC (Arbitrum)
        [Confirm? Yes / No]

Marcus: [Yes]

Bot:    Step 2 complete. Step 3/3: lend (supply)...
        Supply 4,618 USDC to Aave V3 on Arbitrum
        [Confirm? Yes / No]

Marcus: [Yes]

Bot:    Workflow Complete (3/3 steps)
        + Step 1 (bridge): done
        + Step 2 (swap): done
        + Step 3 (lend): done
```

#### Feature Progression

| Week | New Feature | Trigger |
|------|------------|---------|
| 1-2 | `swap`, `balance`, `portfolio`, `risk_check` | Core needs from day one |
| 3 | `bridge`, `lend` | Wants to move assets cross-chain and earn yield |
| 4 | `dca`, `alert` | Sets up recurring buys and price notifications |
| 5 | `workflow` | Tired of sending 3 separate commands for bridge→swap→lend |
| 6 | Adds `TENDERLY_API_KEY` | Wants simulation previews before every trade |
| 8 | `marketplace`, `agent` | Subscribes to a DCA agent, monitors its paper-trading performance |

#### Moments of Delight

- Workflow executes a 3-step bridge→swap→lend from one natural language sentence
- DCA runs automatically while he sleeps — checks status with "How is my DCA doing?"
- Tenderly simulation catches a bad swap route before funds are at risk
- CSV export of transaction history for tax filing — no manual spreadsheet work

#### Moments of Friction

- Ollama model is slow on first query (cold start)
- Swap fails when slippage exceeds tolerance — needs to adjust preferences
- DCA job silently skips when gas is exceptionally high — no skip notification
- Workflow stops at step 2 of 3 on failure — remaining steps must be re-run manually

---

### Journey 3: Priya (Portfolio Manager & Operator)

#### Discovery & Onboarding

Priya evaluates ChainClaw for her fund's operations. She deploys the full stack:

```
TELEGRAM_BOT_TOKEN=...
WEB_CHAT_ENABLED=true
WALLET_PASSWORD=...
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
1INCH_API_KEY=...
TENDERLY_API_KEY=...
TENDERLY_ACCOUNT=...
TENDERLY_PROJECT=...
DATA_PIPELINE_ENABLED=true
REASONING_ENRICHMENT_ENABLED=true
```

Deploys via Docker with health checks on port 9090. The `/health` and `/ready` endpoints integrate with her monitoring stack.

**First success:** Portfolio view shows all positions across 4 chains with USD values — replaces the spreadsheet she was maintaining manually.

#### Core Usage Loop

| Frequency | Action | Skill |
|-----------|--------|-------|
| Daily | Review portfolio across chains (WebChat) | `portfolio` |
| Daily | Check agent performance and reasoning traces | `agent` (status, trades, reasoning) |
| Weekly | Review marketplace leaderboard for new strategies | `marketplace` (leaderboard, detail) |
| Weekly | Export history for compliance records | `history` (JSON) |

Typical agent monitoring:
```
Priya: Show reasoning for agent-abc123

Bot:    Last 5 Reasoning Traces for agent-abc123

        2026-02-19 09:00 UTC
        Decision: BUY ETH ($100)
        Reasoning: "Weekly DCA trigger. ETH at $2,847 is below
        30-day moving average. Portfolio underweight on ETH
        relative to target allocation."

        2026-02-12 09:00 UTC
        Decision: HOLD
        Reasoning: "ETH at $3,102 is above target entry.
        Skipping this cycle per momentum filter."
```

#### Feature Progression

| Week | New Feature | Trigger |
|------|------------|---------|
| 1 | `portfolio`, `balance`, `risk_check`, `history` | Baseline visibility |
| 2 | `marketplace` (browse, leaderboard, detail) | Evaluating agents for the fund |
| 3 | `agent` (start in dry_run, status, trades, reasoning) | Paper-trading a marketplace agent |
| 4 | Enables data pipeline | Wants outcome labeling (1h/24h/7d PnL) on all agent trades |
| 5+ | `backtest` | Validates new strategies before subscribing |
| Ongoing | Reasoning enrichment | LLM generates structured chain-of-thought for every agent decision |

#### Moments of Delight

- Tenderly simulation shows exact balance changes before every trade — no surprises
- Marketplace leaderboard with Sharpe ratios and time-windowed rankings (7d/30d/90d) enables data-driven agent selection
- Reasoning traces provide full transparency — she can explain every agent decision to stakeholders
- Health check endpoint integrates cleanly with Grafana/Prometheus monitoring

#### Moments of Friction

- No web dashboard for historical performance visualization — everything is text-based through chat
- Data pipeline reasoning enrichment runs on 10-minute intervals — not real-time
- Marketplace agent detail shows backtest metrics but no equity curve visualization
- Agent operations in live mode require wallet access — coordinating with hardware wallet adds manual steps

---

### Journey 4: Dev (Agent Creator)

#### Discovery & Onboarding

Dev finds ChainClaw on GitHub. He clones the repo, runs `npm install`, and studies the sample DCA agent in `packages/agent-sdk/src/samples/dca-agent.ts` as his template.

**First success:** Backtests the sample DCA agent — gets a full performance report with Sharpe ratio, max drawdown, alpha vs benchmark.

#### Core Usage Loop

| Frequency | Action | Skill/Tool |
|-----------|--------|------------|
| Daily (dev phase) | Iterate on `AgentDefinition.strategy.evaluate()` logic | Agent SDK |
| Daily (dev phase) | Backtest strategy with different parameters | `backtest` |
| Weekly (live phase) | Monitor agent performance in dry_run mode | `agent` (status, trades) |
| Monthly | Review training data quality | Data pipeline export |

Typical development cycle:
```typescript
// 1. Define the agent
const myAgent: AgentDefinition = {
  name: "momentum-eth",
  version: "1.0.0",
  skills: ["swap"],
  riskParams: {
    maxPositionSizeUsd: 1000,
    maxDrawdownPercent: 20,
    maxDailyTradesCount: 3,
    allowedTokens: ["ETH", "USDC"],
    allowedChainIds: [8453],
  },
  strategy: {
    evaluationIntervalMs: 86400000, // daily
    evaluate: async (context) => {
      // Custom momentum logic using price feeds
      // Returns StrategyDecision[] with action, token, reasoning
    },
  },
};

// 2. Backtest: "Backtest momentum-eth on ETH over 6 months with $10k"
// 3. Review: total return, max drawdown, Sharpe, win rate, alpha
// 4. Paper trade: "Start momentum-eth agent for ETH in dry_run mode"
// 5. Publish: register factory + publish to marketplace
```

#### Feature Progression

| Week | New Feature | Trigger |
|------|------------|---------|
| 1 | Studies SDK types, creates first `AgentDefinition` | Getting started |
| 2 | `backtest` — iterates on strategy logic | Validating performance |
| 3 | `agent` in dry_run mode — monitors with status/trades/reasoning | Live paper trading |
| 4 | `marketplace` publish — registers agent with pricing model | Ready to monetize |
| 5+ | `skills-sdk` — builds a custom skill with `chainclaw-skill.json` manifest | Extending platform capabilities |
| Ongoing | Data pipeline — exports JSONL (Alpaca/ChatML format) for fine-tuning | Continuous improvement |

#### Moments of Delight

- `BacktestMetrics` immediately shows if strategy has positive alpha vs benchmark
- `createSampleDcaAgent()` provides a complete working template to fork and modify
- Marketplace shows subscriber count growing — validation that the strategy is valued
- Sandboxed skill execution (5-second timeout, output truncation) protects against bugs

#### Moments of Friction

- Only "dca" strategy sample available — no momentum/yield/LP templates to learn from
- Backtester uses daily ticks only — no intraday granularity
- Publishing requires code-level access to `agentRegistry.registerFactory()` — no CLI-based publish flow
- Training data export requires direct database access — no chat skill for triggering exports

---

### Journey 5: Dao (DAO Treasury Manager)

#### Discovery & Onboarding

A team member deploys ChainClaw for the DAO's Discord server. Dao accesses it through Discord slash commands and @mentions in the treasury channel.

**First success:** `/balance` shows the full treasury across Ethereum, Base, and Arbitrum in one message.

#### Core Usage Loop

| Frequency | Action | Skill |
|-----------|--------|-------|
| Daily | `/balance` in Discord treasury channel | `balance` |
| Weekly | "What's our portfolio value?" via @mention | `portfolio` |
| Before votes | "Check this contract 0x..." for governance due diligence | `risk_check` |
| Quarterly | "Export transactions as CSV" for audit | `history` |

Typical governance support:
```
Dao:  @ChainClaw check this contract 0xABC...123 on Arbitrum

Bot:  Risk Analysis for 0xABC...123 (Arbitrum)
      Risk Level: LOW
      - Contract verified on Arbiscan
      - No honeypot indicators
      - Owner cannot pause transfers
      - Top 10 holders: 34% (reasonable distribution)
      Recommendation: No major risks detected. Always DYOR.
```

#### Feature Progression

| Week | New Feature | Trigger |
|------|------------|---------|
| 1 | `balance`, `portfolio` via Discord slash commands | Treasury visibility |
| 2 | `risk_check` | Pre-vote due diligence on proposed token interactions |
| 3 | `history` (CSV export) | Quarterly audit preparation |
| 4 | `alert`, `dca` | Treasury management automation |
| Later | `workflow` | Cross-chain yield rotation for the treasury |

#### Moments of Delight

- Discord @mention NL allows asking questions directly in existing DAO channels — no app switching
- CSV history export saves hours of manual transaction reconciliation
- Risk reports provide concrete data to inform governance votes
- Cross-chain portfolio view replaces the manually maintained treasury spreadsheet

#### Moments of Friction

- Discord slash commands only cover 5 commands (start, help, wallet, balance, clear) — other skills require @mention natural language
- Confirmation dialog buttons in Discord have a 2-minute timeout — may expire during async governance discussion
- No role-based access control — every Discord user in the server has the same permissions
- No native multisig integration — operations against the Safe require external signing

---

## Cross-Persona Touchpoint Matrix

When each persona first engages with each feature:

| Feature | Maya | Marcus | Priya | Dev | Dao |
|---------|------|--------|-------|-----|-----|
| `/start` onboarding | Day 1 | Day 1 | Day 1 | Day 1 | Day 1 |
| `/wallet create` | Day 1 | Day 1 (import) | Day 1 | Day 1 | Day 1 |
| `balance` | Day 1 | Day 1 | Day 1 | Testing | Day 1 |
| `portfolio` | Week 2 | Week 1 | Day 1 | Testing | Week 1 |
| `risk_check` | Week 1 | As needed | As needed | Testing | Week 2 |
| `alert` | Week 3 | Week 4 | Week 2 | Testing | Week 4 |
| `swap` | Week 4 (if available) | Week 1 | As needed | Testing | Rare |
| `bridge` | — | Week 3 | Week 2 | Testing | Week 3 |
| `lend` | — | Week 3 | Week 2 | Testing | Week 3 |
| `dca` | — | Week 4 | Week 3 | Testing | Week 4 |
| `workflow` | — | Week 5 | Week 3 | Testing | Later |
| `history` | — | Week 6 (tax) | Weekly | Testing | Monthly (audit) |
| `backtest` | — | Week 8 | Week 5 | Week 2 | — |
| `agent` | — | Week 8 | Week 3 | Week 3 | — |
| `marketplace` | Browse only | Week 8 | Week 2 | Week 4 (publish) | — |
| Data pipeline | — | — | Week 4 | Ongoing | — |
| NL conversations | If available | Primary mode | Secondary | Development | @mention |
| Tenderly simulation | — | Week 6 | Always | Testing | Always |

---

## Feature Progression Model

```
Minimal                Active DeFi          Full NL              Power User          Agent Operator
(read-only)            (execution)          (intelligence)       (safety)            (autonomy)
─────────────────────────────────────────────────────────────────────────────────────────────────────

balance                + swap               + NL intent          + Tenderly sim      + agent start/stop
portfolio              + bridge               parsing            + full safety        + backtest
alert                  + lend              + workflow              pipeline           + marketplace publish
risk_check             + DCA execution       (multi-step)                            + data pipeline
history                                    + conversational                          + training export
marketplace (browse)                         memory

     │                      │                    │                     │                    │
     │                      │                    │                     │                    │
  Maya stays            Marcus starts        Marcus &              Priya &              Dev creates
  Dao starts            here                 Dao graduate          Dao operate          here
  here                                       here                  here
```

**What triggers each graduation:**

| Transition | Trigger | Config Change |
|-----------|---------|---------------|
| Minimal → Active DeFi | User wants to execute swaps, not just view quotes | Add `1INCH_API_KEY` |
| Active DeFi → Full NL | User is tired of slash commands, wants "bridge and swap and deposit" as one sentence | Add `LLM_PROVIDER` + API key |
| Full NL → Power User | User wants to preview trade outcomes before execution | Add `TENDERLY_API_KEY` |
| Power User → Agent Operator | User wants autonomous agents or to build/publish strategies | Add `DATA_PIPELINE_ENABLED=true` |

---

## Key Insights

### Top Delight Moments

1. **Risk check as safety net** — Maya's honeypot detection, Dao's governance due diligence. The explicit "DO NOT interact" / "No major risks detected" recommendations build trust.
2. **Cross-chain portfolio in one view** — Every persona values seeing all chains + USD values in a single message, replacing external portfolio trackers and spreadsheets.
3. **Workflow multi-step execution** — Marcus's "bridge, swap, deposit" in one sentence. Eliminates the primary pain of context-switching between apps.
4. **Confirmation UX** — Inline keyboard buttons (Telegram) and action buttons (Discord) give users a clear approval gate with 2-minute timeout. No accidental trades.
5. **Agent reasoning transparency** — Priya can see exactly why an agent made each trade decision. Builds confidence for allocating real capital.

### Top Friction Points

1. **Recovery phrase shown once** — `/wallet create` displays the recovery phrase exactly once with no way to retrieve it. High anxiety for beginners like Maya.
2. **Missing API key degradation** — Skills that require `1INCH_API_KEY` or `TENDERLY_API_KEY` return partial results (quote-only, no simulation) without clear guidance on what's missing or how to fix it.
3. **Chain IDs vs. human-readable names** — Responses sometimes show `8453` instead of `Base`. Non-technical users (Maya, Dao) find this confusing.
4. **Discord slash command coverage** — Only 5 slash commands registered (start, help, wallet, balance, clear). All other skills require @mention NL, which is less discoverable.
5. **No visual dashboards** — Agent performance, marketplace leaderboard, and portfolio history are all text-based. Professional users (Priya, Dao) expect charts and graphs for reporting.

---

## Test Coverage Map Against Personas

**Suite status:** 220 tests across 30 test files, 13 packages — all passing.

### Coverage by Persona Journey

#### Maya (Beginner) — Coverage: Partial

| Journey Step | Feature | Tests | Status |
|-------------|---------|-------|--------|
| Onboarding: `/start` wizard | Gateway command routing | 0 tests | **NOT COVERED** — `packages/gateway` has zero test files |
| Onboarding: `/wallet create` | WalletManager.generate | 9 tests (manager.test.ts) | Covered — wallet creation, import, persistence, default selection |
| Onboarding: Key encryption | AES-256-GCM crypto | 5 tests (crypto.test.ts) | Covered — encrypt/decrypt, wrong password, tampered data |
| Core: `/balance` | Balance skill execution | 0 tests | **NOT COVERED** — no skill-level execution tests for balance |
| Core: `risk_check` | GoPlus risk analysis | 7 tests (goplus.test.ts) | Covered — safe/honeypot/high-tax/whale detection, API errors |
| Core: `risk_check` | RiskEngine decisions | 10 tests (risk-engine.test.ts) | Covered — blocklist/allowlist, honeypot blocking, warning levels, report formatting |
| Core: `alert` | Alert creation/triggering | 0 tests | **NOT COVERED** — no tests for AlertEngine or alert skill |
| Core: `portfolio` | Portfolio skill execution | 0 tests | **NOT COVERED** — no tests for portfolio aggregation + USD pricing |
| Progression: `swap` (quote) | Swap skill execution | 0 tests | **NOT COVERED** — no tests for swap quoting/execution |
| Progression: `marketplace` browse | AgentRegistry.list/search | 12 tests (agent-registry.test.ts) | Covered — listing, search, category filter, pricing models |
| Safety: Confirmation dialogs | Gateway confirmation UX | 0 tests | **NOT COVERED** — no gateway tests |
| Safety: Rate limiting | Rate limiter | 0 tests | **NOT COVERED** — no gateway tests |

**Maya summary:** Her core safety features (risk_check, wallet crypto) are well-tested. Her primary entry point (Telegram `/start`, `/balance`, `/help`) and day-to-day skills (balance, alert, portfolio) have zero test coverage at the skill execution level.

---

#### Marcus (Active DeFi User) — Coverage: Partial

| Journey Step | Feature | Tests | Status |
|-------------|---------|-------|--------|
| Onboarding: `/wallet import` | WalletManager.importFromKey | 2 tests (manager.test.ts) | Covered — import + duplicate detection |
| Onboarding: Private key message deletion | Telegram-specific gateway handler | 0 tests | **NOT COVERED** |
| Core: `swap` execution | Swap skill + 1inch integration | 0 tests | **NOT COVERED** |
| Core: `portfolio` | Portfolio skill | 0 tests | **NOT COVERED** |
| Core: `dca` scheduling | DcaScheduler + DCA skill | 0 tests | **NOT COVERED** |
| Core: `history` export (CSV/JSON) | TransactionLog.formatHistory | 10 tests (txlog.test.ts) | Covered — create, retrieve, format, status updates, JSON storage |
| Progression: `bridge` | Bridge skill + Li.Fi integration | 0 tests | **NOT COVERED** |
| Progression: `lend` | Lend skill + Aave V3 interaction | 0 tests | **NOT COVERED** |
| Progression: `workflow` | Workflow skill (multi-step) | 0 tests | **NOT COVERED** |
| Safety: Guardrails | Per-tx/daily limits, cooldown | 6 tests (guardrails.test.ts) | Covered — limits, cooldown, custom limits, large tx confirmation |
| Safety: Tenderly simulation | TransactionSimulator | 10 tests (simulator.test.ts) | Covered — gas estimation, Tenderly API, fallback, preview formatting |
| Safety: MEV protection | Flashbots routing | 3 tests (mev.test.ts) | Covered — chain support, RPC URL |
| NL: Intent parsing | IntentParser | 6 tests (intent.test.ts) | Covered — balance/swap parsing, multi-step, conversational, errors |
| NL: Conversation memory | ConversationMemory + Preferences | 10 tests (memory.test.ts) | Covered — history, user isolation, LLM formatting, preferences |
| Progression: `marketplace` subscribe | SubscriptionManager | 12 tests (subscription-manager.test.ts) | Covered — subscribe, unsubscribe, agent start, options passthrough |

**Marcus summary:** His safety pipeline (guardrails, simulation, MEV) and marketplace interactions are well-tested. His core daily skills (swap, bridge, lend, DCA, workflow, portfolio) have zero test coverage at the skill execution level. The NL intent parsing path is covered.

---

#### Priya (Portfolio Manager) — Coverage: Good

| Journey Step | Feature | Tests | Status |
|-------------|---------|-------|--------|
| Setup: Config loading | Config validation + defaults | 5 tests (config.test.ts) | Covered — validation, defaults, caching |
| Setup: LLM provider | createLLMProvider factory | 6 tests (llm.test.ts) | Covered — Anthropic/OpenAI/Ollama creation, missing key errors |
| Core: `agent` status/trades | PerformanceTracker | 8 tests (performance-tracker.test.ts) | Covered — instance lifecycle, trade logging, metrics, reasoning traces |
| Core: `agent` reasoning | Reasoning traces in PerformanceTracker | 1 test (performance-tracker.test.ts) | Covered — log and retrieve reasoning |
| Core: `marketplace` leaderboard | LeaderboardService | 11 tests (leaderboard-service.test.ts) | Covered — ranking, category filter, formatting, live trade data, time windows |
| Core: `marketplace` detail | AgentRegistry.getAgent | 12 tests (agent-registry.test.ts) | Covered — publish, metadata, backtest metrics, pricing |
| Core: `backtest` | BacktestEngine | 3 tests (backtest-engine.test.ts) | Covered — stablecoin test, cached data, report formatting |
| Pipeline: Outcome labeling | OutcomeLabeler | 10 tests (outcome-labeler.test.ts) | Covered — buy/sell PnL, multi-window, idempotency, batch processing |
| Pipeline: Reasoning enrichment | ReasoningEnricher | 8 tests (reasoning-enricher.test.ts) | Covered — enrichment, skip duplicates, LLM context, token tracking |
| Pipeline: Risk analysis | RiskEngine + RiskCache | 22 tests (risk-engine + risk-cache + goplus) | Covered — full risk pipeline |
| Safety: Simulation | TransactionSimulator | 10 tests (simulator.test.ts) | Covered |
| Audit: Transaction log | TransactionLog | 10 tests (txlog.test.ts) | Covered |

**Priya summary:** Best coverage of all personas. Her core journey (agents, marketplace, backtesting, data pipeline, risk analysis, simulation) is comprehensively tested. The main gap is the gateway layer — WebChat serving and routing are untested.

---

#### Dev (Agent Creator) — Coverage: Good

| Journey Step | Feature | Tests | Status |
|-------------|---------|-------|--------|
| SDK: Agent definition | createSampleDcaAgent | 4 tests (sample-agent.test.ts) | Covered — creation, custom options, evaluate(), no-price handling |
| SDK: Risk validation | riskParametersSchema | 5 tests (validation.test.ts) | Covered — valid params, negative size, drawdown >100%, empty chains |
| SDK: Backtest validation | backtestConfigSchema | 3 tests (validation.test.ts) | Covered — valid config, endDate<startDate, negative capital |
| SDK: BacktestEngine | BacktestEngine.run | 3 tests (backtest-engine.test.ts) | Covered — stablecoin, cached data, report format |
| SDK: PerformanceTracker | Agent lifecycle + trades + metrics | 8 tests (performance-tracker.test.ts) | Covered |
| Marketplace: Publish | AgentRegistry.publish | 12 tests (agent-registry.test.ts) | Covered — factory registration, publish, update, unpublish, pricing |
| Marketplace: Subscriptions | SubscriptionManager | 12 tests (subscription-manager.test.ts) | Covered — full lifecycle |
| Skills-SDK: defineSkill | Manifest validation | 6 tests (create-skill.test.ts) | Covered — name matching, semver, permissions |
| Skills-SDK: SkillLoader | Filesystem loading | 6 tests (loader.test.ts) | Covered — missing dir, empty dir, invalid manifest, valid package, sandbox wrapping |
| Skills-SDK: Sandbox | Timeout + output limits | 6 tests (sandbox.test.ts) | Covered — timeout, truncation, error catching |
| Pipeline: Training export | TrainingDataExporter | 8 tests (training-data-exporter.test.ts) | Covered — joins, Alpaca/ChatML format, JSONL export, filters |
| Pipeline: Outcome labeling | OutcomeLabeler | 10 tests (outcome-labeler.test.ts) | Covered |
| Pipeline: Reasoning enrichment | ReasoningEnricher | 8 tests (reasoning-enricher.test.ts) | Covered |

**Dev summary:** Strongest coverage. The entire Agent SDK, skills-sdk, marketplace publish/subscribe, and data pipeline are thoroughly tested. Dev's full workflow — define agent, validate, backtest, run, publish, export training data — is covered end-to-end at the unit level.

---

#### Dao (DAO Treasury Manager) — Coverage: Weak

| Journey Step | Feature | Tests | Status |
|-------------|---------|-------|--------|
| Onboarding: Discord `/start` | Discord gateway + command registration | 0 tests | **NOT COVERED** |
| Onboarding: Discord slash commands | Discord command handler | 0 tests | **NOT COVERED** |
| Core: `/balance` via Discord | Balance skill + Discord integration | 0 tests | **NOT COVERED** |
| Core: `portfolio` via @mention | NL routing in Discord | 0 tests | **NOT COVERED** |
| Core: `risk_check` via @mention | RiskEngine (backend) | 10 tests (risk-engine.test.ts) | Backend covered — Discord delivery not covered |
| Core: `history` CSV export | TransactionLog | 10 tests (txlog.test.ts) | Backend covered — CSV formatting not covered |
| Core: `alert` | AlertEngine | 0 tests | **NOT COVERED** |
| Core: `dca` | DcaScheduler | 0 tests | **NOT COVERED** |
| Safety: Confirmation buttons | Discord button UX (2-min timeout) | 0 tests | **NOT COVERED** |
| Safety: Rate limiting | Per-user rate limiter | 0 tests | **NOT COVERED** |

**Dao summary:** Weakest coverage. The Discord gateway layer — which is Dao's entire entry point — has zero tests. Backend components (risk engine, transaction log) are tested, but none of the Discord-specific routing, slash command registration, @mention handling, or button-based confirmation flows are covered.

---

### Coverage Summary by Package

| Package | Tests | Persona Impact | Assessment |
|---------|-------|---------------|------------|
| `@chainclaw/core` | 5 | All (config) | Adequate |
| `@chainclaw/chains` | 6 | All (multi-chain) | Registry only — no adapter execution tests |
| `@chainclaw/wallet` | 14 | All (onboarding) | Strong |
| `@chainclaw/pipeline` | 58 | Marcus, Priya, Dao (safety) | Strong — risk, simulation, guardrails, tx log |
| `@chainclaw/skills` | 5 | All | **Weak** — registry only, zero skill execution tests |
| `@chainclaw/skills-sdk` | 18 | Dev | Strong |
| `@chainclaw/agent` | 22 | Marcus, Priya (NL) | Good — intent parsing, memory, LLM provider |
| `@chainclaw/agent-sdk` | 23 | Priya, Dev | Strong — backtest, performance, validation |
| `@chainclaw/gateway` | 37 | All | Router (25), formatter (7), rate-limiter (5) |
| `@chainclaw/marketplace` | 35 | Priya, Dev, Marcus | Strong |
| `@chainclaw/data-pipeline` | 34 | Priya, Dev | Strong |
| `@chainclaw/server` | 73 | All (operator) | Health endpoints (6), integration flows + persona journeys (67) |

---

### Critical Gaps by Priority

**P0 — Impacts all personas (every user touches these):**
1. **Gateway package (37 tests)** — Router (25), formatter (7), rate-limiter (5). Remaining gaps: Telegram/Discord/WebChat adapter integration, confirmation dialogs, `/start` onboarding wizard.
2. **Individual skill execution (0 tests)** — balance, portfolio, swap, bridge, lend, DCA, alert, workflow, risk_check (as a skill), history (as a skill). The SkillRegistry is tested, but no skill's `execute()` function is tested.

**P1 — Impacts specific personas heavily:**
3. **DCA scheduler (0 tests)** — Impacts Marcus (core loop) and Dao (treasury automation). No tests for job creation, scheduling, pause/resume, auto-execution.
4. **Alert engine (0 tests)** — Impacts Maya (core loop) and Dao. No tests for alert creation, price polling, trigger notification.
5. **Chain adapters (0 tests)** — No tests for EVM adapter (`getBalance`, `getTokenBalances`, `getGasPrice`) or Solana adapter. Impacts every persona that checks balances.

**P2 — Nice to have:**
6. **Server health endpoints (6 tests)** — Covered: /health, /ready, 404. Remaining gap: server boot wiring integration.
7. **AgentRunner (0 tests)** — The evaluation loop, risk enforcement, and knowledge source fetching for live agents. Impacts Priya and Dev.
