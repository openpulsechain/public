import { useState, useEffect, useRef, useCallback } from 'react'

const CHECK_INTERVAL = 15_000 // 15 seconds
const TIMEOUT_MS = 5_000

export type ServiceStatus = 'operational' | 'degraded' | 'down'

export interface ServiceHealth {
  name: string
  url: string
  endpoint: string
  description: string
  type: 'rpc' | 'subgraph'
  status: ServiceStatus
  latencyMs: number | null
  lastChecked: Date | null
}

export interface RpcHealth {
  services: ServiceHealth[]
  overall: ServiceStatus
  loading: boolean
  /** Fastest operational RPC URL for fallback use */
  bestRpcUrl: string | null
}

function statusFromLatency(latencyMs: number, fastThreshold: number, slowThreshold: number): ServiceStatus {
  if (latencyMs < fastThreshold) return 'operational'
  if (latencyMs < slowThreshold) return 'degraded'
  return 'down'
}

function overallStatus(services: ServiceHealth[]): ServiceStatus {
  if (services.every((s) => s.status === 'down')) return 'down'
  if (services.some((s) => s.status === 'down') || services.some((s) => s.status === 'degraded')) return 'degraded'
  return 'operational'
}

/** Race a promise against a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

interface CheckResult {
  valid: boolean
  latencyMs: number
}

/** Generic RPC health check — validates JSON-RPC response has a hex block number */
async function checkRpc(url: string): Promise<CheckResult> {
  const start = performance.now()
  try {
    const res = await withTimeout(
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      }),
      TIMEOUT_MS
    )
    const json = await res.json()
    const valid = typeof json?.result === 'string' && json.result.startsWith('0x')
    return { valid, latencyMs: performance.now() - start }
  } catch {
    return { valid: false, latencyMs: performance.now() - start }
  }
}

/** Check PulseX Subgraph — validates GraphQL returns a block number */
async function checkSubgraph(url: string): Promise<CheckResult> {
  const start = performance.now()
  try {
    const res = await withTimeout(
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ _meta { block { number } } }' }),
      }),
      TIMEOUT_MS
    )
    const json = await res.json()
    const valid = typeof json?.data?._meta?.block?.number === 'number'
    return { valid, latencyMs: performance.now() - start }
  } catch {
    return { valid: false, latencyMs: performance.now() - start }
  }
}

type ServiceMeta = {
  name: string
  url: string
  endpoint: string
  description: string
  type: 'rpc' | 'subgraph'
  fast: number
  slow: number
}

const SERVICE_META: ServiceMeta[] = [
  { name: 'PulseChain RPC', url: 'rpc.pulsechain.com', endpoint: 'https://rpc.pulsechain.com', description: 'Official PulseChain node', type: 'rpc', fast: 500, slow: 2000 },
  { name: 'G4MM4 RPC', url: 'g4mm4.io', endpoint: 'https://rpc-pulsechain.g4mm4.io', description: 'G4MM4 public node', type: 'rpc', fast: 500, slow: 2000 },
  { name: 'PublicNode RPC', url: 'publicnode.com', endpoint: 'https://pulsechain-rpc.publicnode.com', description: 'PublicNode infrastructure', type: 'rpc', fast: 500, slow: 2000 },
  { name: 'PulseX Subgraph', url: 'graph.pulsechain.com', endpoint: 'https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsexv2', description: 'DEX indexer — prices, swaps, liquidity', type: 'subgraph', fast: 2000, slow: 5000 },
]

export function useRpcHealth(): RpcHealth {
  const [services, setServices] = useState<ServiceHealth[]>(
    SERVICE_META.map((m) => ({
      name: m.name, url: m.url, endpoint: m.endpoint, description: m.description, type: m.type,
      status: 'operational' as ServiceStatus, latencyMs: null, lastChecked: null,
    }))
  )
  const [loading, setLoading] = useState(true)
  const [bestRpcUrl, setBestRpcUrl] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const checkHealth = useCallback(async () => {
    const now = new Date()
    const results = await Promise.all(
      SERVICE_META.map((meta) =>
        meta.type === 'rpc' ? checkRpc(meta.endpoint) : checkSubgraph(meta.endpoint)
      )
    )

    if (!mountedRef.current) return

    const updated: ServiceHealth[] = SERVICE_META.map((meta, i) => {
      const r = results[i]
      return {
        name: meta.name,
        url: meta.url,
        endpoint: meta.endpoint,
        description: meta.description,
        type: meta.type,
        status: r.valid ? statusFromLatency(r.latencyMs, meta.fast, meta.slow) : 'down' as ServiceStatus,
        latencyMs: Math.round(r.latencyMs),
        lastChecked: now,
      }
    })

    // Find fastest operational RPC for fallback
    let bestUrl: string | null = null
    let bestLatency = Infinity
    SERVICE_META.forEach((meta, i) => {
      if (meta.type === 'rpc' && results[i].valid && results[i].latencyMs < bestLatency) {
        bestLatency = results[i].latencyMs
        bestUrl = meta.endpoint
      }
    })

    setServices(updated)
    setBestRpcUrl(bestUrl)
    setLoading(false)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    checkHealth()
    const interval = setInterval(checkHealth, CHECK_INTERVAL)
    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [checkHealth])

  return {
    services,
    overall: overallStatus(services),
    loading,
    bestRpcUrl,
  }
}
