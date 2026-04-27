-- Title:       PulseChain Bridge — Weekly Active Users
-- Description: Weekly unique bridgers (distinct transaction originators)
-- Chain:       ethereum
-- Contracts:   0x1715a3e4a142d8b698131108995174f37aeba10d (OmniBridge)
-- Output:      week, unique_users, deposit_users, withdrawal_users
-- Author:      @openpulsechain
-- Dune ID:     6776549
-- Source:      Decoded OmniBridge events

WITH bridge_events AS (
    SELECT
        evt_block_date,
        evt_tx_from AS user_address,
        'deposit' AS direction
    FROM pulsechain_ethereum.pulsechainomnibridge_evt_tokensbridginginitiated
    WHERE evt_block_date >= DATE '2023-05-10'

    UNION ALL

    SELECT
        evt_block_date,
        evt_tx_from AS user_address,
        'withdrawal' AS direction
    FROM pulsechain_ethereum.pulsechainomnibridge_evt_tokensbridged
    WHERE evt_block_date >= DATE '2023-05-10'
)

SELECT
    DATE_TRUNC('week', evt_block_date) AS week,
    COUNT(DISTINCT user_address) AS unique_users,
    COUNT(DISTINCT CASE WHEN direction = 'deposit' THEN user_address END) AS deposit_users,
    COUNT(DISTINCT CASE WHEN direction = 'withdrawal' THEN user_address END) AS withdrawal_users
FROM bridge_events
GROUP BY DATE_TRUNC('week', evt_block_date)
ORDER BY week
