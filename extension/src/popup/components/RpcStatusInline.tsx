import { useState, useEffect, useRef } from 'react'

const PULSEX_V2_SUBGRAPH = 'https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsexv2'
const CHECK_INTERVAL = 15_000
const TIMEOUT_MS = 5_000

type Status = 'operational' | 'degraded' | 'down'

interface Service {
  name: string
  url: string
  isRpc: boolean
  status: Status
  latencyMs: number | null
}

const RPC_NODES = [
  { name: 'PulseChain RPC', url: 'https://rpc.pulsechain.com' },
  { name: 'G4MM4', url: 'https://rpc-pulsechain.g4mm4.io' },
  { name: 'PublicNode', url: 'https://pulsechain-rpc.publicnode.com' },
] as const

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

function statusFromLatency(ms: number, fast: number, slow: number): Status {
  if (ms < fast) return 'operational'
  if (ms < slow) return 'degraded'
  return 'down'
}

async function checkRpc(url: string): Promise<{ valid: boolean; ms: number }> {
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
    return { valid: typeof json?.result === 'string' && json.result.startsWith('0x'), ms: performance.now() - start }
  } catch {
    return { valid: false, ms: performance.now() - start }
  }
}

async function checkSubgraph(): Promise<{ valid: boolean; ms: number }> {
  const start = performance.now()
  try {
    const res = await withTimeout(
      fetch(PULSEX_V2_SUBGRAPH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ _meta { block { number } } }' }),
      }),
      TIMEOUT_MS
    )
    const json = await res.json()
    return { valid: typeof json?.data?._meta?.block?.number === 'number', ms: performance.now() - start }
  } catch {
    return { valid: false, ms: performance.now() - start }
  }
}

const COLORS: Record<Status, string> = {
  operational: 'bg-emerald-400',
  degraded: 'bg-amber-400',
  down: 'bg-red-500',
}

function Dot({ status }: { status: Status }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {status !== 'operational' && (
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${COLORS[status]} opacity-75`} />
      )}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${COLORS[status]}`} />
    </span>
  )
}

export function RpcStatusInline() {
  const [services, setServices] = useState<Service[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    async function run() {
      const rpcResults = await Promise.all(RPC_NODES.map((n) => checkRpc(n.url)))
      const sgResult = await checkSubgraph()
      if (!mountedRef.current) return

      const svcs: Service[] = [
        ...RPC_NODES.map((node, i) => ({
          name: node.name,
          url: node.url,
          isRpc: true,
          status: rpcResults[i].valid ? statusFromLatency(rpcResults[i].ms, 500, 2000) : 'down' as Status,
          latencyMs: Math.round(rpcResults[i].ms),
        })),
        {
          name: 'PulseX Subgraph',
          url: PULSEX_V2_SUBGRAPH,
          isRpc: false,
          status: sgResult.valid ? statusFromLatency(sgResult.ms, 2000, 5000) : 'down',
          latencyMs: Math.round(sgResult.ms),
        },
      ]
      setServices(svcs)
    }

    run()
    const id = setInterval(run, CHECK_INTERVAL)
    return () => { mountedRef.current = false; clearInterval(id) }
  }, [])

  if (!services.length) {
    return (
      <div className="flex justify-center py-3">
        <span className="text-[10px] text-gray-500">Checking...</span>
      </div>
    )
  }

  const hasRpcDown = services.some((s) => s.isRpc && s.status === 'down')
  const workingRpcs = services.filter((s) => s.isRpc && s.status !== 'down')

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url)
    setCopied(url)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-1.5">
        {services.map((svc) => (
          <div
            key={svc.name}
            className="bg-gray-800/30 rounded-lg p-2.5 border border-white/5 flex items-center justify-between"
          >
            <div className="flex items-center gap-1.5">
              <Dot status={svc.status} />
              <span className="text-[10px] font-medium text-white truncate">{svc.name}</span>
            </div>
            <span className={`text-[10px] font-mono ${
              (svc.latencyMs ?? 9999) < 500 ? 'text-emerald-400' : (svc.latencyMs ?? 9999) < 2000 ? 'text-amber-400' : 'text-red-400'
            }`}>
              {svc.latencyMs ?? '--'}ms
            </span>
          </div>
        ))}
      </div>

      {hasRpcDown && workingRpcs.length > 0 && (
        <div className="mt-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
          <p className="text-[9px] text-amber-400 mb-1.5">RPC down — copy an alternative for your wallet:</p>
          <div className="space-y-1">
            {workingRpcs.map((svc) => (
              <button
                key={svc.url}
                onClick={() => copyUrl(svc.url)}
                className="w-full flex items-center justify-between px-2 py-1 rounded bg-white/5 hover:bg-white/10 transition-colors"
              >
                <span className="text-[9px] font-mono text-gray-300 truncate">{svc.url}</span>
                <span className="text-[9px] text-gray-500 shrink-0 ml-1">
                  {copied === svc.url ? 'Copied!' : 'Copy'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
