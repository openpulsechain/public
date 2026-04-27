-- Holder Leagues: track token holder distribution by tier
-- Tokens: PLS, PLSX, pHEX, INC
-- Tiers: Poseidon (10%), Whale (1%), Shark (0.1%), Dolphin (0.01%), Squid (0.001%), Turtle (0.0001%)

-- Snapshot history (one row per token per scrape)
CREATE TABLE IF NOT EXISTS holder_league_snapshots (
    id BIGSERIAL PRIMARY KEY,
    token_symbol TEXT NOT NULL,
    token_address TEXT NOT NULL,
    total_holders INTEGER NOT NULL,
    total_supply TEXT NOT NULL,            -- raw string to avoid precision loss
    total_supply_human DOUBLE PRECISION,
    poseidon_count INTEGER NOT NULL DEFAULT 0,
    whale_count INTEGER NOT NULL DEFAULT 0,
    shark_count INTEGER NOT NULL DEFAULT 0,
    dolphin_count INTEGER NOT NULL DEFAULT 0,
    squid_count INTEGER NOT NULL DEFAULT 0,
    turtle_count INTEGER NOT NULL DEFAULT 0,
    scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scrape_duration_s NUMERIC(6,1) DEFAULT 0,
    pages_fetched INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_hls_symbol ON holder_league_snapshots(token_symbol);
CREATE INDEX IF NOT EXISTS idx_hls_scraped ON holder_league_snapshots(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_hls_symbol_scraped ON holder_league_snapshots(token_symbol, scraped_at DESC);

ALTER TABLE holder_league_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hls_select_authenticated" ON holder_league_snapshots
    FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "hls_select_anon" ON holder_league_snapshots
    FOR SELECT TO anon USING (TRUE);

-- Current view (one row per token, latest data)
CREATE TABLE IF NOT EXISTS holder_league_current (
    token_symbol TEXT PRIMARY KEY,
    token_address TEXT NOT NULL,
    total_holders INTEGER NOT NULL,
    total_supply TEXT NOT NULL,
    total_supply_human DOUBLE PRECISION,
    poseidon_count INTEGER NOT NULL DEFAULT 0,
    whale_count INTEGER NOT NULL DEFAULT 0,
    shark_count INTEGER NOT NULL DEFAULT 0,
    dolphin_count INTEGER NOT NULL DEFAULT 0,
    squid_count INTEGER NOT NULL DEFAULT 0,
    turtle_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE holder_league_current ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hlc_select_authenticated" ON holder_league_current
    FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "hlc_select_anon" ON holder_league_current
    FOR SELECT TO anon USING (TRUE);
