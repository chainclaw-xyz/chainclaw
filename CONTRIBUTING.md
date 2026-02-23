# Contributing to ChainClaw

Thank you for your interest in contributing to ChainClaw! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js >= 20.0.0
- npm >= 11

### Getting Started

```bash
# Fork and clone the repo
git clone https://github.com/<your-username>/chainclaw.git
cd chainclaw

# Install dependencies
npm install

# Copy environment config
cp .env.example .env
# Edit .env with your values (see .env.example for descriptions)

# Build all packages
npm run build

# Run tests
npm test
```

### Project Structure

ChainClaw is a monorepo managed with [Turborepo](https://turbo.build/) and npm workspaces:

```
packages/
  core/          # Configuration, types, shared utilities
  chains/        # Chain adapters (Ethereum, Base, Arbitrum, Optimism, Solana)
  wallet/        # Wallet management and signing
  pipeline/      # Transaction safety pipeline (simulation, risk checks)
  agent/         # LLM integration and conversational AI
  skills/        # Built-in DeFi skills (swap, bridge, lend, etc.)
  skills-sdk/    # SDK for building community skills
  agent-sdk/     # SDK for building autonomous agents
  marketplace/   # Skill and agent marketplace
  gateway/       # Channel adapters (Telegram, Discord, WebChat)
  data-pipeline/ # Analytics and data processing
  security/      # Security utilities and guardrails
apps/
  server/        # Main application entry point
```

### Common Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build all packages |
| `npm run dev` | Start in development mode |
| `npm test` | Run all tests |
| `npm run lint` | Lint all packages |
| `npm run clean` | Remove build artifacts |

### Running a Single Package's Tests

```bash
# Run tests for a specific package
npx turbo test --filter=@chainclaw/wallet
npx turbo test --filter=@chainclaw/skills
```

## Making Changes

### Workflow

1. **Fork** the repository
2. **Create a branch** from `main` (`git checkout -b feat/my-feature`)
3. **Make your changes** and add tests
4. **Run checks** locally:
   ```bash
   npm run build && npm run lint && npm test
   ```
5. **Create a changeset** if your change affects package versions:
   ```bash
   npx changeset
   ```
6. **Push** your branch and open a Pull Request

### Commit Conventions

Use clear, descriptive commit messages:

- `feat: add support for Polygon chain`
- `fix: correct slippage calculation in swap skill`
- `docs: update README with new skill examples`
- `test: add coverage for bridge timeout handling`
- `refactor: simplify wallet encryption flow`

### Code Style

- **TypeScript** — all source code is TypeScript with strict mode
- **ESM** — the project uses ES modules (`"type": "module"`)
- **ESLint** — run `npm run lint` before submitting
- **Zod** — use Zod schemas for runtime validation
- **viem** — use viem for all EVM interactions (not ethers.js)

### Building a Community Skill

The `@chainclaw/skills-sdk` package provides the interface for building custom skills:

```typescript
import { defineSkill } from "@chainclaw/skills-sdk";

export default defineSkill({
  name: "my-skill",
  description: "What the skill does",
  parameters: z.object({ /* Zod schema */ }),
  execute: async (params, ctx) => {
    // Skill logic here
  },
});
```

Place your skill in the configured `SKILLS_DIR` and it will be auto-discovered at startup.

## Pull Requests

- Keep PRs focused — one feature or fix per PR
- Include tests for new functionality
- Update documentation if you're changing user-facing behavior
- Fill out the PR template when opening your pull request

## Issue Labels

| Label | Description |
|-------|-------------|
| `bug` | Something isn't working |
| `feature` | New feature request |
| `good first issue` | Good for newcomers |
| `help wanted` | Extra attention needed |
| `chain` | Chain-specific (Ethereum, Base, etc.) |
| `skill` | Related to a DeFi skill |
| `security` | Security-related |

## Getting Help

- Open a [GitHub Discussion](https://github.com/chainclaw-xyz/chainclaw/discussions) for questions
- Check existing [issues](https://github.com/chainclaw-xyz/chainclaw/issues) before filing a new one
- For security issues, see [SECURITY.md](SECURITY.md)
