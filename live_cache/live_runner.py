"""Live Cache Runner — entry point for scheduled cron.

Runs token_pools_live updater. Designed for 1-minute cron schedule.
The tier system inside handles refresh intervals (hot=30s, warm=5min, cold=1h).
"""

import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("live_runner")


def main():
    logger.info("Live Cache — starting run")

    try:
        from token_pools_live import run
        run()
    except Exception as e:
        logger.error(f"Live Cache FAILED: {e}")
        sys.exit(1)

    logger.info("Live Cache — run complete")


if __name__ == "__main__":
    main()
