"""Bulk backfill token price history from PulseX subgraph.

Fetches tokenDayDatas per token using ThreadPoolExecutor for parallelism.
Upserts are idempotent — safe to re-run.
"""

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import requests
from db import supabase

PULSEX_SUBGRAPH = "https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex"
PAGE_SIZE = 1000
MAX_PAGES = 20
WORKERS = 5


def get_all_tokens():
    """Get all token addresses from pulsechain_tokens (paginated)."""
    tokens = []
    offset = 0
    while True:
        res = supabase.table("pulsechain_tokens") \
            .select("address,symbol") \
            .range(offset, offset + 999) \
            .execute()
        if not res.data:
            break
        tokens.extend(res.data)
        if len(res.data) < 1000:
            break
        offset += 1000
    return tokens


def fetch_token_history(address, symbol):
    """Fetch all tokenDayDatas for a single token from subgraph."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    all_rows = []
    last_date = 0

    for _ in range(MAX_PAGES):
        query = f"""{{
            tokenDayDatas(
                first: {PAGE_SIZE},
                where: {{token: "{address}", date_gt: {last_date}}},
                orderBy: date,
                orderDirection: asc
            ) {{
                date
                priceUSD
                dailyVolumeUSD
                totalLiquidityUSD
            }}
        }}"""

        try:
            resp = requests.post(PULSEX_SUBGRAPH, json={"query": query}, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            if "errors" in data:
                break
            day_datas = data["data"].get("tokenDayDatas", [])
        except Exception:
            break

        if not day_datas:
            break

        for dd in day_datas:
            ts = int(dd["date"])
            date_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
            if date_str > today:
                continue
            price = float(dd.get("priceUSD", 0))
            if price <= 0:
                continue
            all_rows.append({
                "address": address,
                "date": date_str,
                "price_usd": price,
                "daily_volume_usd": float(dd.get("dailyVolumeUSD", 0)),
                "total_liquidity_usd": float(dd.get("totalLiquidityUSD", 0)),
                "source": "pulsex_subgraph",
            })

        last_date = day_datas[-1]["date"]
        if len(day_datas) < PAGE_SIZE:
            break
        time.sleep(0.2)

    return symbol, all_rows


def upsert_batch(rows):
    """Upsert rows to Supabase in chunks of 500."""
    for i in range(0, len(rows), 500):
        chunk = rows[i:i+500]
        try:
            supabase.table("token_price_history").upsert(
                chunk, on_conflict="address,date"
            ).execute()
        except Exception as e:
            print(f"  Upsert error: {e}")
            time.sleep(2)


def main():
    all_tokens = get_all_tokens()
    print(f"Total tokens: {len(all_tokens)}", flush=True)

    total_records = 0
    done = 0
    start = time.time()

    # Process in batches of WORKERS
    for batch_start in range(0, len(all_tokens), WORKERS):
        batch = all_tokens[batch_start:batch_start + WORKERS]

        with ThreadPoolExecutor(max_workers=WORKERS) as executor:
            futures = {
                executor.submit(fetch_token_history, t["address"], t["symbol"]): t
                for t in batch
            }

            for future in as_completed(futures):
                symbol, rows = future.result()
                done += 1
                if rows:
                    upsert_batch(rows)
                    total_records += len(rows)

                if done % 10 == 0 or rows:
                    elapsed = time.time() - start
                    rate = done / elapsed if elapsed > 0 else 0
                    remaining = (len(all_tokens) - done) / rate if rate > 0 else 0
                    msg = f"  [{done}/{len(all_tokens)}] "
                    if rows:
                        msg += f"{symbol}: {len(rows)} days | "
                    msg += f"Total: {total_records} | Rate: {rate:.1f} tok/s | ETA: {remaining/60:.0f}min"
                    print(msg, flush=True)

        time.sleep(0.3)

    elapsed = time.time() - start
    print(f"\nDone! {total_records} records for {done} tokens in {elapsed/60:.1f} minutes", flush=True)


if __name__ == "__main__":
    main()
