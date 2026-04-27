-- Title:       PulseChain Bridge — Transfer Size Distribution
-- Description: Transfer count and volume by size bracket
-- Chain:       ethereum
-- Contracts:   0x1715a3e4a142d8b698131108995174f37aeba10d (OmniBridge)
-- Output:      size_bucket, tx_count, total_volume_usd, pct_of_txs, pct_of_volume
-- Author:      @openpulsechain
-- Dune ID:     6776548
-- Source:      Decoded OmniBridge events

WITH bridge_events AS (
    SELECT
        evt_block_date,
        token AS token_address,
        value AS raw_value
    FROM pulsechain_ethereum.pulsechainomnibridge_evt_tokensbridginginitiated
    WHERE evt_block_date >= DATE '2023-05-10'

    UNION ALL

    SELECT
        evt_block_date,
        token AS token_address,
        value AS raw_value
    FROM pulsechain_ethereum.pulsechainomnibridge_evt_tokensbridged
    WHERE evt_block_date >= DATE '2023-05-10'
),

priced AS (
    SELECT
        CAST(b.raw_value AS DOUBLE) / POWER(10, COALESCE(t.decimals, 18)) * COALESCE(p.price, 0) AS usd_value
    FROM bridge_events b
    LEFT JOIN tokens.erc20 t
        ON t.contract_address = b.token_address
        AND t.blockchain = 'ethereum'
    LEFT JOIN prices.day p
        ON p.contract_address = b.token_address
        AND p.blockchain = 'ethereum'
        AND p.timestamp = CAST(b.evt_block_date AS TIMESTAMP)
    WHERE CAST(b.raw_value AS DOUBLE) / POWER(10, COALESCE(t.decimals, 18))
          * COALESCE(p.price, 0) <= 50000000
      AND CAST(b.raw_value AS DOUBLE) / POWER(10, COALESCE(t.decimals, 18))
          * COALESCE(p.price, 0) > 0
),

bucketed AS (
    SELECT
        CASE
            WHEN usd_value < 1000 THEN '1. < $1K'
            WHEN usd_value < 10000 THEN '2. $1K - $10K'
            WHEN usd_value < 100000 THEN '3. $10K - $100K'
            WHEN usd_value < 1000000 THEN '4. $100K - $1M'
            ELSE '5. > $1M'
        END AS size_bucket,
        usd_value
    FROM priced
),

totals AS (
    SELECT COUNT(*) AS total_txs, SUM(usd_value) AS total_vol FROM priced
)

SELECT
    b.size_bucket,
    COUNT(*) AS tx_count,
    SUM(b.usd_value) AS total_volume_usd,
    ROUND(100.0 * COUNT(*) / t.total_txs, 1) AS pct_of_txs,
    ROUND(100.0 * SUM(b.usd_value) / t.total_vol, 1) AS pct_of_volume
FROM bucketed b
CROSS JOIN totals t
GROUP BY b.size_bucket, t.total_txs, t.total_vol
ORDER BY b.size_bucket
