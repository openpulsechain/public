-- Known addresses table for intelligence/research labels
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS known_addresses (
    address TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    risk_level TEXT NOT NULL DEFAULT 'LOW',  -- HIGH, MEDIUM, LOW
    category TEXT,                            -- e.g. 'dumper', 'manipulator', 'exploit', 'sac', 'sanctioned', 'phishing'
    source TEXT NOT NULL DEFAULT 'research',  -- 'intelligence_study', 'ofac', 'scamsniffer', 'eth_labels', 'research'
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for filtering
CREATE INDEX IF NOT EXISTS idx_known_addresses_risk ON known_addresses(risk_level);
CREATE INDEX IF NOT EXISTS idx_known_addresses_source ON known_addresses(source);
CREATE INDEX IF NOT EXISTS idx_known_addresses_category ON known_addresses(category);

-- RLS
ALTER TABLE known_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read known_addresses" ON known_addresses FOR SELECT USING (true);
CREATE POLICY "Service write known_addresses" ON known_addresses FOR ALL USING (auth.role() = 'service_role');

-- Intelligence addresses loaded from private repo at deploy time
-- See private repo for seed data
