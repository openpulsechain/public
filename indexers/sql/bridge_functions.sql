-- ============================================================
-- OpenPulsechain — Bridge & Hyperlane SQL Functions
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. compute_bridge_usd_prices
-- Calculates amount_usd for bridge transfers that have null amount_usd
-- Matches token by address (ETH or PLS side) against token_prices,
-- preferring CoinGecko source for majors (more reliable prices)
CREATE OR REPLACE FUNCTION public.compute_bridge_usd_prices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count integer := 0;
BEGIN
  WITH prices AS (
    -- Get best price per symbol: prefer CoinGecko, then by address match
    SELECT DISTINCT ON (tp.symbol)
      tp.symbol,
      tp.price_usd,
      tp.source
    FROM token_prices tp
    WHERE tp.price_usd IS NOT NULL AND tp.price_usd > 0
    ORDER BY tp.symbol,
      CASE WHEN tp.source = 'coingecko' THEN 0 ELSE 1 END,
      tp.price_usd DESC
  )
  UPDATE bridge_transfers bt
  SET amount_usd = (bt.amount_raw::numeric / power(10, COALESCE(bt.token_decimals, 18))) * p.price_usd
  FROM prices p
  WHERE bt.amount_usd IS NULL
    AND bt.token_symbol IS NOT NULL
    AND bt.amount_raw IS NOT NULL
    AND bt.amount_raw != '0'
    AND UPPER(bt.token_symbol) = UPPER(p.symbol);

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- 2. get_bridge_daily_stats
-- Aggregates bridge_transfers by date for daily stats
-- Accepts since_date parameter to avoid PostgREST 1000-row truncation
CREATE OR REPLACE FUNCTION public.get_bridge_daily_stats(since_date date DEFAULT '2020-01-01')
RETURNS TABLE(
  date date,
  deposit_count bigint,
  withdrawal_count bigint,
  deposit_volume_usd numeric,
  withdrawal_volume_usd numeric,
  unique_users bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    (bt.block_timestamp AT TIME ZONE 'UTC')::date AS date,
    COUNT(*) FILTER (WHERE bt.direction = 'deposit') AS deposit_count,
    COUNT(*) FILTER (WHERE bt.direction = 'withdrawal') AS withdrawal_count,
    COALESCE(SUM(bt.amount_usd) FILTER (WHERE bt.direction = 'deposit'), 0) AS deposit_volume_usd,
    COALESCE(SUM(bt.amount_usd) FILTER (WHERE bt.direction = 'withdrawal'), 0) AS withdrawal_volume_usd,
    COUNT(DISTINCT bt.user_address) AS unique_users
  FROM bridge_transfers bt
  WHERE bt.block_timestamp IS NOT NULL
    AND (bt.block_timestamp AT TIME ZONE 'UTC')::date >= since_date
  GROUP BY (bt.block_timestamp AT TIME ZONE 'UTC')::date
  ORDER BY date;
$$;

-- 3. get_bridge_token_stats
-- Aggregates bridge_transfers by token
CREATE OR REPLACE FUNCTION public.get_bridge_token_stats()
RETURNS TABLE(
  token_address text,
  token_symbol text,
  deposit_count bigint,
  withdrawal_count bigint,
  deposit_volume_usd numeric,
  withdrawal_volume_usd numeric,
  last_bridge_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    COALESCE(bt.token_address_eth, bt.token_address_pls, 'unknown') AS token_address,
    bt.token_symbol,
    COUNT(*) FILTER (WHERE bt.direction = 'deposit') AS deposit_count,
    COUNT(*) FILTER (WHERE bt.direction = 'withdrawal') AS withdrawal_count,
    COALESCE(SUM(bt.amount_usd) FILTER (WHERE bt.direction = 'deposit'), 0) AS deposit_volume_usd,
    COALESCE(SUM(bt.amount_usd) FILTER (WHERE bt.direction = 'withdrawal'), 0) AS withdrawal_volume_usd,
    MAX(bt.block_timestamp) AS last_bridge_at
  FROM bridge_transfers bt
  WHERE bt.token_symbol IS NOT NULL
  GROUP BY COALESCE(bt.token_address_eth, bt.token_address_pls, 'unknown'), bt.token_symbol
  ORDER BY (COALESCE(SUM(bt.amount_usd) FILTER (WHERE bt.direction = 'deposit'), 0) +
            COALESCE(SUM(bt.amount_usd) FILTER (WHERE bt.direction = 'withdrawal'), 0)) DESC;
$$;

-- 4. get_hyperlane_daily_stats
-- Aggregates hyperlane_transfers by date
CREATE OR REPLACE FUNCTION public.get_hyperlane_daily_stats()
RETURNS TABLE(
  date date,
  inbound_count bigint,
  outbound_count bigint,
  inbound_volume_usd numeric,
  outbound_volume_usd numeric,
  net_flow_usd numeric,
  unique_users bigint,
  unique_chains bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    (ht.send_occurred_at AT TIME ZONE 'UTC')::date AS date,
    COUNT(*) FILTER (WHERE ht.direction = 'inbound') AS inbound_count,
    COUNT(*) FILTER (WHERE ht.direction = 'outbound') AS outbound_count,
    COALESCE(SUM(ht.amount_usd) FILTER (WHERE ht.direction = 'inbound'), 0) AS inbound_volume_usd,
    COALESCE(SUM(ht.amount_usd) FILTER (WHERE ht.direction = 'outbound'), 0) AS outbound_volume_usd,
    COALESCE(SUM(ht.amount_usd) FILTER (WHERE ht.direction = 'inbound'), 0) -
      COALESCE(SUM(ht.amount_usd) FILTER (WHERE ht.direction = 'outbound'), 0) AS net_flow_usd,
    COUNT(DISTINCT COALESCE(ht.origin_tx_sender, ht.sender_address)) AS unique_users,
    COUNT(DISTINCT CASE
      WHEN ht.direction = 'inbound' THEN ht.origin_chain_id
      ELSE ht.destination_chain_id
    END) AS unique_chains
  FROM hyperlane_transfers ht
  WHERE ht.send_occurred_at IS NOT NULL
  GROUP BY (ht.send_occurred_at AT TIME ZONE 'UTC')::date
  ORDER BY date;
$$;

-- 5. get_hyperlane_chain_stats
-- Aggregates hyperlane_transfers by chain
CREATE OR REPLACE FUNCTION public.get_hyperlane_chain_stats()
RETURNS TABLE(
  chain_id integer,
  chain_name text,
  total_inbound_count bigint,
  total_outbound_count bigint,
  total_inbound_volume_usd numeric,
  total_outbound_volume_usd numeric,
  net_flow_usd numeric,
  last_transfer_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH inbound AS (
    SELECT
      ht.origin_chain_id AS chain_id,
      ht.origin_chain_name AS chain_name,
      COUNT(*) AS cnt,
      COALESCE(SUM(ht.amount_usd), 0) AS vol,
      MAX(ht.send_occurred_at) AS last_at
    FROM hyperlane_transfers ht
    WHERE ht.direction = 'inbound'
    GROUP BY ht.origin_chain_id, ht.origin_chain_name
  ),
  outbound AS (
    SELECT
      ht.destination_chain_id AS chain_id,
      ht.destination_chain_name AS chain_name,
      COUNT(*) AS cnt,
      COALESCE(SUM(ht.amount_usd), 0) AS vol,
      MAX(ht.send_occurred_at) AS last_at
    FROM hyperlane_transfers ht
    WHERE ht.direction = 'outbound'
    GROUP BY ht.destination_chain_id, ht.destination_chain_name
  )
  SELECT
    COALESCE(i.chain_id, o.chain_id) AS chain_id,
    COALESCE(i.chain_name, o.chain_name) AS chain_name,
    COALESCE(i.cnt, 0) AS total_inbound_count,
    COALESCE(o.cnt, 0) AS total_outbound_count,
    COALESCE(i.vol, 0) AS total_inbound_volume_usd,
    COALESCE(o.vol, 0) AS total_outbound_volume_usd,
    COALESCE(i.vol, 0) - COALESCE(o.vol, 0) AS net_flow_usd,
    GREATEST(i.last_at, o.last_at) AS last_transfer_at
  FROM inbound i
  FULL OUTER JOIN outbound o ON i.chain_id = o.chain_id
  ORDER BY (COALESCE(i.vol, 0) + COALESCE(o.vol, 0)) DESC;
$$;

-- 6. get_bridge_tvl
-- Computes Bridge TVL per token: net deposited amount × current price
-- TVL = sum of (deposits - withdrawals) in token units × current token price
-- Only includes tokens with positive net balance (more deposited than withdrawn)
CREATE OR REPLACE FUNCTION public.get_bridge_tvl()
RETURNS TABLE(
  token_symbol text,
  net_amount numeric,
  price_usd numeric,
  tvl_usd numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH token_net AS (
    SELECT
      bt.token_symbol,
      SUM(CASE
        WHEN bt.direction = 'deposit'
        THEN bt.amount_raw::numeric / power(10, COALESCE(bt.token_decimals, 18))
        ELSE -(bt.amount_raw::numeric / power(10, COALESCE(bt.token_decimals, 18)))
      END) AS net_amount
    FROM bridge_transfers bt
    WHERE bt.token_symbol IS NOT NULL
      AND bt.amount_raw IS NOT NULL
      AND bt.amount_raw != '0'
    GROUP BY bt.token_symbol
    HAVING SUM(CASE
      WHEN bt.direction = 'deposit'
      THEN bt.amount_raw::numeric / power(10, COALESCE(bt.token_decimals, 18))
      ELSE -(bt.amount_raw::numeric / power(10, COALESCE(bt.token_decimals, 18)))
    END) > 0
  ),
  prices AS (
    SELECT DISTINCT ON (tp.symbol)
      tp.symbol,
      tp.price_usd
    FROM token_prices tp
    WHERE tp.price_usd IS NOT NULL AND tp.price_usd > 0
    ORDER BY tp.symbol,
      CASE WHEN tp.source = 'coingecko' THEN 0 ELSE 1 END,
      tp.price_usd DESC
  )
  SELECT
    tn.token_symbol,
    tn.net_amount,
    p.price_usd,
    tn.net_amount * p.price_usd AS tvl_usd
  FROM token_net tn
  JOIN prices p ON UPPER(tn.token_symbol) = UPPER(p.symbol)
  ORDER BY tn.net_amount * p.price_usd DESC;
$$;
