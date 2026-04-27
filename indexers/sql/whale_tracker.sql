-- Whale Tracker tables

-- 1. Per-token holdings (top 50 holders per token)
CREATE TABLE IF NOT EXISTS whale_holdings (
    address TEXT NOT NULL,
    token_address TEXT NOT NULL,
    token_symbol TEXT NOT NULL,
    balance DOUBLE PRECISION NOT NULL DEFAULT 0,
    balance_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    rank INTEGER NOT NULL,
    is_contract BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (address, token_address)
);

-- 2. Whale address summary (aggregated across tokens)
CREATE TABLE IF NOT EXISTS whale_addresses (
    address TEXT PRIMARY KEY,
    total_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    token_count INTEGER NOT NULL DEFAULT 0,
    top_tokens TEXT,  -- comma-separated top token symbols
    is_contract BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_whale_holdings_token ON whale_holdings(token_symbol);
CREATE INDEX IF NOT EXISTS idx_whale_holdings_usd ON whale_holdings(balance_usd DESC);
CREATE INDEX IF NOT EXISTS idx_whale_addresses_usd ON whale_addresses(total_usd DESC);
CREATE INDEX IF NOT EXISTS idx_whale_addresses_tokens ON whale_addresses(token_count DESC);

-- RLS
ALTER TABLE whale_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE whale_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read whale_holdings" ON whale_holdings FOR SELECT USING (true);
CREATE POLICY "Public read whale_addresses" ON whale_addresses FOR SELECT USING (true);

-- Sync status entry
INSERT INTO sync_status (indexer_name, status, last_synced_at)
VALUES ('whale_tracker', 'idle', NOW())
ON CONFLICT (indexer_name) DO NOTHING;
