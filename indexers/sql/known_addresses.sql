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

-- Insert intelligence study addresses
INSERT INTO known_addresses (address, label, risk_level, category, source) VALUES
    ('0xc172847f2734cc10f0472991a1e6031772f91ba1', 'SAC wallet - dormant dumper', 'HIGH', 'dumper', 'intelligence_study'),
    ('0xff40d2a06e35ff6552171562d92c09eed3f852ea', 'Validator exit - PLS dumper', 'HIGH', 'dumper', 'intelligence_study'),
    ('0x28545ab4dd3a9581dc91729410cdbd7f0314dd3b', 'pwBTC whale - shill & dump', 'HIGH', 'manipulator', 'intelligence_study'),
    ('0x2c2b3fd223bc544cee7bfcdced50821f7f58955d', 'HEX large holder - dump risk', 'HIGH', 'dumper', 'intelligence_study'),
    ('0x12cced86786a6e0514a39ce85901e75f491b42f5', 'HEX/DAI dumper', 'MEDIUM', 'dumper', 'intelligence_study'),
    ('0xc0702ae0374f83fc3ba71ce2b30a323b09ec19da', 'pDAI co-founder - exploit link', 'HIGH', 'exploit', 'intelligence_study'),
    ('0xbf182955401af3f2f7e244cb31184e93e74a2501', 'ATROPA coordinated dumper', 'HIGH', 'dumper', 'intelligence_study'),
    ('0xd8b1a6493af4f11719d877cf06a4d8b15c3d690f', 'ATROPA dumper #2', 'HIGH', 'dumper', 'intelligence_study'),
    ('0xeff6cd5994943df77d53ff74125166f64c68a80f', 'PCOCK manipulator', 'MEDIUM', 'manipulator', 'intelligence_study'),
    ('0xd30bc4859a79852157211e6db19de159673a67e2', 'Mentioned in intel', 'LOW', 'unknown', 'intelligence_study'),
    ('0xafa2a89cb43619677d9c72e81f6d4c8a730a1022', 'Possible sacrifice address', 'LOW', 'sac', 'intelligence_study')
ON CONFLICT (address) DO UPDATE SET
    label = EXCLUDED.label,
    risk_level = EXCLUDED.risk_level,
    category = EXCLUDED.category,
    source = EXCLUDED.source,
    updated_at = NOW();
