"""Database operations for token safety scores."""
from __future__ import annotations

import json
import logging
from typing import Optional
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

logger = logging.getLogger(__name__)

# Write client — service_role bypasses RLS, used ONLY for upserts/inserts.
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# Read client — anon key respects RLS, used for all public-facing reads.
# Falls back to service_role if anon key is not configured (backward compat).
supabase_public = create_client(SUPABASE_URL, SUPABASE_ANON_KEY) if SUPABASE_ANON_KEY else supabase


def save_score(analysis: dict) -> bool:
    """Save or update a token safety score in Supabase."""
    try:
        # Clamp numeric values to avoid overflow (NUMERIC(8,2) max = 999999.99)
        def clamp(val, max_val=999999.99):
            if val is None:
                return None
            return min(float(val), max_val)

        scam = analysis.get("scam_analysis") or {}

        row = {
            "token_address": analysis["address"],
            "score": analysis["score"],
            "grade": analysis["grade"],
            "risks": analysis["risks"],
            "honeypot_score": analysis["honeypot"]["score"],
            "is_honeypot": analysis["honeypot"]["is_honeypot"],
            "buy_tax_pct": clamp(analysis["honeypot"]["buy_tax_pct"]),
            "sell_tax_pct": clamp(analysis["honeypot"]["sell_tax_pct"]),
            "contract_score": analysis["contract"]["score"],
            "is_verified": analysis["contract"]["is_verified"],
            "is_proxy": analysis["contract"]["is_proxy"],
            "ownership_renounced": analysis["contract"]["ownership_renounced"],
            "has_mint": analysis["contract"]["has_mint"],
            "has_blacklist": analysis["contract"]["has_blacklist"],
            "contract_dangers": analysis["contract"]["dangers"],
            "lp_score": analysis["lp"]["score"],
            "has_lp": analysis["lp"]["has_lp"],
            "total_liquidity_usd": clamp(analysis["lp"]["total_liquidity_usd"], 9999999999999999.99),
            "pair_count": analysis["lp"]["pair_count"],
            "recent_burns_24h": analysis["lp"]["recent_burns_24h"],
            "holders_score": analysis["holders"]["score"],
            "holder_count": analysis["holders"]["holder_count"],
            "top10_pct": clamp(analysis["holders"]["top10_pct"]),
            "top1_pct": clamp(analysis["holders"]["top1_pct"]),
            "age_score": analysis["age"].get("score", 0),
            "age_days": clamp(analysis["age"].get("age_days", 0), 9999999.9),
            "scam_score": scam.get("scam_score"),
            "scam_risk_level": scam.get("risk_level"),
            "analysis_details": json.dumps({
                "honeypot": analysis["honeypot"],
                "contract": analysis["contract"],
                "lp": analysis["lp"],
                "holders": analysis["holders"],
                "age": analysis["age"],
                "scam_analysis": analysis.get("scam_analysis"),
                "category": analysis.get("category", "new"),
            }),
            "analyzed_at": analysis["analyzed_at"],
        }

        # Upsert (insert or update on conflict)
        supabase.table("token_safety_scores").upsert(
            row,
            on_conflict="token_address"
        ).execute()

        logger.info(f"Saved score for {analysis['address']}: {analysis['score']}/100")
        return True

    except Exception as e:
        logger.error(f"Failed to save score for {analysis['address']}: {e}")
        return False


def get_score(token_address: str) -> Optional[dict]:
    """Get cached safety score for a token."""
    try:
        result = supabase.table("token_safety_scores").select("*").eq(
            "token_address", token_address.lower()
        ).execute()
        return result.data[0] if result.data else None
    except Exception as e:
        logger.error(f"Failed to get score for {token_address}: {e}")
        return None


def get_all_tokens_to_analyze() -> list:
    """Get list of active token addresses to analyze (paginated to bypass PostgREST 1000-row limit)."""
    try:
        all_addresses: list[str] = []
        offset = 0
        page_size = 1000
        while True:
            result = supabase.table("pulsechain_tokens").select("address").eq(
                "is_active", True
            ).range(offset, offset + page_size - 1).execute()
            rows = result.data or []
            all_addresses.extend(r["address"] for r in rows)
            if len(rows) < page_size:
                break
            offset += page_size
        logger.info(f"Total active tokens to analyze: {len(all_addresses)}")
        return all_addresses
    except Exception as e:
        logger.error(f"Failed to get token list: {e}")
        return []
