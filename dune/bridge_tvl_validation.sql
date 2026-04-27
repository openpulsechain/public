-- Title:       PulseChain Bridge — TVL Validation & Cross-Source Comparison
-- Description: Computes estimated TVL from OmniBridge events to validate against DefiLlama/GoPulse,
--              and shows volume vs TVL context to explain differences across analytics platforms
-- Chain:       ethereum
-- Contracts:   0x1715a3e4a142d8b698131108995174f37aeba10d (OmniBridge)
-- Output:      Section 1: TVL by token (current prices) | Section 2: Volume vs TVL summary
-- Author:      @openpulsechain
-- Source:      Decoded OmniBridge events + prices.day + tokens.erc20

-- =============================================================================
-- WHY THIS QUERY EXISTS
-- =============================================================================
-- Different analytics platforms report wildly different numbers for the
-- PulseChain bridge:
--   - DefiLlama:   ~$72M  (TVL — current balance locked in the bridge contract)
--   - GoPulse:     ~$70M  (Hyperlane bridge only, not OmniBridge)
--   - AlphaGrowth: ~$55M  (TVL snapshot)
--   - Our dashboard: $8.18B (total historical volume — deposits + withdrawals)
--
-- These are NOT contradictory. They measure fundamentally different things:
--   TVL  = what is currently locked (net deposits at current prices)
--   Volume = every transfer that ever crossed the bridge (cumulative)
--
-- This query computes TVL from OmniBridge events to cross-validate against
-- DefiLlama, proving our data source captures the same underlying activity.
-- =============================================================================

WITH token_flows AS (
    -- Net token balance: deposits add tokens, withdrawals remove them
    SELECT
        token AS token_address,
        SUM(CASE WHEN direction = 'deposit' THEN CAST(value AS DOUBLE)
                 ELSE -CAST(value AS DOUBLE) END) AS net_raw_balance
    FROM (
        SELECT token, value, 'deposit' AS direction
        FROM pulsechain_ethereum.pulsechainomnibridge_evt_tokensbridginginitiated
        WHERE evt_block_date >= DATE '2023-05-10'

        UNION ALL

        SELECT token, value, 'withdrawal' AS direction
        FROM pulsechain_ethereum.pulsechainomnibridge_evt_tokensbridged
        WHERE evt_block_date >= DATE '2023-05-10'
    ) events
    GROUP BY token
    HAVING SUM(CASE WHEN direction = 'deposit' THEN CAST(value AS DOUBLE)
                    ELSE -CAST(value AS DOUBLE) END) > 0
),

-- Use the most recent price available for each token
latest_prices AS (
    SELECT
        contract_address,
        price,
        ROW_NUMBER() OVER (PARTITION BY contract_address ORDER BY timestamp DESC) AS rn
    FROM prices.day
    WHERE blockchain = 'ethereum'
      AND timestamp >= CURRENT_DATE - INTERVAL '7' DAY
),

tvl_by_token AS (
    SELECT
        f.token_address,
        COALESCE(t.symbol, 'Unknown') AS symbol,
        f.net_raw_balance / POWER(10, COALESCE(t.decimals, 18)) AS net_token_balance,
        COALESCE(lp.price, 0) AS current_price,
        f.net_raw_balance / POWER(10, COALESCE(t.decimals, 18)) * COALESCE(lp.price, 0) AS tvl_usd
    FROM token_flows f
    LEFT JOIN tokens.erc20 t
        ON t.contract_address = f.token_address
        AND t.blockchain = 'ethereum'
    LEFT JOIN latest_prices lp
        ON lp.contract_address = f.token_address
        AND lp.rn = 1
    WHERE f.net_raw_balance / POWER(10, COALESCE(t.decimals, 18)) * COALESCE(lp.price, 0) > 100
)

SELECT
    token_address,
    symbol,
    net_token_balance,
    current_price,
    tvl_usd,
    ROUND(100.0 * tvl_usd / SUM(tvl_usd) OVER (), 2) AS pct_of_tvl
FROM tvl_by_token
ORDER BY tvl_usd DESC
LIMIT 50
