# @openpulsechain/mcp-server

[![smithery badge](https://smithery.ai/badge/openpulsechain/mcp-server)](https://smithery.ai/servers/openpulsechain/mcp-server)

MCP server that gives AI assistants (Claude, ChatGPT, Cursor, etc.) access to real-time PulseChain on-chain analytics.

**Standard**: 11 tools included, no auth, ready to use in 30 seconds.
**Pro**: 9 additional tools (AML, forensic, smart money, per-wallet data) unlocked with an API key.

## Quick Start (no API key)

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "openpulsechain": {
      "command": "npx",
      "args": ["-y", "@openpulsechain/mcp-server"]
    }
  }
}
```

### Claude Code

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "openpulsechain": {
      "command": "npx",
      "args": ["-y", "@openpulsechain/mcp-server"]
    }
  }
}
```

### Run locally

```bash
npx @openpulsechain/mcp-server
```

## Pro tier (9 extra tools)

To unlock Pro-tier tools, add your API key via the `OPENPULSECHAIN_API_KEY` env variable — no code change, just configuration:

```json
{
  "mcpServers": {
    "openpulsechain": {
      "command": "npx",
      "args": ["-y", "@openpulsechain/mcp-server"],
      "env": {
        "OPENPULSECHAIN_API_KEY": "sk-opk-..."
      }
    }
  }
}
```

Get a key at **https://openpulsechain.com/pricing**.

Once set, the server logs `starting in PRO mode` to stderr and all 20 tools become callable. Without a key, calling a Pro tool returns a clear `pro_tier_required` error — your AI assistant will know what to tell the user.

## Tools

### Included (11 tools, no API key)

| Tool | Description |
|------|-------------|
| `get_token_price` | Current price, 24h change, volume, market cap |
| `get_token_info` | Full token details: name, symbol, decimals, liquidity, holders |
| `get_token_history` | Historical price data (OHLCV) — limited to 30 days without API key |
| `get_top_tokens` | Top tokens sorted by volume or liquidity |
| `get_top_pairs` | Top PulseX DEX trading pairs |
| `get_market_overview` | Network overview: TVL, 24h volume, top gainers/losers |
| `get_token_safety` | Scam analysis: honeypot detection, buy/sell tax, ownership score (A-F) |
| `get_token_liquidity` | Detailed liquidity breakdown across all DEX pairs |
| `get_honeypots` | Recently detected honeypot tokens |
| `get_bridge_stats` | PulseChain bridge inflows/outflows, net flow (7 days) |
| `get_holder_leagues` | Aggregated holder distribution tiers for core tokens |

### 💎 Pro tier (9) — requires `OPENPULSECHAIN_API_KEY`

| Tool | Description |
|------|-------------|
| `check_address_risk` | AML check: OFAC sanctions, known exploits, phishing flags |
| `get_deployer_reputation` | Deployer track record: tokens deployed, dead ratio, rug patterns |
| `get_scam_alerts` | Real-time scam radar: honeypots, LP removals, whale dumps |
| `get_smart_money_feed` | Whale activity feed: large wallet movements |
| `get_recent_swaps` | Recent large swaps on PulseX DEX |
| `get_wallet_balances` | Token balances for any wallet |
| `get_wallet_swaps` | Swap history for any wallet |
| `get_funding_tree` | Trace funding sources (2-level depth, bridge/DEX interactions) |
| `get_holder_rank` | Wallet rank and tier across all tracked tokens |

## Resources

The server also provides a `pulsechain://tokens/core` resource with addresses for all core PulseChain tokens (WPLS, HEX, PLSX, INC, eHEX, DAI, USDC, USDT, WETH, WBTC) — available to both tiers.

## Example Conversations

> "What's the current price of HEX on PulseChain?"

Included tool `get_token_price` — works without API key.

> "Is this token safe? 0x1234..."

Included tool `get_token_safety` — honeypot detection, ownership, taxes, grade.

> "Show me whale activity in the last 24 hours"

Pro tool `get_smart_money_feed` — requires API key.

> "Where did the funds in this wallet come from?"

Pro tool `get_funding_tree` — requires API key.

> "Is this address sanctioned by OFAC?"

Pro tool `check_address_risk` — requires API key.

## Data Sources

All data comes from two backends:

- **api.openpulsechain.com** — Token prices, pairs, market overview
- **safety.openpulsechain.com** — Safety scores, alerts, smart money, leagues, tracing

Sourced from PulseX Subgraph, Blockscout Explorer, and on-chain RPC calls. No CoinGecko, no centralized aggregators.

## Security

- **Read-only** — no write operations, no wallet signing, no seed phrase access
- **Zero secrets in code** — the optional API key is read from environment only
- **Rate limited** — server-side (60–120 req/min per endpoint, stricter without API key)
- **Red Team audited** — zero sensitive data exposure, MIT license
- **Forwarding** — when an API key is present, it is sent as `Authorization: Bearer ...` to the backend and never cached

## License

MIT
