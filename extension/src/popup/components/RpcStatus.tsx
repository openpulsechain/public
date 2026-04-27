import { useState, useEffect, useRef } from 'react'

const PULSEX_V2_SUBGRAPH = 'https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsexv2'
const CHECK_INTERVAL = 15_000
const TIMEOUT_MS = 5_000

type Status = 'operational' | 'degraded' | 'down'

interface Service {
  name: string
  description: string
  status: Status
  latencyMs: number | null
}

const RPC_NODES = [
  { name: 'PulseChain RPC', url: 'https://rpc.pulsechain.com', description: 'Official node' },
  { name: 'G4MM4 RPC', url: 'https://rpc-pulsechain.g4mm4.io', description: 'G4MM4 node' },
  { name: 'PublicNode RPC', url: 'https://pulsechain-rpc.publicnode.com', description: 'PublicNode' },
] as const

function statusFromLatency(ms: number, fast: number, slow: number): Status {
  if (ms < fast) return 'operational'
  if (ms < slow) return 'degraded'
  return 'down'
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
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

const LABELS: Record<Status, string> = {
  operational: 'Statuts',
  degraded: 'Statuts',
  down: 'Statuts',
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

export function RpcStatus() {
  const [services, setServices] = useState<Service[]>([])
  const [open, setOpen] = useState(false)
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
          description: node.description,
          status: rpcResults[i].valid ? statusFromLatency(rpcResults[i].ms, 500, 2000) : 'down' as Status,
          latencyMs: Math.round(rpcResults[i].ms),
        })),
        {
          name: 'PulseX Subgraph',
          description: 'DEX indexer',
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

  if (!services.length) return null

  const overall: Status = services.every(s => s.status === 'down') ? 'down'
    : services.some(s => s.status === 'down' || s.status === 'degraded') ? 'degraded' : 'operational'

  const rpcSvcs = services.filter(s => !s.name.includes('Subgraph'))
  const indexerSvcs = services.filter(s => s.name.includes('Subgraph'))
  const rpcUp = rpcSvcs.filter(s => s.status === 'operational').length

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-md hover:bg-white/5 transition-colors"
        title={LABELS[overall]}
      >
        <Dot status={overall} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-60 rounded-lg border border-white/10 bg-gray-900/95 backdrop-blur-md shadow-xl p-3">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Dot status={overall} />
              <span className="text-[11px] font-medium text-white">{LABELS[overall]}</span>
            </div>

            {/* RPC Nodes */}
            <div className="mb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">RPC Nodes</span>
                <span className="text-[9px] text-gray-500">{rpcUp}/{rpcSvcs.length}</span>
              </div>
              <div className="space-y-1.5">
                {rpcSvcs.map(s => (
                  <div key={s.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Dot status={s.status} />
                      <span className="text-[10px] text-gray-300">{s.name}</span>
                    </div>
                    <span className={`text-[10px] font-mono ${
                      (s.latencyMs ?? 9999) < 500 ? 'text-emerald-400' : (s.latencyMs ?? 9999) < 2000 ? 'text-amber-400' : 'text-red-400'
                    }`}>{s.latencyMs ?? '--'}ms</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Indexers */}
            <div className="mb-2 pt-2 border-t border-white/5">
              <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Indexers</span>
              {indexerSvcs.map(s => (
                <div key={s.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Dot status={s.status} />
                    <span className="text-[10px] text-gray-300">{s.name}</span>
                  </div>
                  <span className={`text-[10px] font-mono ${
                    (s.latencyMs ?? 9999) < 2000 ? 'text-emerald-400' : (s.latencyMs ?? 9999) < 5000 ? 'text-amber-400' : 'text-red-400'
                  }`}>{s.latencyMs ?? '--'}ms</span>
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="pt-2 border-t border-white/5 space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400 shrink-0" />
                <span className="text-[9px] text-gray-500"><span className="text-emerald-400">OK</span></span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-flex rounded-full h-1.5 w-1.5 bg-amber-400 shrink-0" />
                <span className="text-[9px] text-gray-500"><span className="text-amber-400">Slow</span></span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-flex rounded-full h-1.5 w-1.5 bg-red-500 shrink-0" />
                <span className="text-[9px] text-gray-500"><span className="text-red-400">Down</span></span>
              </div>
            </div>

            <div className="mt-1.5 pt-1.5 border-t border-white/5">
              <span className="text-[9px] text-gray-600">Every 15s</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
