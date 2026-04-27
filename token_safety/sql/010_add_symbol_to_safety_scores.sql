-- Add symbol column to token_safety_scores
-- Fixes: "column token_safety_scores.symbol does not exist" (error 42703)
-- Affected services: Twitter Scraper, Token Social, Token Intel

-- Step 1: Add column
ALTER TABLE token_safety_scores
ADD COLUMN IF NOT EXISTS symbol TEXT;

-- Step 2: Backfill from pulsechain_tokens
UPDATE token_safety_scores tss
SET symbol = pt.symbol
FROM pulsechain_tokens pt
WHERE tss.token_address = pt.address
  AND tss.symbol IS NULL;

-- Step 3: Index for lookups by symbol
CREATE INDEX IF NOT EXISTS idx_tss_symbol ON token_safety_scores(symbol);
