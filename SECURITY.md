# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ChainClaw, please report it responsibly.

**Email:** security@chainclaw.xyz

**Do NOT** open a public GitHub issue for security vulnerabilities.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **48 hours** — We will acknowledge your report
- **7 days** — We will provide an initial assessment
- **30 days** — We aim to release a fix for confirmed vulnerabilities

## Scope

### In Scope

- Wallet encryption and key management (`@chainclaw/wallet`)
- Transaction safety pipeline (`@chainclaw/pipeline`)
- Authentication and authorization in channels (`@chainclaw/gateway`)
- Skill sandboxing and input validation (`@chainclaw/skills-sdk`)
- Dependency vulnerabilities in production packages

### Out of Scope

- Issues in third-party services (RPC providers, DEX aggregators, LLM APIs)
- Vulnerabilities requiring physical access to the host machine
- Social engineering attacks
- Denial of service attacks against self-hosted instances

## Security Features

ChainClaw includes multiple layers of security by design:

- **AES-256-GCM** wallet encryption with key derivation (scrypt)
- **Transaction simulation** via Tenderly before execution
- **5-layer safety pipeline** — validation, simulation, risk scoring, rate limiting, confirmation
- **Token risk checks** via GoPlus security API
- **Skill sandboxing** — community skills run with restricted permissions
- **No custody** — private keys never leave the host machine

## Known Limitations

- **Recovery phrase delivery via chat:** When a wallet is created through a chat channel (Telegram, Discord), the recovery mnemonic is sent as a message. Chat platforms may log messages server-side. Users are warned to delete the message immediately and save the phrase offline. A more secure delivery mechanism is planned.

## Self-Custody Disclaimer

ChainClaw is self-hosted software. You are solely responsible for:

- Securing your host environment
- Managing your wallet passwords and private keys
- Reviewing transactions before confirming
- Keeping your instance and dependencies up to date

**ChainClaw is provided as-is. Use at your own risk.**
