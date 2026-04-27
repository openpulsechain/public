-- Scam Radar Alerts table
CREATE TABLE IF NOT EXISTS scam_radar_alerts (
    id BIGSERIAL PRIMARY KEY,
    alert_type TEXT NOT NULL,  -- lp_removal, whale_dump, mint_event, tax_change
    severity TEXT NOT NULL DEFAULT 'medium',  -- low, medium, high, critical
    token_address TEXT,
    pair_address TEXT,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sra_type ON scam_radar_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_sra_severity ON scam_radar_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_sra_token ON scam_radar_alerts(token_address);
CREATE INDEX IF NOT EXISTS idx_sra_created ON scam_radar_alerts(created_at DESC);

ALTER TABLE scam_radar_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scam_radar_alerts_select_public" ON scam_radar_alerts
    FOR SELECT USING (TRUE);

CREATE POLICY "scam_radar_alerts_insert_service" ON scam_radar_alerts
    FOR INSERT WITH CHECK (auth.role() = 'service_role');


-- Deployer Reputation table
CREATE TABLE IF NOT EXISTS deployer_reputation (
    deployer_address TEXT PRIMARY KEY,
    tokens_deployed INTEGER DEFAULT 0,
    tokens_dead INTEGER DEFAULT 0,
    tokens_alive INTEGER DEFAULT 0,
    dead_ratio NUMERIC(5,1) DEFAULT 0,
    reputation_score INTEGER DEFAULT 50 CHECK (reputation_score >= 0 AND reputation_score <= 100),
    risk_level TEXT DEFAULT 'unknown',
    tokens JSONB DEFAULT '[]',
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dr_score ON deployer_reputation(reputation_score);
CREATE INDEX IF NOT EXISTS idx_dr_risk ON deployer_reputation(risk_level);

ALTER TABLE deployer_reputation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deployer_reputation_select_public" ON deployer_reputation
    FOR SELECT USING (TRUE);

CREATE POLICY "deployer_reputation_insert_service" ON deployer_reputation
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "deployer_reputation_update_service" ON deployer_reputation
    FOR UPDATE USING (auth.role() = 'service_role');
