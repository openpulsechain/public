import { useState, useEffect, useRef } from 'react'

const PULSEX_V1_SUBGRAPH = 'https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex'
const PULSEX_V2_SUBGRAPH = 'https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsexv2'
const REFRESH_INTERVAL = 30_000 // 30 seconds

const QUERY = `{
  pulseXFactories(first: 1) {
    totalLiquidityUSD
    totalVolumeUSD
    totalTransactions
  }
}`

export interface LivePulsexFactory {
  /** V1 + V2 combined */
  totalLiquidityUSD: number | null
  totalVolumeUSD: number | null
  totalTransactions: number | null
  /** Individual values for educational note */
  v1LiquidityUSD: number | null
  v2LiquidityUSD: number | null
  v1VolumeUSD: number | null
  v2VolumeUSD: number | null
  v1Transactions: number | null
  v2Transactions: number | null
  loading: boolean
}

function parseFactory(json: unknown): { liq: number; vol: number; txs: number } | null {
  const factory = (json as { data?: { pulseXFactories?: Array<Record<string, string>> } })?.data?.pulseXFactories?.[0]
  if (!factory) return null
  return {
    liq: factory.totalLiquidityUSD ? parseFloat(factory.totalLiquidityUSD) : 0,
    vol: factory.totalVolumeUSD ? parseFloat(factory.totalVolumeUSD) : 0,
    txs: factory.totalTransactions ? parseInt(factory.totalTransactions) : 0,
  }
}

export function useLivePulsexFactory(): LivePulsexFactory {
  const [data, setData] = useState<Omit<LivePulsexFactory, 'loading'>>({
    totalLiquidityUSD: null, totalVolumeUSD: null, totalTransactions: null,
    v1LiquidityUSD: null, v2LiquidityUSD: null,
    v1VolumeUSD: null, v2VolumeUSD: null,
    v1Transactions: null, v2Transactions: null,
  })
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    async function fetchFactory() {
      try {
        const opts = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: QUERY }),
        }
        const [v1Res, v2Res] = await Promise.all([
          fetch(PULSEX_V1_SUBGRAPH, opts).then((r) => r.json()),
          fetch(PULSEX_V2_SUBGRAPH, opts).then((r) => r.json()),
        ])

        if (!mountedRef.current) return

        const v1 = parseFactory(v1Res)
        const v2 = parseFactory(v2Res)

        if (v1 || v2) {
          setData({
            totalLiquidityUSD: (v1?.liq ?? 0) + (v2?.liq ?? 0),
            totalVolumeUSD: (v1?.vol ?? 0) + (v2?.vol ?? 0),
            totalTransactions: (v1?.txs ?? 0) + (v2?.txs ?? 0),
            v1LiquidityUSD: v1?.liq ?? null,
            v2LiquidityUSD: v2?.liq ?? null,
            v1VolumeUSD: v1?.vol ?? null,
            v2VolumeUSD: v2?.vol ?? null,
            v1Transactions: v1?.txs ?? null,
            v2Transactions: v2?.txs ?? null,
          })
          setLoading(false)
        }
      } catch {
        // Silently fail, keep previous values
      }
    }

    fetchFactory()
    const interval = setInterval(fetchFactory, REFRESH_INTERVAL)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [])

  return { ...data, loading }
}
