"""Hyperlane bridge indexer — syncs Warp Route transfers via Hyperlane GraphQL API.

Data source: https://api.hyperlane.xyz/v1/graphql
PulseChain domain ID: 369

Direction logic:
  - origin_domain_id == 369 → outbound (PLS → other chain)
  - destination_domain_id == 369 → inbound (other chain → PLS)

Warp Route detection:
  - Inbound: recipient == PLS warp route address
  - Outbound: sender == PLS warp route address
  - Non-warp messages are stored with amount_usd = null
"""

import logging
import requests
from datetime import datetime, timezone

from db import supabase
from config import (
    HYPERLANE_API_URL,
    HYPERLANE_PLS_DOMAIN,
    HYPERLANE_PAGE_SIZE,
    HYPERLANE_SYNC_MAX_PAGES,
)
from utils.retry import with_retry

logger = logging.getLogger(__name__)

INDEXER_NAME = "hyperlane_bridge"

# Known warp route contracts on PulseChain
# When new warp routes launch, add them here
PLS_WARP_ROUTES = {
    "0xa5b0d537cebe97f087dc5fe5732d70719caaec1d": {
        "symbol": "USDC",
        "decimals": 6,
        "is_stablecoin": True,
        "price_usd": 1.0,
    },
}

CHAIN_NAMES = {
    1: "ethereum",
    10: "optimism",
    56: "bsc",
    100: "gnosis",
    130: "unichain",
    137: "polygon",
    250: "fantom",
    369: "pulsechain",
    1329: "sei",
    8453: "base",
    42161: "arbitrum",
    43114: "avalanche",
}

HYPERLANE_QUERY = """
query($cursor: bigint!, $limit: Int!) {
  message_view(
    where: {
      _and: [
        {_or: [
          {origin_domain_id: {_eq: 369}},
          {destination_domain_id: {_eq: 369}}
        ]},
        {id: {_gt: $cursor}}
      ]
    },
    limit: $limit,
    order_by: {id: asc}
  ) {
    id
    msg_id
    nonce
    sender
    recipient
    is_delivered
    origin_domain_id
    destination_domain_id
    origin_tx_hash
    origin_tx_sender
    destination_tx_hash
    send_occurred_at
    delivery_occurred_at
    message_body
  }
}
"""


def _clean_hex(val):
    """Normalize Hyperlane hex format (\\x prefix) to 0x prefix."""
    if not val:
        return None
    s = str(val).replace("\\x", "").replace("0x", "")
    if not s:
        return None
    return "0x" + s.lower()


def _decode_warp_body(body_hex):
    """Decode Warp Route message body: (recipient_address, amount_raw).

    Body format: 32 bytes recipient (address padded to 32 bytes) + 32 bytes amount.
    Returns (recipient_address, amount_raw) or (None, 0) if body is too short.
    """
    if not body_hex:
        return (None, 0)
    clean = str(body_hex).replace("\\x", "").replace("0x", "")
    if len(clean) < 128:
        return (None, 0)
    # Address is in bytes 12-32 of the first 32-byte word (last 20 bytes = 40 hex chars)
    recipient = "0x" + clean[24:64]
    amount_raw = int(clean[64:128], 16)
    return (recipient, amount_raw)


def _identify_warp_route(msg):
    """Identify if a message is a known warp route transfer.

    Returns (token_info, decoded_recipient, amount_raw) or (None, None, 0).
    """
    direction = "outbound" if msg["origin_domain_id"] == HYPERLANE_PLS_DOMAIN else "inbound"

    # For outbound: sender is the PLS warp route contract
    # For inbound: recipient is the PLS warp route contract
    if direction == "outbound":
        pls_contract = _clean_hex(msg.get("sender"))
    else:
        pls_contract = _clean_hex(msg.get("recipient"))

    if not pls_contract:
        return (None, None, 0)

    token_info = PLS_WARP_ROUTES.get(pls_contract)
    if not token_info:
        return (None, None, 0)

    decoded_recipient, amount_raw = _decode_warp_body(msg.get("message_body"))
    return (token_info, decoded_recipient, amount_raw)


def _query_hyperlane(cursor, limit=HYPERLANE_PAGE_SIZE):
    """Query Hyperlane GraphQL API with retry."""
    def _do():
        resp = requests.post(
            HYPERLANE_API_URL,
            json={"query": HYPERLANE_QUERY, "variables": {"cursor": cursor, "limit": limit}},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        if "errors" in data:
            raise Exception(f"Hyperlane API error: {data['errors']}")
        return data["data"]["message_view"]
    return with_retry(_do)


def _get_cursor():
    result = supabase.table("sync_status").select("last_cursor").eq("indexer_name", INDEXER_NAME).single().execute()
    return int(result.data.get("last_cursor") or 0)


def _update_cursor(cursor, count):
    supabase.table("sync_status").update({
        "last_cursor": str(cursor),
        "records_synced": count,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
        "status": "idle",
        "error_message": None,
    }).eq("indexer_name", INDEXER_NAME).execute()


def _set_status(status, error=None):
    supabase.table("sync_status").update({
        "status": status,
        "error_message": error,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("indexer_name", INDEXER_NAME).execute()


def run():
    """Sync Hyperlane messages involving PulseChain."""
    logger.info("Starting Hyperlane bridge sync...")
    _set_status("running")

    cursor = _get_cursor()
    total_synced = 0

    try:
        for page in range(HYPERLANE_SYNC_MAX_PAGES):
            messages = _query_hyperlane(cursor)

            if not messages:
                break

            rows = []
            for msg in messages:
                direction = "outbound" if msg["origin_domain_id"] == HYPERLANE_PLS_DOMAIN else "inbound"
                token_info, decoded_recipient, amount_raw = _identify_warp_route(msg)

                amount_usd = None
                if token_info and amount_raw > 0:
                    amount_usd = amount_raw / (10 ** token_info["decimals"]) * token_info["price_usd"]

                rows.append({
                    "id": msg["id"],
                    "msg_id": _clean_hex(msg.get("msg_id")),
                    "direction": direction,
                    "is_delivered": msg.get("is_delivered", False),
                    "origin_chain_id": msg["origin_domain_id"],
                    "origin_chain_name": CHAIN_NAMES.get(msg["origin_domain_id"], f"chain_{msg['origin_domain_id']}"),
                    "destination_chain_id": msg["destination_domain_id"],
                    "destination_chain_name": CHAIN_NAMES.get(msg["destination_domain_id"], f"chain_{msg['destination_domain_id']}"),
                    "sender_address": _clean_hex(msg.get("sender")),
                    "recipient_address": decoded_recipient or _clean_hex(msg.get("recipient")),
                    "origin_tx_sender": _clean_hex(msg.get("origin_tx_sender")),
                    "origin_tx_hash": _clean_hex(msg.get("origin_tx_hash")),
                    "destination_tx_hash": _clean_hex(msg.get("destination_tx_hash")),
                    "token_symbol": token_info["symbol"] if token_info else None,
                    "token_decimals": token_info["decimals"] if token_info else None,
                    "amount_raw": str(amount_raw) if amount_raw else None,
                    "amount_usd": amount_usd,
                    "send_occurred_at": msg.get("send_occurred_at"),
                    "delivery_occurred_at": msg.get("delivery_occurred_at"),
                    "nonce": msg.get("nonce"),
                })

            if rows:
                supabase.table("hyperlane_transfers").upsert(rows, on_conflict="id").execute()
                total_synced += len(rows)
                cursor = messages[-1]["id"]

            if len(messages) < HYPERLANE_PAGE_SIZE:
                break

            logger.info(f"[{INDEXER_NAME}] Page {page + 1}: {len(messages)} messages (cursor={cursor})")

        _update_cursor(cursor, total_synced)
        logger.info(f"[{INDEXER_NAME}] Synced {total_synced} messages")

    except Exception as e:
        _set_status("error", str(e)[:500])
        raise
