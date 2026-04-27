-- Whale clustering: links between whale addresses
-- Depends on whale_tracker tables (whale_addresses, whale_holdings)

-- Links table (relationships between addresses)
CREATE TABLE IF NOT EXISTS whale_links (
    id SERIAL PRIMARY KEY,
    address_from TEXT NOT NULL,
    address_to TEXT NOT NULL,
    link_type TEXT NOT NULL,  -- 'common_funder', 'same_funder', 'direct_transfer', 'token_transfer'
    detail TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whale_links_from ON whale_links(address_from);
CREATE INDEX IF NOT EXISTS idx_whale_links_to ON whale_links(address_to);
CREATE INDEX IF NOT EXISTS idx_whale_links_type ON whale_links(link_type);

-- Add funder_address column to whale_addresses if not exists
ALTER TABLE whale_addresses ADD COLUMN IF NOT EXISTS funder_address TEXT;

-- RLS
ALTER TABLE whale_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Public read whale_links" ON whale_links FOR SELECT USING (true);

-- Sync status entry
INSERT INTO sync_status (indexer_name, status) VALUES ('whale_clustering', 'idle')
ON CONFLICT (indexer_name) DO NOTHING;
