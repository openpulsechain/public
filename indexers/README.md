# Indexers

Lightweight Python scripts that collect on-chain and off-chain PulseChain data and store it in PostgreSQL.

---

## Architecture

```
PulseX Subgraph (V1 + V2)    ─┐
Bridge Subgraphs (ETH + PLS)  ─┤
Hyperlane Explorer API        ─┤
DefiLlama API (TVL, DEX)     ─┼──→  main.py  ──→  PostgreSQL
PulseChain RPC (gas, blocks)  ─┤     (cron)        (24 tables)
DexScreener API               ─┤
Blockscout API                ─┘
```

All 23 indexers run sequentially in a single cron execution every 15 minutes.

---

## Indexers

| # | Module | Source | Target Table | Description |
|---|--------|--------|-------------|-------------|
| 1 | `bridge_subgraph` | ETH + PLS subgraphs | `bridge_transfers` | Individual bridge transfers (deposits + withdrawals) |
| 2 | `bridge_aggregator` | `bridge_transfers` | `bridge_daily_stats`, `bridge_token_stats` | Pre-aggregated daily and per-token stats |
| 3 | `hyperlane_bridge` | Hyperlane Explorer | `hyperlane_transfers` | Cross-chain Hyperlane transfers (11 chains) |
| 4 | `hyperlane_aggregator` | `hyperlane_transfers` | `hyperlane_daily_stats`, `hyperlane_chain_stats` | Aggregated Hyperlane volumes |
| 5 | `network_tvl` | DefiLlama | `network_tvl_history` | PulseChain chain TVL (daily) |
| 6 | `network_dex_volume` | DefiLlama | `network_dex_volume` | PulseX DEX volume (daily) |
| 7 | `pulsex_defillama` | DefiLlama | `pulsex_daily_stats` | PulseX-specific stats from DefiLlama |
| 8 | `token_prices` | PulseX Subgraph | `token_prices` | Current prices for tracked tokens |
| 9 | `network_snapshot` | PulseChain RPC | `network_snapshots` | Block number, gas price, base fee |
| 10 | `pulsex_stats` | PulseX Subgraph | `pulsex_daily_stats` | PulseX V1+V2 daily volume and liquidity |
| 11 | `pulsex_pairs` | PulseX Subgraph | `pulsex_top_pairs` | Top trading pairs by volume |
| 12 | `token_discovery` | PulseX Subgraph | `pulsechain_tokens` | Discover new tokens from PulseX pools |
| 13 | `pulsex_tokenlist_sync` | PulseX token list | `pulsechain_tokens` | Sync official PulseX token metadata |
| 14 | `piteas_tokenlist_sync` | Piteas token list | `pulsechain_tokens` | Sync Piteas token metadata |
| 15 | `libertyswap_tokenlist_sync` | LibertySwap list | `pulsechain_tokens` | Sync LibertySwap token metadata |
| 16 | `pumptires_sync` | PumpTires list | `pulsechain_tokens` | Sync PumpTires token metadata |
| 17 | `token_history` | PulseX Subgraph | `token_price_history` | Daily price history for all tokens |
| 18 | `bridge_tvl` | Bridge contracts | `bridge_tvl` | Bridge TVL by token |
| 19 | `whale_tracker` | PulseX Subgraph | `whale_swaps` | Large swap detection |
| 20 | `token_holders` | Blockscout | `token_holders` | Top holder counts per token |
| 21 | `whale_clustering` | `whale_swaps` | `whale_clusters` | Cluster analysis of whale wallets |
| 22 | `token_monitoring` | Various | `token_monitoring` | Token health monitoring |
| 23 | `token_pools_live` | DexScreener | `token_pools_live` | Real-time pool data |

---

## Setup

```bash
cd indexers
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your database credentials
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Database project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Database service role key (NOT anon key) |

---

## Running

```bash
# Single run (local testing)
python main.py

# First run = backfill (~10-20 min for bridge transfers)
# Subsequent runs = incremental
```

---

## Deployment

1. Create a new project on your hosting platform
2. Connect the GitHub repo, set root directory to `indexers`
3. Add environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
4. The platform will auto-detect the Dockerfile
5. Cron schedule: `*/15 * * * *`

---

## Sync Strategy

- **Bridge subgraph**: Cursor-based pagination using `timestamp_gt`. Resumes from last synced timestamp.
- **Execution matching**: After syncing transfers, queries `executions` entity to update `pending → executed` status.
- **DefiLlama**: Incremental (only inserts data newer than last synced date).
- **Token lists**: Full sync — upserts all tokens from official lists.
- **Network snapshots**: Appends one record per run.
- **Aggregator**: Recomputes all daily and token stats from transfers via database stored procedures.

---

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for coding standards and submission guidelines.
