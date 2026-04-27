import time
import logging

logger = logging.getLogger(__name__)


def with_retry(fn, max_retries=3, base_delay=2):
    """Execute fn with exponential backoff. Returns fn result or raises last exception."""
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except Exception as e:
            if attempt == max_retries:
                raise
            delay = base_delay * (2 ** attempt)
            logger.warning(f"Attempt {attempt + 1} failed: {e}. Retrying in {delay}s...")
            time.sleep(delay)
