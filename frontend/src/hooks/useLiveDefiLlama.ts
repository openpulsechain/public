import { useState, useEffect, useRef } from 'react'

const REFRESH_INTERVAL = 60_000 // 60 seconds (DefiLlama rate limits)

export interface LiveDefiLlama {
  /** TVL for entire PulseChain (all protocols) */
  tvlAll: number | null
  /** TVL for PulseX only (V1+V2+StableSwap) */
  tvlPulsex: number | null
  /** 24h DEX volume for entire PulseChain */
  volumeAll: number | null
  /** 24h DEX volume for PulseX only */
  volumePulsex: number | null
  loading: boolean
}

export function useLiveDefiLlama(): LiveDefiLlama {
  const [data, setData] = useState<Omit<LiveDefiLlama, 'loading'>>({
    tvlAll: null,
    tvlPulsex: null,
    volumeAll: null,
    volumePulsex: null,
  })
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    async function fetchAll() {
      try {
        const [chainsRes, pulsexRes, dexRes] = await Promise.all([
          fetch('https://api.llama.fi/v2/chains').then((r) => r.json()),
          fetch('https://api.llama.fi/protocol/pulsex').then((r) => r.json()),
          fetch('https://api.llama.fi/overview/dexs/PulseChain').then((r) => r.json()),
        ])

        if (!mountedRef.current) return

        // TVL All PulseChain
        const chain = chainsRes?.find?.((c: { name: string }) => c.name === 'PulseChain')
        const tvlAll = chain?.tvl ?? null

        // TVL PulseX (V1+V2+StableSwap combined by DefiLlama)
        const tvlPulsex = pulsexRes?.currentChainTvls?.PulseChain ?? null

        // Volume All DEX
        const volumeAll = dexRes?.total24h ?? null

        // Volume PulseX: sum PulseX V1 + V2 + StableSwap from protocol breakdown
        let volumePulsex: number | null = null
        const protocols = dexRes?.protocols ?? []
        const pulsexVolume = protocols
          .filter((p: { name: string }) =>
            p.name.toLowerCase().includes('pulsex')
          )
          .reduce((sum: number, p: { total24h?: number }) => sum + (p.total24h ?? 0), 0)
        if (pulsexVolume > 0) volumePulsex = pulsexVolume

        setData({ tvlAll, tvlPulsex, volumeAll, volumePulsex })
        setLoading(false)
      } catch {
        // Silently fail, keep previous values
      }
    }

    fetchAll()
    const interval = setInterval(fetchAll, REFRESH_INTERVAL)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [])

  return { ...data, loading }
}
