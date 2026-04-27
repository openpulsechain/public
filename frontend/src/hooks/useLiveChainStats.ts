import { useState, useEffect, useRef } from 'react'

const PULSECHAIN_RPC = 'https://rpc.pulsechain.com'
const REFRESH_INTERVAL = 5_000 // 5 seconds

interface ChainStats {
  blockNumber: number
  gasPriceGwei: number
  baseFeeGwei: number
}

export function useLiveChainStats() {
  const [stats, setStats] = useState<ChainStats | null>(null)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    async function fetchStats() {
      try {
        const [blockRes, gasRes] = await Promise.all([
          fetch(PULSECHAIN_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
          }),
          fetch(PULSECHAIN_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 2 }),
          }),
        ])

        const [blockJson, gasJson] = await Promise.all([blockRes.json(), gasRes.json()])

        if (!mountedRef.current) return

        const blockNumber = parseInt(blockJson.result, 16)
        const gasPriceWei = parseInt(gasJson.result, 16)
        const gasPriceGwei = gasPriceWei / 1e9

        // Fetch the block to get baseFeePerGas
        const blockDetailRes = await fetch(PULSECHAIN_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_getBlockByNumber',
            params: [blockJson.result, false],
            id: 3,
          }),
        })
        const blockDetail = await blockDetailRes.json()

        if (!mountedRef.current) return

        const baseFeeWei = parseInt(blockDetail.result?.baseFeePerGas || '0', 16)
        const baseFeeGwei = baseFeeWei / 1e9

        setStats({ blockNumber, gasPriceGwei, baseFeeGwei })
        setLoading(false)
      } catch {
        // Silently fail, keep previous stats
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, REFRESH_INTERVAL)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [])

  return { stats, loading }
}
