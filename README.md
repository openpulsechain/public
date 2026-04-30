# OpenPulsechain

[![smithery badge](https://smithery.ai/badge/openpulsechain/mcp-server)](https://smithery.ai/servers/openpulsechain/mcp-server)

Open-source analytics platform for [PulseChain](https://pulsechain.com).

**Live:** [openpulsechain.com](https://www.openpulsechain.com) · **Dune:** [Bridge Analytics](https://dune.com/openpulsechain/pulsechain-bridge-analytics)

> Not affiliated with PulseChain, PulseX, or any related entity. Data is for informational purposes only — not financial advice.

---

## What's included

| Module | Description |
|--------|-------------|
| **Dashboard** | 16-page web app: Overview, DEX, Tokens, Bridge, Whales, Intelligence, Safety, Alerts, Smart Money, Leagues, Heart Law, Wallet Profiles, Token Safety, MCP/API, Privacy |
| **Token Safety API** | FastAPI with 25 public endpoints: safety scores, scam radar, deployer reputation, smart money, wallet analysis, leagues, bridge stats, funding trees |
| **REST API** | FastAPI with 12 endpoints: tokens, prices, history, pairs, market overview, safety proxies |
| **MCP Server** | Model Context Protocol server with 20 tools for AI assistants |
| **Chrome Extension** | Token safety scores, transaction guard, portfolio tracker, scam alerts |
| **Indexers** | 23 Python cron jobs collecting on-chain data every 5-15 min |
| **Dune** | 9 SQL queries + 20 visualizations for bridge analytics (Ethereum-side) |

## Features

### Analytics Dashboard
- **Overview** — PLS price, chain TVL, gas estimates, token prices table
- **DEX Analytics** — PulseX daily volume, liquidity, top 30 trading pairs
- **Token Explorer** — 2500+ browsable tokens with pagination, search, price history charts
- **Bridge Monitor** — OmniBridge + Hyperlane: daily flows, cumulative net flow, whale alerts, TVL by token
- **Whale Tracker** — Top holders, cross-token analysis, funding clusters, connection graph
- **Leagues** — Holder tier rankings for PLS, PLSX, HEX, INC, updated every 6 hours
- **Heart Law** — Educational AMM price simulator for PulseX pools

### Security & Intelligence
- **Token Safety Scanner** — Composite score (0-100, grade A-F) based on honeypot detection, contract analysis, LP health, holder concentration, token age
- **Scam Radar** — Automated alerts for LP removals and whale dumps, scanning every 30 minutes
- **Deployer Reputation** — Serial rugger detection: analyzes deployer's token history, dead token ratio
- **Smart Money Tracker** — Large swaps on PulseX, top wallets by volume, auto-refresh every 60s
- **Wallet Profiler** — Token holdings + swap activity for any address
- **Market Intelligence** — AI-analyzed Twitter sentiment, risk conclusions, action detection

### Chrome Extension
- **Transaction Guard** — Intercepts swaps on PulseX, 9mm, Piteas and warns about risky tokens before signing
- **Safety Scanner** — Browse all analyzed tokens with safety scores, grades, and sub-score details
- **Portfolio Tracker** — Track wallet balances with sparkline charts
- **Scam Alerts** — Real-time notifications for critical scam detections

## Data

- **2,500+ tokens** discovered from PulseX Subgraph
- **463K+ price records** (daily, since May 2023)
- **231K+ bridge transfers** (OmniBridge + Hyperlane)
- **100% sovereign** token prices from PulseX `derivedUSD` — no CoinGecko dependency for PulseChain tokens

## Architecture

```
PulseX Subgraph ──┐
DefiLlama API ────┤
PulseChain RPC ───┤──> Python Indexers ──> PostgreSQL (RLS)
Blockscout API ───┘                            │
                                     ┌─────────┼──────────┐
                                     │         │          │
                                React SPA  REST API   Safety API
                                     │                    │
                                Dashboard         safety.openpulsechain.com
                              16 pages + MCP      25 public endpoints
                                     │
                             Chrome Extension
```

## Project Structure

```
/
  frontend/              # React dashboard (16 pages)
  api/                   # REST API FastAPI (tokens, prices, pairs)
  token_safety/          # Safety API FastAPI (scores, scam radar, deployer, smart money, leagues)
  indexers/              # 23 Python cron jobs (on-chain data collection)
  live_cache/            # Real-time token pool cache (DexScreener)
  mcp-server/            # MCP server for AI assistants (20 tools)
  extension/             # Chrome browser extension
  dune/                  # SQL queries for Dune Analytics
  docs/                  # Documentation
```

## Getting started

```bash
git clone https://github.com/openpulsechain/openpulsechain.git
cd openpulsechain
```

| Module | Setup |
|--------|-------|
| `frontend/` | `npm install && npm run dev` |
| `indexers/` | `pip install -r requirements.txt` + `.env` config |
| `api/` | `pip install -r requirements.txt && uvicorn main:app` |
| `token_safety/` | `pip install -r requirements.txt && uvicorn main:app` |
| `mcp-server/` | `npm install && npm run build` |
| `extension/` | `npm install && npm run build` → load `dist/` in Chrome |

## Data sources

| Data | Source | Access |
|------|--------|--------|
| Token prices (PulseChain) | PulseX Subgraph `derivedUSD` | Public |
| TVL, DEX volume | DefiLlama API | Public |
| Gas price, blocks | PulseChain RPC | Public |
| Bridge events (ETH-side) | Dune Analytics | Public (2500 credits/mo) |
| Bridge events (PLS-side) | PulseChain OmniBridge Subgraph | Public |
| Hyperlane transfers | Hyperlane Explorer API | Public |
| Contract analysis | PulseChain Scan API (Blockscout v2) | Public |
| Honeypot detection | FeeChecker contract (on-chain simulation) | On-chain |
| Token logos | PulseX CDN, Piteas GitHub, DexScreener | Public |

## License

[MIT](LICENSE)
