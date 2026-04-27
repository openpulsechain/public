"""Bridge subgraph indexer — syncs ETH and PLS side bridge transfers.

Schema (identical on both sides):
  UserRequest: id, user (Bytes), recipient (Bytes), to (Bytes), token (Bytes),
               symbol, decimals, amount (BigInt), timestamp (BigInt!), txHash (Bytes!),
               messageId (Bytes), encodedData, message { msgId }
  Execution:   id, user (Bytes), token (Bytes), amount (BigInt), sender, executor,
               messageId (Bytes), status (Boolean), timestamp (BigInt!), txHash (Bytes!)

Direction logic:
  - ETH subgraph UserRequest = deposit (ETH→PLS)
  - PLS subgraph UserRequest = withdrawal (PLS→ETH)
  - Execution on opposite side confirms completion
"""

import logging
from datetime import datetime, timezone

from db import supabase
from config import SUBGRAPH_ETH, SUBGRAPH_PLS, SUBGRAPH_PAGE_SIZE, BRIDGE_SYNC_MAX_PAGES
from utils.subgraph import paginate_subgraph, query_subgraph

logger = logging.getLogger(__name__)

USER_REQUEST_FIELDS = """
    id
    user
    recipient
    token
    symbol
    decimals
    amount
    timestamp
    txHash
    messageId
"""

EXECUTION_FIELDS = """
    id
    messageId
    txHash
    timestamp
    status
"""


def _get_cursor(indexer_name):
    result = supabase.table("sync_status").select("last_cursor").eq("indexer_name", indexer_name).single().execute()
    return result.data.get("last_cursor") or ""


def _update_cursor(indexer_name, cursor, count):
    supabase.table("sync_status").update({
        "last_cursor": cursor,
        "records_synced": count,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
        "status": "idle",
        "error_message": None,
    }).eq("indexer_name", indexer_name).execute()


def _set_status(indexer_name, status, error=None):
    supabase.table("sync_status").update({
        "status": status,
        "error_message": error,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("indexer_name", indexer_name).execute()


def _sync_side(endpoint, chain_source, indexer_name):
    """Sync one side of the bridge (ETH or PLS)."""
    _set_status(indexer_name, "running")
    cursor = _get_cursor(indexer_name)
    total_synced = 0

    # Direction is determined by which subgraph the UserRequest comes from
    direction = "deposit" if chain_source == "ethereum" else "withdrawal"

    try:
        where = f'timestamp_gt: "{cursor}"' if cursor else ""

        for batch in paginate_subgraph(
            endpoint=endpoint,
            entity="userRequests",
            fields=USER_REQUEST_FIELDS,
            where=where,
            page_size=SUBGRAPH_PAGE_SIZE,
            max_pages=BRIDGE_SYNC_MAX_PAGES,
        ):
            rows = []
            for req in batch:
                # user is a Bytes field (hex string), not a nested object
                user_addr = (req.get("user") or "").lower()
                token_addr = (req.get("token") or "").lower()

                ts = int(req.get("timestamp") or 0)
                block_ts = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None

                rows.append({
                    "id": f"{chain_source}_{req['id']}",
                    "direction": direction,
                    "status": "pending",
                    "user_address": user_addr,
                    "token_address_eth": token_addr if chain_source == "ethereum" else None,
                    "token_address_pls": token_addr if chain_source == "pulsechain" else None,
                    "token_symbol": req.get("symbol"),
                    "token_decimals": req.get("decimals"),
                    "amount_raw": req.get("amount") or "0",
                    "message_id": req.get("messageId"),
                    "tx_hash_eth": req.get("txHash") if chain_source == "ethereum" else None,
                    "tx_hash_pls": req.get("txHash") if chain_source == "pulsechain" else None,
                    "block_timestamp": block_ts,
                    "chain_source": chain_source,
                })

            if rows:
                supabase.table("bridge_transfers").upsert(rows, on_conflict="id").execute()
                total_synced += len(rows)
                cursor = batch[-1].get("timestamp", cursor)

        _update_cursor(indexer_name, cursor, total_synced)
        logger.info(f"[{indexer_name}] Synced {total_synced} records")

    except Exception as e:
        _set_status(indexer_name, "error", str(e)[:500])
        raise


def _match_executions(endpoint, chain_source, indexer_name):
    """Match executions on the OPPOSITE side to update pending → executed.

    ETH UserRequests (deposits) are confirmed by PLS Executions, and vice versa.
    So we query executions on the opposite endpoint.
    """
    opposite_endpoint = SUBGRAPH_PLS if chain_source == "ethereum" else SUBGRAPH_ETH

    try:
        pending = supabase.table("bridge_transfers") \
            .select("id, message_id") \
            .eq("status", "pending") \
            .eq("chain_source", chain_source) \
            .not_.is_("message_id", "null") \
            .limit(1000) \
            .execute()

        if not pending.data:
            return

        message_ids = [r["message_id"] for r in pending.data if r["message_id"]]
        if not message_ids:
            return

        for i in range(0, len(message_ids), 100):
            batch_ids = message_ids[i:i + 100]
            ids_str = ", ".join(f'"{mid}"' for mid in batch_ids)

            query = f"""
            {{
                executions(
                    first: 1000,
                    where: {{ messageId_in: [{ids_str}] }}
                ) {{
                    {EXECUTION_FIELDS}
                }}
            }}
            """

            data = query_subgraph(opposite_endpoint, query)
            executions = data.get("executions", [])

            exec_map = {e["messageId"]: e for e in executions}

            for record in pending.data:
                mid = record.get("message_id")
                if mid and mid in exec_map:
                    ex = exec_map[mid]
                    update = {"status": "executed"}
                    # Add the counterpart tx hash
                    if chain_source == "ethereum":
                        update["tx_hash_pls"] = ex.get("txHash")
                    else:
                        update["tx_hash_eth"] = ex.get("txHash")

                    supabase.table("bridge_transfers").update(update).eq("id", record["id"]).execute()

        logger.info(f"[{indexer_name}] Matched executions for pending transfers")

    except Exception as e:
        logger.warning(f"[{indexer_name}] Execution matching failed: {e}")


def run():
    """Sync both sides of the bridge."""
    logger.info("Starting bridge subgraph sync...")

    _sync_side(SUBGRAPH_ETH, "ethereum", "bridge_subgraph_eth")
    _sync_side(SUBGRAPH_PLS, "pulsechain", "bridge_subgraph_pls")

    _match_executions(SUBGRAPH_ETH, "ethereum", "bridge_subgraph_eth")
    _match_executions(SUBGRAPH_PLS, "pulsechain", "bridge_subgraph_pls")

    logger.info("Bridge subgraph sync complete")
