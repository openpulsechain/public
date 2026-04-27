-- Title:       PulseChain Bridge — Volume vs TVL Summary
-- Description: Single-row summary comparing total historical volume with estimated TVL,
--              providing context for why different platforms show different numbers
-- Chain:       ethereum
-- Contracts:   0x1715a3e4a142d8b698131108995174f37aeba10d (OmniBridge)
-- Output:      total_volume_usd, total_deposits_usd, total_withdrawals_usd, estimated_tvl_usd,
--              volume_to_tvl_ratio, total_txs, unique_users, unique_tokens
-- Author:      @openpulsechain
-- Source:      Decoded OmniBridge events + prices.day + tokens.erc20

WITH bridge_events AS (
    SELECT
        evt_block_date,
        evt_tx_from AS user_address,
        token AS token_address,
        value AS raw_value,
        'deposit' AS direction
    FROM pulsechain_ethereum.pulsechainomnibridge_evt_tokensbridginginitiated
    WHERE evt_block_date >= DATE '2023-05-10'

    UNION ALL

    SELECT
        evt_block_date,
        evt_tx_from AS user_address,
        token AS token_address,
        value AS raw_value,
        'withdrawal' AS direction
    FROM pulsechain_ethereum.pulsechainomnibridge_evt_tokensbridged
    WHERE evt_block_date >= DATE '2023-05-10'
),

-- Historical prices for volume calculation
priced_historical AS (
    SELECT
        b.evt_block_date,
        b.user_address,
        b.token_address,
        b.direction,
        CAST(b.raw_value AS DOUBLE) / POWER(10, COALESCE(t.decimals, 18)) AS token_amount,
        CAST(b.raw_value AS DOUBLE) / POWER(10, COALESCE(t.decimals, 18)) * COALESCE(p.price, 0) AS usd_value
    FROM bridge_events b
    LEFT JOIN tokens.erc20 t
        ON t.contract_address = b.token_address AND t.blockchain = 'ethereum'
    LEFT JOIN prices.day p
        ON p.contract_address = b.token_address AND p.blockchain = 'ethereum'
        AND p.timestamp = CAST(b.evt_block_date AS TIMESTAMP)
    WHERE CAST(b.raw_value AS DOUBLE) / POWER(10, COALESCE(t.decimals, 18))
          * COALESCE(p.price, 0) <= 50000000
),

-- Volume metrics
volume_stats AS (
    SELECT
        SUM(usd_value) AS total_volume_usd,
        SUM(CASE WHEN direction = 'deposit' THEN usd_value ELSE 0 END) AS total_deposits_usd,
        SUM(CASE WHEN direction = 'withdrawal' THEN usd_value ELSE 0 END) AS total_withdrawals_usd,
        COUNT(*) AS total_txs,
        COUNT(DISTINCT user_address) AS unique_users,
        COUNT(DISTINCT token_address) AS unique_tokens
    FROM priced_historical
),

-- TVL: net token balances at current prices
token_net AS (
    SELECT
        token_address,
        SUM(CASE WHEN direction = 'deposit' THEN token_amount ELSE -token_amount END) AS net_balance
    FROM priced_historical
    GROUP BY token_address
    HAVING SUM(CASE WHEN direction = 'deposit' THEN token_amount ELSE -token_amount END) > 0
),

latest_prices AS (
    SELECT contract_address, price,
           ROW_NUMBER() OVER (PARTITION BY contract_address ORDER BY timestamp DESC) AS rn
    FROM prices.day
    WHERE blockchain = 'ethereum' AND timestamp >= CURRENT_DATE - INTERVAL '7' DAY
),

tvl_stats AS (
    SELECT SUM(tn.net_balance * COALESCE(lp.price, 0)) AS estimated_tvl_usd
    FROM token_net tn
    LEFT JOIN latest_prices lp ON lp.contract_address = tn.token_address AND lp.rn = 1
)

SELECT
    v.total_volume_usd,
    v.total_deposits_usd,
    v.total_withdrawals_usd,
    t.estimated_tvl_usd,
    ROUND(v.total_volume_usd / NULLIF(t.estimated_tvl_usd, 0), 1) AS volume_to_tvl_ratio,
    v.total_txs,
    v.unique_users,
    v.unique_tokens
FROM volume_stats v
CROSS JOIN tvl_stats t
