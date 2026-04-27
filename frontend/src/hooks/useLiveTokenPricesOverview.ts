import { useState, useEffect, useRef } from 'react'

export interface LiveTokenPrice {
  token_address: string
  token_symbol: string | null
  price_usd: number | null
  price_change_24h: number | null
  market_cap_usd: number | null
  total_volume_24h_usd: number | null
  total_liquidity_usd: number | null
  last_updated: string
  chart_url: string
}

// Token config: address, TradingView ticker, TradingView chart link
// tvTicker is optional — tokens without it use DexScreener for price data
const TOKEN_CONFIG = [
  {
    address: '0xa1077a294dde1b09bb078844df40758a5d0f9a27',
    symbol: 'WPLS',
    tvTicker: 'PULSEX:WPLSUSDT_322DF7.USD',
    chartUrl: 'https://dexscreener.com/pulsechain/0xE56043671df55dE5CDf8459710433C10324DE0aE',
  },
  {
    address: '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39',
    symbol: 'HEX',
    tvTicker: 'PULSEX:HEXWPLS_F1F4EE.USD',
    chartUrl: 'https://dexscreener.com/pulsechain/0xf1F4ee610b2bAbB05C635F726eF8B0C568c8dc65',
  },
  {
    address: '0x95b303987a60c71504d99aa1b13b4da07b0790ab',
    symbol: 'PLSX',
    tvTicker: 'PULSEX:PLSXDAI_B2893C.USD',
    chartUrl: 'https://dexscreener.com/pulsechain/0x1b45b9148791d3a104184Cd5DFE5CE57193a3ee9',
  },
  {
    address: '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d',
    symbol: 'INC',
    tvTicker: 'PULSEX:INCWPLS_F808BB.USD',
    chartUrl: 'https://dexscreener.com/pulsechain/0x7Dbeca4c74d01cd8782D4EF5C05C0769723fb0ea',
  },
  {
    address: '0xf6f8db0aba00007681f8faf16a0fda1c9b030b11',
    symbol: 'PRVX',
    chartUrl: 'https://dexscreener.com/pulsechain/0x7f681a5ad615238357ba148c281e2eaefd2de55a',
  },
]

const SCANNER_URL = 'https://scanner.tradingview.com/global/scan'

/**
 * Fetch core PulseChain token prices from TradingView Scanner API.
 * Single POST request for all 4 tokens, high precision (10-16 sig figs).
 * Polls every 5 seconds for near-real-time data.
 * Market cap from DexScreener (TradingView Scanner returns null for PulseX pairs).
 */
export function useLiveTokenPricesOverview() {
  const [data, setData] = useState<LiveTokenPrice[]>([])
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Cache DexScreener market cap data (refreshed less frequently)
  const mcapCache = useRef<Map<string, { mcap: number | null; volume: number | null; liquidity: number | null; price: number | null; priceChange24h: number | null }>>(new Map())
  const mcapLastFetch = useRef(0)

  useEffect(() => {
    let cancelled = false

    const fetchMcap = async () => {
      // Refresh DexScreener data every 60s for market cap, volume, liquidity
      const now = Date.now()
      if (now - mcapLastFetch.current < 60_000 && mcapCache.current.size > 0) return

      try {
        const addresses = TOKEN_CONFIG.map((t) => t.address)
        const results = await Promise.all(
          addresses.map(async (addr) => {
            const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`)
            if (!res.ok) return null
            const json = await res.json()
            const pairs = (json.pairs || []).filter(
              (p: any) => p.chainId === 'pulsechain' && p.baseToken.address.toLowerCase() === addr.toLowerCase()
            )
            if (pairs.length === 0) return null
            // Best pair by liquidity for mcap
            pairs.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))
            const best = pairs[0]
            const totalVolume = pairs.reduce((s: number, p: any) => s + (p.volume?.h24 ?? 0), 0)
            const totalLiquidity = pairs.reduce((s: number, p: any) => s + (p.liquidity?.usd ?? 0), 0)
            return {
              address: addr,
              mcap: best.marketCap ?? best.fdv ?? null,
              volume: totalVolume,
              liquidity: totalLiquidity,
              price: best.priceUsd ? parseFloat(best.priceUsd) : null,
              priceChange24h: best.priceChange?.h24 ? parseFloat(best.priceChange.h24) : null,
            }
          })
        )
        for (const r of results) {
          if (r) mcapCache.current.set(r.address, { mcap: r.mcap, volume: r.volume, liquidity: r.liquidity, price: r.price, priceChange24h: r.priceChange24h })
        }
        mcapLastFetch.current = now
      } catch {
        // Keep cached data
      }
    }

    const fetchPrices = async () => {
      try {
        const tvTokens = TOKEN_CONFIG.filter((t) => 'tvTicker' in t && t.tvTicker)
        const scannerRes = await fetch(SCANNER_URL, {
          method: 'POST',
          cache: 'no-store',
          body: JSON.stringify({
            symbols: {
              tickers: tvTokens.map((t) => t.tvTicker),
              query: { types: [] },
            },
            columns: ['close', 'change', 'volume'],
          }),
        })

        if (!scannerRes.ok) throw new Error(`Scanner ${scannerRes.status}`)
        const json = await scannerRes.json()

        if (!cancelled && json.data?.length > 0) {
          const results: LiveTokenPrice[] = []

          for (const item of json.data) {
            const ticker = item.s as string
            const config = tvTokens.find((t) => t.tvTicker === ticker)
            if (!config) continue

            const [close, change, volume] = item.d as [number | null, number | null, number | null]
            const cached = mcapCache.current.get(config.address)

            results.push({
              token_address: config.address,
              token_symbol: config.symbol,
              price_usd: close,
              price_change_24h: change,
              market_cap_usd: cached?.mcap ?? null,
              total_volume_24h_usd: cached?.volume ?? (volume ?? null),
              total_liquidity_usd: cached?.liquidity ?? null,
              last_updated: new Date().toISOString(),
              chart_url: config.chartUrl,
            })
          }

          // Append DexScreener-only tokens (no TradingView ticker)
          for (const config of TOKEN_CONFIG.filter((t) => !('tvTicker' in t && t.tvTicker))) {
            const cached = mcapCache.current.get(config.address)
            if (cached) {
              results.push({
                token_address: config.address,
                token_symbol: config.symbol,
                price_usd: cached.price,
                price_change_24h: cached.priceChange24h,
                market_cap_usd: cached.mcap,
                total_volume_24h_usd: cached.volume,
                total_liquidity_usd: cached.liquidity,
                last_updated: new Date().toISOString(),
                chart_url: config.chartUrl,
              })
            }
          }

          if (results.length > 0) {
            results.sort((a, b) => (b.total_volume_24h_usd ?? 0) - (a.total_volume_24h_usd ?? 0))
            setData(results)
          }
        }
      } catch {
        // Silently fail — keep previous data
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const fetchAll = async () => {
      // DexScreener first so PRVX cache is ready when fetchPrices runs
      await fetchMcap()
      await fetchPrices()
    }

    fetchAll()
    intervalRef.current = setInterval(fetchPrices, 5_000)
    // DexScreener mcap refresh every 60s (separate timer)
    const mcapTimer = setInterval(fetchMcap, 60_000)

    return () => {
      cancelled = true
      if (intervalRef.current) clearInterval(intervalRef.current)
      clearInterval(mcapTimer)
    }
  }, [])

  return { data, loading }
}
