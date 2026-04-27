import requests
import logging
from utils.retry import with_retry

logger = logging.getLogger(__name__)


def query_subgraph(endpoint, query, variables=None):
    """Execute a GraphQL query against a subgraph endpoint with retry."""
    def _do():
        resp = requests.post(
            endpoint,
            json={"query": query, "variables": variables or {}},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        if "errors" in data:
            raise Exception(f"Subgraph errors: {data['errors']}")
        return data["data"]

    return with_retry(_do)


def paginate_subgraph(endpoint, entity, fields, order_by="timestamp", where="", page_size=1000, max_pages=50):
    """Paginate through a subgraph entity using cursor-based pagination.

    Yields batches of records. Uses id-based pagination (skip is limited to 5000 in subgraphs).
    """
    last_id = ""
    pages = 0

    while pages < max_pages:
        where_clause = f'where: {{ id_gt: "{last_id}"'
        if where:
            where_clause += f", {where}"
        where_clause += " }"

        query = f"""
        {{
            {entity}(
                first: {page_size},
                orderBy: id,
                orderDirection: asc,
                {where_clause}
            ) {{
                {fields}
            }}
        }}
        """

        data = query_subgraph(endpoint, query)
        records = data.get(entity, [])

        if not records:
            break

        yield records

        last_id = records[-1]["id"]
        pages += 1

        if len(records) < page_size:
            break

    logger.info(f"Paginated {entity}: {pages} pages fetched")
