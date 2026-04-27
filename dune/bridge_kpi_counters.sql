-- Title:       PulseChain Bridge — KPI Counters
-- Description: Key performance indicators for the PulseChain OmniBridge (ETH-side)
-- Chain:       ethereum
-- Contracts:   0x1715a3e4a142d8b698131108995174f37aeba10d (OmniBridge)
-- Output:      total_volume_usd, total_txs, unique_users, volume_30d_usd, avg_tx_size_usd
-- Author:      @openpulsechain
-- Dune ID:     6776541
-- Source:      Decoded OmniBridge events (tokensbridginginitiated + tokensbridged)

WITH bridge_events AS (
    -- Deposits: ETH → PulseChain (tokens locked on Ethereum)
    SELECT
        evt_block_date,
        evt_tx_from AS user_address,
        token AS token_address,
        value AS raw_value,
        'deposit' AS direction
    FROM pulsechain_ethereum.pulsechainomnibridge_evt_tokensbridginginitiated
    WHERE evt_block_date >= DATE '2023-05-10'

    UNION ALL

    -- Withdrawals: PulseChain → ETH (tokens released on Ethereum)
    SELECT
        evt_block_date,
        evt_tx_from AS user_address,
        token AS token_address,
        value AS raw_value,
        'withdrawal' AS direction
    FROM pulsechain_ethereum.pulsechainomnibridge_evt_tokensbridged
    WHERE evt_block_date >= DATE '2023-05-10'
),

priced AS (
    SELECT
        b.evt_block_date,
        b.user_address,
        b.direction,
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
          * COALESCE(p.price, 0) <= 50000000  -- $50M cap per transfer
)

SELECT
    -- All-time metrics
    SUM(usd_value) AS total_volume_usd,
    COUNT(*) AS total_txs,
    COUNT(DISTINCT user_address) AS unique_users,

    -- 30-day metrics
    SUM(CASE WHEN evt_block_date >= CURRENT_DATE - INTERVAL '30' DAY THEN usd_value ELSE 0 END) AS volume_30d_usd,

    -- Average transaction size (all-time, excluding zero-value)
    SUM(usd_value) / NULLIF(COUNT(CASE WHEN usd_value > 0 THEN 1 END), 0) AS avg_tx_size_usd
FROM priced
