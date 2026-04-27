-- Title:       PulseChain Bridge — Daily Flows v4
-- Description: Daily deposit/withdrawal volume with cumulative net flow (decoded tables)
-- Chain:       ethereum
-- Contracts:   0x1715a3e4a142d8b698131108995174f37aeba10d (OmniBridge)
-- Output:      day, deposits_usd, withdrawals_usd, net_flow_usd, cumulative_net_flow_usd
-- Author:      @openpulsechain
-- Dune ID:     6776544
-- Source:      Decoded OmniBridge events (tokensbridginginitiated + tokensbridged)

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
        b.evt_block_date,
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
),

daily AS (
    SELECT
        evt_block_date AS day,
        SUM(CASE WHEN direction = 'deposit' THEN usd_value ELSE 0 END) AS deposits_usd,
        SUM(CASE WHEN direction = 'withdrawal' THEN usd_value ELSE 0 END) AS withdrawals_usd,
        SUM(CASE WHEN direction = 'deposit' THEN usd_value ELSE -usd_value END) AS net_flow_usd
    FROM priced
    GROUP BY evt_block_date
)

SELECT
    day,
    deposits_usd,
    withdrawals_usd,
    net_flow_usd,
    SUM(net_flow_usd) OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_net_flow_usd
FROM daily
ORDER BY day
