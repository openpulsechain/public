"""Network snapshot indexer — fetches gas price and block data from PulseChain RPC."""

import logging
from datetime import datetime, timezone

import requests

from db import supabase
from config import RPC_URL
from utils.retry import with_retry

logger = logging.getLogger(__name__)


def _rpc_call(method, params=None):
    """Make a JSON-RPC call to PulseChain."""
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params or [],
        "id": 1,
    }
    resp = with_retry(lambda: requests.post(RPC_URL, json=payload, timeout=15))
    data = resp.json()
    if "error" in data:
        raise Exception(f"RPC error: {data['error']}")
    return data.get("result")


def run():
    logger.info("Fetching network snapshot from PulseChain RPC...")

    supabase.table("sync_status").update({
        "status": "running",
    }).eq("indexer_name", "network_snapshot").execute()

    try:
        # Get latest block
        block = _rpc_call("eth_getBlockByNumber", ["latest", False])
        gas_price_hex = _rpc_call("eth_gasPrice")

        block_number = int(block["number"], 16)
        base_fee = int(block.get("baseFeePerGas", "0x0"), 16) / 1e9  # gwei
        gas_price = int(gas_price_hex, 16) / 1e9  # gwei

        supabase.table("network_snapshots").insert({
            "block_number": block_number,
            "gas_price_gwei": round(gas_price, 4),
            "base_fee_gwei": round(base_fee, 4),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }).execute()

        supabase.table("sync_status").update({
            "status": "idle",
            "last_synced_at": datetime.now(timezone.utc).isoformat(),
            "records_synced": 1,
            "error_message": None,
        }).eq("indexer_name", "network_snapshot").execute()

        logger.info(f"Snapshot: block {block_number}, gas {gas_price:.4f} gwei, baseFee {base_fee:.4f} gwei")

    except Exception as e:
        supabase.table("sync_status").update({
            "status": "error",
            "error_message": str(e)[:500],
        }).eq("indexer_name", "network_snapshot").execute()
        raise
