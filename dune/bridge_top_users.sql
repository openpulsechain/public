-- Title:       PulseChain Bridge — Top Users v4
-- Description: Top 100 bridge users by total USD volume (decoded tables, evt_tx_from)
-- Chain:       ethereum
-- Contracts:   0x1715a3e4a142d8b698131108995174f37aeba10d (OmniBridge)
-- Output:      user_address, deposits_usd, withdrawals_usd, total_volume_usd, net_flow_usd, tx_count, first_bridge, last_bridge
-- Author:      @openpulsechain
-- Dune ID:     6776550
-- Source:      Decoded OmniBridge events

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
          * COALESCE(p.price, 0) <= 50000000
)

SELECT
    user_address,
    SUM(CASE WHEN direction = 'deposit' THEN usd_value ELSE 0 END) AS deposits_usd,
    SUM(CASE WHEN direction = 'withdrawal' THEN usd_value ELSE 0 END) AS withdrawals_usd,
    SUM(usd_value) AS total_volume_usd,
    SUM(CASE WHEN direction = 'deposit' THEN usd_value ELSE -usd_value END) AS net_flow_usd,
    COUNT(*) AS tx_count,
    MIN(evt_block_date) AS first_bridge,
    MAX(evt_block_date) AS last_bridge
FROM priced
WHERE usd_value > 0
  AND user_address != 0x0000000000000000000000000000000000000000
GROUP BY user_address
ORDER BY total_volume_usd DESC
LIMIT 100
