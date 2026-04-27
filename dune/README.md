# Dune Queries

SQL queries for PulseChain bridge analytics on [Dune Analytics](https://dune.com).

---

## Context

PulseChain is not natively indexed by Dune Analytics as of March 2026. All queries in this directory target **Ethereum mainnet** using **decoded OmniBridge contract events** to analyze PulseChain bridge activity.

### Data Source

Queries use the decoded event tables from the PulseChain OmniBridge contract on Ethereum:

| Table | Event | Meaning |
|-------|-------|---------|
| `pulsechain_ethereum.pulsechainomnibridge_evt_tokensbridginginitiated` | `TokensBridgingInitiated` | Deposit: tokens locked on Ethereum, minted on PulseChain |
| `pulsechain_ethereum.pulsechainomnibridge_evt_tokensbridged` | `TokensBridged` | Withdrawal: tokens released on Ethereum, burned on PulseChain |

**Contract:** OmniBridge Proxy [`0x1715a3e4a142d8b698131108995174f37aeba10d`](https://etherscan.io/address/0x1715a3e4a142d8b698131108995174f37aeba10d)

### Methodology

- **Deposits** (Ethereum to PulseChain): `TokensBridgingInitiated` events. `sender` = bridge initiator, `token` = ERC20 address, `value` = raw amount.
- **Withdrawals** (PulseChain to Ethereum): `TokensBridged` events. `recipient` = receiver, `token` = ERC20 address, `value` = raw amount.
- **User identification**: `evt_tx_from` (transaction originator) for accurate attribution, including WETH Router bridging.
- **USD valuation**: `tokens.erc20` for decimals + `prices.day` for daily price, joined on token contract address.
- **Price sanitization**: Per-transfer USD cap of $50M to filter tokens with manipulated/inflated prices from low-liquidity sources.
- **Partition pruning**: All queries filter on `evt_block_date >= DATE '2023-05-10'` (PulseChain launch) for optimal performance.

---

## Available Queries

| File | Description | Output | Dune ID | Credits |
|------|-------------|--------|---------|---------|
| `bridge_kpi_counters.sql` | Key metrics: total volume, txs, unique users, 30D volume, avg tx size | Single row of KPIs | [6776541](https://dune.com/queries/6776541) | ~1 |
| `bridge_daily_flows.sql` | Daily deposit/withdrawal volume with cumulative net flow | Time series | [6776544](https://dune.com/queries/6776544) | ~1 |
| `bridge_monthly_flows.sql` | Monthly volume with 3-month moving average | Time series | [6776545](https://dune.com/queries/6776545) | ~1 |
| `bridge_token_breakdown.sql` | Bridge volume by token, ranked by total volume | Table (top 50) | [6776546](https://dune.com/queries/6776546) | ~2 |
| `bridge_transfer_size_distribution.sql` | Transfer count and volume by size bracket | 5 buckets | [6776548](https://dune.com/queries/6776548) | ~3 |
| `bridge_weekly_active_users.sql` | Weekly unique bridgers over time | Time series | [6776549](https://dune.com/queries/6776549) | ~0.1 |
| `bridge_top_users.sql` | Top 100 bridge users by total USD volume | Table | [6776550](https://dune.com/queries/6776550) | ~2 |
| `bridge_tvl_validation.sql` | TVL by token (current prices) — cross-validates against DefiLlama | Table (top 50) | [6776740](https://dune.com/queries/6776740) | ~0.1 |
| `bridge_volume_vs_tvl.sql` | Volume vs TVL summary with ratio — explains cross-platform differences | Single row | [6776741](https://dune.com/queries/6776741) | ~3 |

**Total: ~13 credits for all 9 queries** (Dune starter: 2,500 credits/month)

> **Why do different platforms show different numbers?** See [`docs/bridge-data-comparison.md`](../docs/bridge-data-comparison.md) for a detailed cross-platform comparison explaining why our $8.18B volume differs from DefiLlama's $72M TVL.

---

## Usage

1. Sign in to [dune.com](https://dune.com) (starter plan is sufficient).
2. Create a new query.
3. Copy the contents of the desired `.sql` file into the query editor.
4. Execute. Queries use DuneSQL syntax targeting decoded `pulsechain_ethereum.*` tables, `tokens.erc20`, and `prices.day`.
5. Add visualizations (counter widgets for KPIs, bar charts for flows, tables for breakdowns).

---

## Query Header Format

Each `.sql` file includes a comment header with:

```sql
-- Title:       <Query title>
-- Description: <What this query measures>
-- Chain:       <Target blockchain>
-- Contracts:   <Relevant contract addresses>
-- Output:      <Expected columns>
-- Author:      <Contributor handle>
-- Dune ID:     <Dune query ID>
-- Source:      <Data source tables>
```

---

## Version History

### v5 (March 2026) — Cross-Platform Validation
- Added TVL validation query: computes estimated TVL from OmniBridge events ($64.2M vs DefiLlama's $72M — ~11% delta, fully explained)
- Added Volume vs TVL summary query: shows volume-to-TVL ratio of 127.5x
- Published cross-platform comparison study ([`docs/bridge-data-comparison.md`](../docs/bridge-data-comparison.md))
- 7 new visualizations: TVL counter, Volume-to-TVL ratio, deposits/withdrawals counters, TVL pie chart, TVL token table, unique tokens counter

### v4 (March 2026) — Decoded Tables Migration
- Migrated all queries from `erc20_ethereum.evt_Transfer` to decoded OmniBridge event tables
- 2-3x more credit-efficient (~10 credits total vs ~25 previously)
- More accurate: uses actual bridge events instead of inferring from ERC20 transfers
- Added 4 new queries: KPI counters, monthly flows, transfer size distribution, weekly active users
- Uses `evt_tx_from` for accurate user attribution (captures WETH Router users)
- Includes `messageId` field for future cross-chain message tracking

### v3 (March 2026) — Price Sanitization
- Added `evt_block_date` partition pruning
- Switched to `tokens.erc20` for decimals + `prices.day` for pricing
- Added $50M per-transfer cap to filter manipulated prices
- Excluded bridge contracts from top users ranking

---

## Limitations

- These queries only capture **Ethereum-side** bridge activity. PulseChain-native transactions are not visible until PulseChain is natively indexed on Dune.
- Native ETH bridging is captured when the WETH Router wraps ETH and calls the OmniBridge (the `TokensBridgingInitiated` event fires on the OmniBridge contract).
- Tokens without entries in `prices.day` will show a USD value of 0.
- Transfers exceeding $50M USD per transaction are capped to exclude tokens with manipulated prices.
- The `0x000...000` address is excluded from top users.

---

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for query submission guidelines.
