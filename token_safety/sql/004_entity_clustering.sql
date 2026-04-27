-- Entity clustering: confidence scores + entity-adjusted holder counts
-- Supports the "real holders" deduplication feature

-- 1. Add confidence_score to whale_links
ALTER TABLE whale_links ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(3,2) DEFAULT 0.50;

-- 2. Add entity-adjusted counts to holder_league_current
ALTER TABLE holder_league_current ADD COLUMN IF NOT EXISTS total_entities INTEGER;
ALTER TABLE holder_league_current ADD COLUMN IF NOT EXISTS poseidon_entities INTEGER DEFAULT 0;
ALTER TABLE holder_league_current ADD COLUMN IF NOT EXISTS whale_entities INTEGER DEFAULT 0;
ALTER TABLE holder_league_current ADD COLUMN IF NOT EXISTS shark_entities INTEGER DEFAULT 0;
ALTER TABLE holder_league_current ADD COLUMN IF NOT EXISTS dolphin_entities INTEGER DEFAULT 0;
ALTER TABLE holder_league_current ADD COLUMN IF NOT EXISTS squid_entities INTEGER DEFAULT 0;
ALTER TABLE holder_league_current ADD COLUMN IF NOT EXISTS turtle_entities INTEGER DEFAULT 0;
ALTER TABLE holder_league_current ADD COLUMN IF NOT EXISTS family_count INTEGER DEFAULT 0;

-- 3. Add entity counts to snapshots too (for history)
ALTER TABLE holder_league_snapshots ADD COLUMN IF NOT EXISTS total_entities INTEGER;
ALTER TABLE holder_league_snapshots ADD COLUMN IF NOT EXISTS family_count INTEGER DEFAULT 0;

-- 4. Add confidence_score to holder_league_families
ALTER TABLE holder_league_families ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(3,2) DEFAULT 0.50;
