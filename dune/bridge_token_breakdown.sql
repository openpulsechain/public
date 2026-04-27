-- Title:       PulseChain Bridge — Token Breakdown v4
-- Description: Aggregate bridge volume by token ranked by total volume (decoded tables)
-- Chain:       ethereum
-- Contracts:   0x1715a3e4a142d8b698131108995174f37aeba10d (OmniBridge)
-- Output:      token_address, symbol, deposits_usd, withdrawals_usd, total_volume_usd, net_flow_usd, tx_count
-- Author:      @openpulsechain
-- Dune ID:     6776546
-- Source:      Decoded OmniBridge events

WITH bridge_events AS (
    SELECT
        evt_block_date,
        token AS token_address,
        value AS raw_value,
        'deposit' AS direction
    FROM pulsechain_ethereum.pulsechainomnibridge_evt_tokensbridginginitiated
    WHERE evt_block_date >= DATE '2023-05-10'

    UNION ALL

    SELECT
        evt_block_date,
        token AS token_address,
        value AS raw_value,
        'withdrawal' AS direction
    FROM pulsechain_ethereum.pulsechainomnibridge_evt_tokensbridged
    WHERE evt_block_date >= DATE '2023-05-10'
),

priced AS (
    SELECT
        b.token_address,
        b.direction,
        t.symbol,
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
    token_address,
    COALESCE(symbol, 'Unknown') AS symbol,
    SUM(CASE WHEN direction = 'deposit' THEN usd_value ELSE 0 END) AS deposits_usd,
    SUM(CASE WHEN direction = 'withdrawal' THEN usd_value ELSE 0 END) AS withdrawals_usd,
    SUM(usd_value) AS total_volume_usd,
    SUM(CASE WHEN direction = 'deposit' THEN usd_value ELSE -usd_value END) AS net_flow_usd,
    COUNT(*) AS tx_count
FROM priced
WHERE usd_value > 0
GROUP BY token_address, symbol
ORDER BY total_volume_usd DESC
LIMIT 50
