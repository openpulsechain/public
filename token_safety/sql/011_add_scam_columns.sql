-- Add scam_score and scam_risk_level columns to token_safety_scores
-- Allows querying scam stats without parsing JSON analysis_details

ALTER TABLE token_safety_scores
  ADD COLUMN IF NOT EXISTS scam_score INTEGER,
  ADD COLUMN IF NOT EXISTS scam_risk_level TEXT;

-- Index for fast filtering on risk level
CREATE INDEX IF NOT EXISTS idx_scam_risk_level ON token_safety_scores(scam_risk_level);

-- Backfill existing rows from analysis_details JSONB
UPDATE token_safety_scores
SET
  scam_score = (analysis_details::jsonb #>> '{scam_analysis,scam_score}')::INTEGER,
  scam_risk_level = analysis_details::jsonb #>> '{scam_analysis,risk_level}'
WHERE analysis_details IS NOT NULL
  AND scam_score IS NULL;
