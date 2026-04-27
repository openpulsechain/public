-- Token Safety Scores table
-- Stores the latest safety analysis for each PulseChain token

CREATE TABLE IF NOT EXISTS token_safety_scores (
    token_address TEXT PRIMARY KEY,

    -- Composite score
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    grade TEXT NOT NULL CHECK (grade IN ('A', 'B', 'C', 'D', 'F')),
    risks TEXT[] DEFAULT '{}',

    -- Honeypot analysis
    honeypot_score INTEGER DEFAULT 0,
    is_honeypot BOOLEAN,
    buy_tax_pct NUMERIC(8,2),
    sell_tax_pct NUMERIC(8,2),

    -- Contract analysis
    contract_score INTEGER DEFAULT 0,
    is_verified BOOLEAN DEFAULT FALSE,
    is_proxy BOOLEAN DEFAULT FALSE,
    ownership_renounced BOOLEAN,
    has_mint BOOLEAN DEFAULT FALSE,
    has_blacklist BOOLEAN DEFAULT FALSE,
    contract_dangers TEXT[] DEFAULT '{}',

    -- LP analysis
    lp_score INTEGER DEFAULT 0,
    has_lp BOOLEAN DEFAULT FALSE,
    total_liquidity_usd NUMERIC(18,2) DEFAULT 0,
    pair_count INTEGER DEFAULT 0,
    recent_burns_24h INTEGER DEFAULT 0,

    -- Holder analysis
    holders_score INTEGER DEFAULT 0,
    holder_count INTEGER DEFAULT 0,
    top10_pct NUMERIC(8,2) DEFAULT 0,
    top1_pct NUMERIC(8,2) DEFAULT 0,

    -- Age analysis
    age_score INTEGER DEFAULT 0,
    age_days NUMERIC(10,1) DEFAULT 0,

    -- Full details JSON
    analysis_details JSONB,

    -- Timestamps
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tss_score ON token_safety_scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_tss_grade ON token_safety_scores(grade);
CREATE INDEX IF NOT EXISTS idx_tss_analyzed_at ON token_safety_scores(analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tss_is_honeypot ON token_safety_scores(is_honeypot) WHERE is_honeypot = TRUE;

-- RLS policies
ALTER TABLE token_safety_scores ENABLE ROW LEVEL SECURITY;

-- Public read access (no auth needed for safety scores)
CREATE POLICY "token_safety_scores_select_public" ON token_safety_scores
    FOR SELECT USING (TRUE);

-- Only service role can insert/update
CREATE POLICY "token_safety_scores_insert_service" ON token_safety_scores
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "token_safety_scores_update_service" ON token_safety_scores
    FOR UPDATE USING (auth.role() = 'service_role');

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_token_safety_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_token_safety_updated_at
    BEFORE UPDATE ON token_safety_scores
    FOR EACH ROW
    EXECUTE FUNCTION update_token_safety_updated_at();
