# Contributing

This document outlines the guidelines for contributing to OpenPulsechain. The project is open-source under the MIT License, and contributions of all kinds are welcome.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Contribution Areas](#contribution-areas)
- [Code Standards](#code-standards)
- [Pull Request Process](#pull-request-process)
- [Security](#security)
- [Reporting Issues](#reporting-issues)

---

## Development Setup

```bash
git clone https://github.com/openpulsechain/openpulsechain.git
cd openpulsechain
```

Refer to the README in each module for specific setup instructions:

- [`/frontend`](./frontend) -- React web dashboard
- [`/api`](./api) -- REST API (FastAPI)
- [`/token_safety`](./token_safety) -- Safety API (FastAPI)
- [`/indexers`](./indexers) -- Python data collection scripts (23 cron jobs)
- [`/live_cache`](./live_cache) -- Real-time token pool cache
- [`/mcp-server`](./mcp-server) -- MCP server for AI assistants
- [`/extension`](./extension) -- Chrome browser extension
- [`/dune`](./dune) -- SQL queries for Dune Analytics

---

## Project Structure

```
openpulsechain/
├── frontend/          React + TypeScript dashboard (16 pages)
├── api/               REST API — FastAPI (tokens, prices, pairs)
├── token_safety/      Safety API — FastAPI (scores, radar, deployer, smart money, leagues)
├── indexers/          23 Python cron jobs (on-chain data collection)
├── live_cache/        Real-time DexScreener pool cache
├── mcp-server/        MCP server for AI assistants (20 tools)
├── extension/         Chrome browser extension (safety, portfolio, tx guard)
├── dune/              SQL queries for Dune Analytics (bridge)
├── docs/              Documentation
├── LICENSE            MIT License
├── CONTRIBUTING.md    This file
├── SECURITY.md        Security policy
└── README.md          Project overview
```

---

## Contribution Areas

### Frontend Dashboard

Location: `/frontend`

- Built with React, TypeScript, Vite, and TailwindCSS.
- Components must be responsive and accessible.
- Minimize external dependencies. Justify any new dependency in the pull request description.
- Do not embed API keys or secrets in client-side code.

### REST API / Safety API

Location: `/api` and `/token_safety`

- Written in Python 3.10+ with FastAPI.
- All endpoints must be read-only (GET only).
- Rate limiting required on all public endpoints.
- Cron endpoints must be protected by `CRON_SECRET`.

### Data Indexers

Location: `/indexers`

- Written in Python 3.10+.
- Must use the public PulseChain RPC (`rpc.pulsechain.com`) by default. Do not hardcode paid RPC endpoints.
- Store results in PostgreSQL via the database client.
- Respect API rate limits. Implement exponential backoff where appropriate.

### Chrome Extension

Location: `/extension`

- Built with React, TypeScript, Vite, and TailwindCSS (same stack as frontend).
- Manifest V3 (Chrome Web Store requirement).
- All API calls go through the Safety API — no direct database access from the extension.

### MCP Server

Location: `/mcp-server`

- TypeScript with the MCP SDK.
- Each tool must have clear input/output schemas.
- All data fetched from the Safety API and REST API.

### Dune SQL Queries

Location: `/dune`

- Each query must be a standalone `.sql` file.
- Include a header comment block with: query description, target chain, relevant contract addresses.

### Documentation

- Written in English.
- Use clear, concise language.
- Follow the existing document structure and formatting conventions.

---

## Code Standards

- **No secrets in source code.** All credentials, API keys, and sensitive configuration must be loaded from environment variables.
- **One concern per pull request.** Keep PRs focused on a single feature, fix, or improvement.
- **Write tests** for new functionality when the testing infrastructure is in place.
- **Follow existing conventions.** Match the code style, naming patterns, and directory structure of the module you are contributing to.
- **No unnecessary abstractions.** Prefer straightforward implementations over premature generalization.

---

## Pull Request Process

1. Fork the repository and create a feature branch from `main`.
2. Implement your changes following the code standards above.
3. Ensure your code runs without errors locally.
4. Write a clear PR description explaining what was changed and why.
5. Reference any related issues using `Closes #<issue-number>` or `Relates to #<issue-number>`.
6. Submit the pull request for review.

---

## Security

If you discover a security vulnerability, do not open a public issue. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

---

## Reporting Issues

When opening an issue, include:

- A clear and descriptive title.
- Steps to reproduce the problem.
- Expected behavior versus actual behavior.
- Relevant logs, error messages, or screenshots.
- Environment details (OS, Node.js version, Python version, browser).

---

## License

By submitting a contribution, you agree that your work will be licensed under the [MIT License](LICENSE).
