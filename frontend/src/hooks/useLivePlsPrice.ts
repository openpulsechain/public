import { useState, useEffect, useRef } from 'react'

const SCANNER_URL = 'https://scanner.tradingview.com/global/scan'
const WPLS_TICKER = 'PULSEX:WPLSUSDT_322DF7.USD'
const REFRESH_INTERVAL = 5_000 // 5 seconds

export function useLivePlsPrice() {
  const [price, setPrice] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    async function fetchPrice() {
      try {
        const res = await fetch(SCANNER_URL, {
          method: 'POST',
          cache: 'no-store',
          body: JSON.stringify({
            symbols: {
              tickers: [WPLS_TICKER],
              query: { types: [] },
            },
            columns: ['close'],
          }),
        })
        if (!res.ok) return
        const json = await res.json()
        const close = json?.data?.[0]?.d?.[0]
        if (close != null && mountedRef.current) {
          setPrice(close)
          setLoading(false)
        }
      } catch {
        // Silently fail, keep previous price
      }
    }

    fetchPrice()
    const interval = setInterval(fetchPrice, REFRESH_INTERVAL)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [])

  return { price, loading }
}
