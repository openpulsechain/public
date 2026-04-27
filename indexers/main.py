"""PulseChain Analytics — Main indexer orchestrator.

Runs all indexers sequentially. Designed to be called by a cron job every 15 minutes.
"""

import logging
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("main")


def run_indexer(name, module):
    """Run a single indexer with error handling."""
    try:
        start = time.time()
        module.run()
        elapsed = time.time() - start
        logger.info(f"  {name} completed in {elapsed:.1f}s")
        return True
    except Exception as e:
        logger.error(f"  {name} FAILED: {e}")
        return False


def main():
    logger.info("=" * 60)
    logger.info("PulseChain Analytics — Indexer Run")
    logger.info("=" * 60)

    start_total = time.time()

    from indexers import bridge_subgraph
    from indexers import bridge_aggregator
    from indexers import hyperlane_bridge
    from indexers import hyperlane_aggregator
    from indexers import network_tvl
    from indexers import network_dex_volume
    from indexers import token_prices
    from indexers import network_snapshot
    from indexers import pulsex_stats
    from indexers import pulsex_pairs
    from indexers import token_discovery
    from indexers import token_history
    from indexers import bridge_tvl
    from indexers import whale_tracker
    from indexers import whale_clustering
    from indexers import pulsex_defillama
    from indexers import token_holders
    from indexers import token_monitoring
    from indexers import token_pools_live
    from indexers import pulsex_tokenlist_sync
    from indexers import piteas_tokenlist_sync
    from indexers import libertyswap_tokenlist_sync
    from indexers import pumptires_sync

    indexers = [
        ("bridge_subgraph", bridge_subgraph),
        ("bridge_aggregator", bridge_aggregator),
        ("hyperlane_bridge", hyperlane_bridge),
        ("hyperlane_aggregator", hyperlane_aggregator),
        ("network_tvl", network_tvl),
        ("network_dex_volume", network_dex_volume),
        ("pulsex_defillama", pulsex_defillama),
        ("token_prices", token_prices),
        ("network_snapshot", network_snapshot),
        ("pulsex_stats", pulsex_stats),
        ("pulsex_pairs", pulsex_pairs),
        ("token_discovery", token_discovery),
        ("pulsex_tokenlist_sync", pulsex_tokenlist_sync),
        ("piteas_tokenlist_sync", piteas_tokenlist_sync),
        ("libertyswap_tokenlist_sync", libertyswap_tokenlist_sync),
        ("pumptires_sync", pumptires_sync),
        ("token_history", token_history),
        ("bridge_tvl", bridge_tvl),
        ("whale_tracker", whale_tracker),
        ("token_holders", token_holders),
        ("whale_clustering", whale_clustering),
        ("token_monitoring", token_monitoring),
        ("token_pools_live", token_pools_live),
    ]

    results = {}
    for name, module in indexers:
        logger.info(f"Running {name}...")
        results[name] = run_indexer(name, module)

    elapsed_total = time.time() - start_total

    # Summary
    success = sum(1 for v in results.values() if v)
    failed = sum(1 for v in results.values() if not v)

    logger.info("=" * 60)
    logger.info(f"All indexers completed in {elapsed_total:.1f}s — {success} OK, {failed} failed")

    # Critical indexers: if these fail, exit(1) to signal the scheduler
    critical = {"bridge_subgraph", "token_prices", "pulsex_stats", "pulsex_pairs", "token_discovery"}
    critical_failed = [name for name, ok in results.items() if not ok and name in critical]
    non_critical_failed = [name for name, ok in results.items() if not ok and name not in critical]

    if non_critical_failed:
        for name in non_critical_failed:
            logger.warning(f"  NON-CRITICAL FAILED: {name}")

    if critical_failed:
        for name in critical_failed:
            logger.error(f"  CRITICAL FAILED: {name}")
        sys.exit(1)

    if failed:
        logger.info(f"All critical indexers OK — {failed} non-critical failed")
    else:
        logger.info("All indexers completed successfully")


if __name__ == "__main__":
    main()
