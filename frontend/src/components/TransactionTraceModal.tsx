import { useState, useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  Position,
  MarkerType,
  Handle,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import ELK from 'elkjs/lib/elk.bundled.js'
import { X, Loader2, Copy, Check, ExternalLink, ArrowDown, ArrowRight, Map as MapIcon, Info } from 'lucide-react'
import { shortenAddress } from '../lib/format'

const SAFETY_API = import.meta.env.VITE_SAFETY_API_URL || 'https://safety.openpulsechain.com'
const SCAN_URL = 'https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#'

// ── Types ────────────────────────────────────────────────────

interface TraceNode {
  id: string
  label: string
  is_contract: boolean
  type: string // Wallet, Contract, Bridge, DEX, Burn, Validator
}

interface TraceEdge {
  id: string
  source: string
  target: string
  value_pls: number
  token_amount?: number
  token_symbol?: string
  type: string // main, internal, token_transfer
  method: string
}

interface TraceData {
  tx_hash: string
  block: number
  timestamp: string
  status: string
  method: string
  from: string
  to: string
  value_pls: number
  gas_used: string
  nodes: TraceNode[]
  edges: TraceEdge[]
}

// ── Node colors ──────────────────────────────────────────────

const NODE_COLORS: Record<string, string> = {
  Wallet: '#a855f7',
  Contract: '#10b981',
  Bridge: '#3b82f6',
  DEX: '#f97316',
  Burn: '#ef4444',
  Validator: '#06b6d4',
}

const EDGE_COLORS: Record<string, string> = {
  main: '#fbbf24',
  internal: '#6b7280',
  token_transfer: '#3b82f6',
}

// ── ELK Layout ───────────────────────────────────────────────

const elk = new ELK()

type LayoutDirection = 'DOWN' | 'RIGHT'

async function layoutGraph(
  nodes: Node[],
  edges: Edge[],
  direction: LayoutDirection = 'DOWN',
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.spacing.nodeNode': '50',
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: nodes.map((n) => ({
      id: n.id,
      width: 220,
      height: 60,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  }

  const layout = await elk.layout(elkGraph)

  const positionedNodes = nodes.map((n) => {
    const elkNode = layout.children?.find((c) => c.id === n.id)
    // Update handles position based on direction so arrows come from the
    // correct edge of the node (top/bottom for DOWN, left/right for RIGHT).
    const targetPosition = direction === 'DOWN' ? Position.Top : Position.Left
    const sourcePosition = direction === 'DOWN' ? Position.Bottom : Position.Right
    return {
      ...n,
      position: { x: elkNode?.x ?? 0, y: elkNode?.y ?? 0 },
      targetPosition,
      sourcePosition,
      data: { ...n.data, handleDirection: direction },
    }
  })

  return { nodes: positionedNodes, edges }
}

// ── Custom Node ──────────────────────────────────────────────

function TraceNodeComponent({ data }: { data: Record<string, unknown> }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(data.address as string)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [data.address])

  const color = NODE_COLORS[(data.nodeType as string) || 'Wallet'] || '#6b7280'
  const isFrom = data.isFrom as boolean
  const isTo = data.isTo as boolean
  const direction = (data.handleDirection as LayoutDirection) || 'DOWN'
  const targetPos = direction === 'DOWN' ? Position.Top : Position.Left
  const sourcePos = direction === 'DOWN' ? Position.Bottom : Position.Right
  const execIdx = data.execIdx as number | undefined
  const clusterCount = data.clusterCount as number | undefined

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg max-w-[260px]"
      style={{
        background: '#111118',
        borderColor: isFrom || isTo ? color : '#333',
        borderWidth: isFrom || isTo ? 2 : 1,
      }}
    >
      <Handle type="target" position={targetPos} style={{ background: color }} />

      <div className="flex items-center gap-1.5 mb-1 whitespace-nowrap">
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ background: color }}
        />
        {execIdx != null && (
          <span className="text-[9px] text-zinc-500 font-mono flex-shrink-0">#{execIdx}</span>
        )}
        <span className="font-medium text-white">
          {(data.label as string) || shortenAddress(data.address as string)}
        </span>
        {clusterCount != null && clusterCount > 1 && (
          <span className="text-[9px] px-1 py-0 rounded-full bg-white/10 border border-white/15 text-zinc-300 flex-shrink-0">
            ×{clusterCount}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 text-zinc-400">
        <span className="font-mono text-[10px]">{shortenAddress(data.address as string)}</span>
        <button onClick={handleCopy} className="hover:text-white transition-colors">
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
        </button>
        <a
          href={`${SCAN_URL}/address/${data.address || ''}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white transition-colors ml-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <Handle type="source" position={sourcePos} style={{ background: color }} />
    </div>
  )
}

const nodeTypes = { trace: TraceNodeComponent }

// ── Format edge label ────────────────────────────────────────
// Dust threshold — values below this are considered noise (internal calls
// propagating near-zero values, rounding artifacts). Above it, we show the
// amount. The method name is shown alongside when present and meaningful.

const DUST_THRESHOLD_PLS = 0.01
const DUST_THRESHOLD_TOKEN = 0.0001

function formatAmount(amount: number, unit: string): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M ${unit}`
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K ${unit}`
  if (amount >= 1) return `${amount.toFixed(2)} ${unit}`
  return `${amount.toFixed(4)} ${unit}`
}

function formatEdgeLabel(edge: TraceEdge): string {
  const parts: string[] = []

  // Amount (only if above dust)
  if (edge.type === 'token_transfer' && edge.token_amount && edge.token_amount >= DUST_THRESHOLD_TOKEN) {
    parts.push(formatAmount(edge.token_amount, edge.token_symbol || 'token'))
  } else if (edge.value_pls >= DUST_THRESHOLD_PLS) {
    parts.push(formatAmount(edge.value_pls, 'PLS'))
  }

  // Method (keep it when meaningful — 'call' is generic, hide it)
  if (edge.method && edge.method !== 'call' && edge.method !== '') {
    parts.push(edge.method)
  }

  return parts.length > 0 ? parts.join(' · ') : ''
}

// ── Main Component ───────────────────────────────────────────

interface Props {
  txHash: string
  onClose: () => void
}

export default function TransactionTraceModal({ txHash, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [traceData, setTraceData] = useState<TraceData | null>(null)
  const [flowNodes, setFlowNodes] = useState<Node[]>([])
  const [flowEdges, setFlowEdges] = useState<Edge[]>([])

  // UX controls
  const [direction, setDirection] = useState<LayoutDirection>('DOWN')
  const [showMain, setShowMain] = useState(true)
  const [showInternal, setShowInternal] = useState(true)
  const [showToken, setShowToken] = useState(true)
  const [hideDust, setHideDust] = useState(true)
  const [groupClusters, setGroupClusters] = useState(true)
  const [showMinimap, setShowMinimap] = useState(true)
  const [showLegend, setShowLegend] = useState(true)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  // Fetch trace data
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`${SAFETY_API}/api/v1/tx/${txHash}/trace`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: TraceData) => {
        if (cancelled) return
        setTraceData(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [txHash])

  // Cluster nodes that share the same label + type (e.g. 3× "PulseX LP")
  // into a single super-node with a count badge. This reduces visual noise
  // on traces that touch the same contract multiple times.
  const clusteredData = useMemo(() => {
    if (!traceData) return null
    const emptyMap: Map<string, string> = new Map()
    if (!groupClusters) return { nodes: traceData.nodes, edges: traceData.edges, clusterMap: emptyMap }

    const clusterMap: Map<string, string> = new Map() // original id → cluster id
    const clusterMembers: Map<string, string[]> = new Map() // cluster id → member original ids
    const keyToClusterId: Map<string, string> = new Map() // label|type → first member id (used as cluster id)

    for (const n of traceData.nodes) {
      // Never cluster the from/to nodes — always keep them distinct
      if (n.id === traceData.from || n.id === traceData.to) {
        clusterMap.set(n.id, n.id)
        clusterMembers.set(n.id, [n.id])
        continue
      }
      const key = `${n.label}|${n.type}`
      const existing = keyToClusterId.get(key)
      if (existing) {
        clusterMap.set(n.id, existing)
        clusterMembers.get(existing)!.push(n.id)
      } else {
        keyToClusterId.set(key, n.id)
        clusterMap.set(n.id, n.id)
        clusterMembers.set(n.id, [n.id])
      }
    }

    const clusteredNodes = traceData.nodes
      .filter(n => clusterMap.get(n.id) === n.id) // keep only representative
      .map(n => ({ ...n, _clusterCount: clusterMembers.get(n.id)!.length }))

    const clusteredEdges = traceData.edges.map(e => ({
      ...e,
      source: clusterMap.get(e.source) || e.source,
      target: clusterMap.get(e.target) || e.target,
    })).filter(e => e.source !== e.target) // drop self-loops created by clustering

    return { nodes: clusteredNodes, edges: clusteredEdges, clusterMap }
  }, [traceData, groupClusters])

  // Build React Flow graph from (clustered) trace data + filters
  useEffect(() => {
    if (!clusteredData || clusteredData.nodes.length === 0) return
    let cancelled = false

    const execIdxByNodeId: Map<string, number> = new Map()
    clusteredData.nodes.forEach((n, i) => { execIdxByNodeId.set(n.id, i) })

    const rfNodes: Node[] = clusteredData.nodes.map((n) => ({
      id: n.id,
      type: 'trace',
      position: { x: 0, y: 0 },
      data: {
        address: n.id,
        label: n.label,
        nodeType: n.type,
        isFrom: n.id === traceData!.from,
        isTo: n.id === traceData!.to,
        txHash: traceData!.tx_hash,
        execIdx: execIdxByNodeId.get(n.id),
        clusterCount: (n as TraceNode & { _clusterCount?: number })._clusterCount,
      },
    }))

    const filteredEdges = clusteredData.edges.filter((e) => {
      if (e.type === 'main' && !showMain) return false
      if (e.type === 'internal' && !showInternal) return false
      if (e.type === 'token_transfer' && !showToken) return false
      if (hideDust) {
        if (e.type === 'token_transfer' && (!e.token_amount || e.token_amount < DUST_THRESHOLD_TOKEN)) return false
        if (e.type !== 'token_transfer' && e.value_pls < DUST_THRESHOLD_PLS && (!e.method || e.method === 'call')) return false
      }
      return true
    })

    const rfEdges: Edge[] = filteredEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: formatEdgeLabel(e),
      animated: e.type === 'main',
      style: { stroke: EDGE_COLORS[e.type] || '#6b7280', strokeWidth: e.type === 'main' ? 2 : 1 },
      labelStyle: { fill: '#d4d4d8', fontSize: 10 },
      labelBgStyle: { fill: '#111118', fillOpacity: 0.8 },
      labelBgPadding: [4, 2] as [number, number],
      markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS[e.type] || '#6b7280', width: 16, height: 16 },
    }))

    // Apply ELK layout with cancel flag to avoid setState after unmount
    layoutGraph(rfNodes, rfEdges, direction).then(({ nodes, edges }) => {
      if (cancelled) return
      setFlowNodes(nodes)
      setFlowEdges(edges)
    })

    return () => { cancelled = true }
  }, [clusteredData, traceData, direction, showMain, showInternal, showToken, hideDust])

  // Summary info
  const summary = useMemo(() => {
    if (!traceData) return null
    const internalCount = traceData.edges.filter((e) => e.type === 'internal').length
    const tokenCount = traceData.edges.filter((e) => e.type === 'token_transfer').length
    return { internalCount, tokenCount, nodeCount: traceData.nodes.length }
  }, [traceData])

  // Aggregated data for selected node (sidebar inspector)
  const selectedNodeDetail = useMemo(() => {
    if (!selectedNodeId || !traceData) return null
    const node = traceData.nodes.find(n => n.id === selectedNodeId)
    if (!node) return null
    const incoming = traceData.edges.filter(e => e.target === selectedNodeId)
    const outgoing = traceData.edges.filter(e => e.source === selectedNodeId)
    const totalIn = incoming.reduce((sum, e) => sum + (e.value_pls || 0), 0)
    const totalOut = outgoing.reduce((sum, e) => sum + (e.value_pls || 0), 0)
    return { node, incoming, outgoing, totalIn, totalOut }
  }, [selectedNodeId, traceData])

  const handleNodeClick = useCallback((_e: React.MouseEvent, n: Node) => {
    setSelectedNodeId(n.id === selectedNodeId ? null : n.id)
  }, [selectedNodeId])

  const toggleBtn = (active: boolean) =>
    `text-[10px] px-2 py-1 rounded border transition-colors ${
      active
        ? 'bg-white/10 border-white/20 text-white'
        : 'bg-transparent border-zinc-700 text-zinc-500 hover:text-zinc-300'
    }`

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0d0d14] border border-zinc-800 rounded-xl w-[95vw] h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-white">Transaction Trace</h2>
            <span className="font-mono text-xs text-zinc-400">
              {txHash.slice(0, 10)}...{txHash.slice(-8)}
            </span>
            {traceData && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  traceData.status === 'ok'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'
                }`}
              >
                {traceData.status === 'ok' ? 'Success' : 'Failed'}
              </span>
            )}
            {summary && (
              <div className="flex gap-2 text-[10px] text-zinc-500">
                <span>{summary.nodeCount} addresses</span>
                <span>{summary.internalCount} internal</span>
                <span>{summary.tokenCount} token transfers</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`${SCAN_URL}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-zinc-400 hover:text-white flex items-center gap-1"
            >
              Scan <ExternalLink className="w-3 h-3" />
            </a>
            <button onClick={onClose} className="text-zinc-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Toolbar — filters + layout + display toggles */}
        <div className="flex items-center flex-wrap gap-3 px-4 py-2 border-b border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider mr-1">Edges:</span>
            <button className={toggleBtn(showMain)} onClick={() => setShowMain(v => !v)}>
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 mr-1 align-middle" />Main
            </button>
            <button className={toggleBtn(showInternal)} onClick={() => setShowInternal(v => !v)}>
              <span className="inline-block w-2 h-2 rounded-full bg-zinc-500 mr-1 align-middle" />Internal
            </button>
            <button className={toggleBtn(showToken)} onClick={() => setShowToken(v => !v)}>
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1 align-middle" />Token
            </button>
            <button className={toggleBtn(hideDust)} onClick={() => setHideDust(v => !v)} title="Hide calls below 0.01 PLS / 0.0001 tokens">
              Dust
            </button>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider mr-1">Group:</span>
            <button className={toggleBtn(groupClusters)} onClick={() => setGroupClusters(v => !v)} title="Merge identical contracts into one node with count">
              Contracts
            </button>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider mr-1">Layout:</span>
            <button className={toggleBtn(direction === 'DOWN')} onClick={() => setDirection('DOWN')} title="Vertical layout">
              <ArrowDown className="w-3 h-3" />
            </button>
            <button className={toggleBtn(direction === 'RIGHT')} onClick={() => setDirection('RIGHT')} title="Horizontal layout">
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <button className={toggleBtn(showMinimap)} onClick={() => setShowMinimap(v => !v)} title="Toggle minimap">
              <MapIcon className="w-3 h-3" />
            </button>
            <button className={toggleBtn(showLegend)} onClick={() => setShowLegend(v => !v)} title="Toggle legend">
              <Info className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 relative flex overflow-hidden">
          {/* Graph */}
          <div className="flex-1 relative">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
              </div>
            )}

            {error && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-red-400 text-sm">Failed to load trace: {error}</p>
              </div>
            )}

            {!loading && !error && flowNodes.length > 0 && (
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.1}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
                onNodeClick={handleNodeClick}
                onPaneClick={() => setSelectedNodeId(null)}
                style={{ background: '#0a0a10' }}
              >
                <Background color="#1a1a2e" gap={20} />
                <Controls
                  showInteractive={false}
                  style={{ background: '#1a1a2e', borderColor: '#333' }}
                />
                {showMinimap && (
                  <MiniMap
                    nodeColor={(n) => NODE_COLORS[n.data?.nodeType as string] || '#6b7280'}
                    style={{ background: '#111118', borderColor: '#333' }}
                  />
                )}
              </ReactFlow>
            )}

            {!loading && !error && flowNodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-zinc-500 text-sm">No trace data available for this transaction</p>
              </div>
            )}
          </div>

          {/* Sidebar inspector — opens on node click */}
          {selectedNodeDetail && (
            <aside className="w-80 flex-shrink-0 border-l border-zinc-800 bg-[#0d0d14] overflow-y-auto">
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: NODE_COLORS[selectedNodeDetail.node.type] || '#6b7280' }}
                      />
                      <h3 className="text-sm font-semibold text-white truncate">
                        {selectedNodeDetail.node.label || shortenAddress(selectedNodeDetail.node.id)}
                      </h3>
                    </div>
                    <div className="text-[10px] text-zinc-500 uppercase">{selectedNodeDetail.node.type}</div>
                    <div className="font-mono text-[10px] text-zinc-400 mt-1 break-all">{selectedNodeDetail.node.id}</div>
                  </div>
                  <button onClick={() => setSelectedNodeId(null)} className="text-zinc-500 hover:text-white flex-shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <a
                  href={`${SCAN_URL}/address/${selectedNodeDetail.node.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#00D4FF] hover:underline flex items-center gap-1"
                >
                  View on PulseScan <ExternalLink className="w-3 h-3" />
                </a>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-2">
                    <div className="text-[10px] text-zinc-500 uppercase">In</div>
                    <div className="text-xs font-semibold text-emerald-400">{selectedNodeDetail.incoming.length} edges</div>
                    <div className="text-[10px] text-zinc-400">{formatAmount(selectedNodeDetail.totalIn, 'PLS')}</div>
                  </div>
                  <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-2">
                    <div className="text-[10px] text-zinc-500 uppercase">Out</div>
                    <div className="text-xs font-semibold text-orange-400">{selectedNodeDetail.outgoing.length} edges</div>
                    <div className="text-[10px] text-zinc-400">{formatAmount(selectedNodeDetail.totalOut, 'PLS')}</div>
                  </div>
                </div>

                {selectedNodeDetail.incoming.length > 0 && (
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase mb-1">Incoming</div>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {selectedNodeDetail.incoming.map((e, i) => (
                        <div key={i} className="text-[10px] text-zinc-400 font-mono bg-zinc-900/50 rounded px-1.5 py-1">
                          ← {shortenAddress(e.source)} · {formatEdgeLabel(e) || e.method || '-'}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedNodeDetail.outgoing.length > 0 && (
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase mb-1">Outgoing</div>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {selectedNodeDetail.outgoing.map((e, i) => (
                        <div key={i} className="text-[10px] text-zinc-400 font-mono bg-zinc-900/50 rounded px-1.5 py-1">
                          → {shortenAddress(e.target)} · {formatEdgeLabel(e) || e.method || '-'}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>

        {/* Legend (toggleable) */}
        {showLegend && (
          <div className="flex items-center gap-4 px-4 py-2 border-t border-zinc-800 flex-shrink-0 text-[10px] text-zinc-500">
            {Object.entries(NODE_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                {type}
              </div>
            ))}
            <div className="mx-2 h-3 border-l border-zinc-700" />
            <div className="flex items-center gap-1">
              <div className="w-4 h-0.5 bg-yellow-400" /> Main
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-0.5 bg-zinc-500" /> Internal
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-0.5 bg-blue-500" /> Token
            </div>
            <div className="mx-2 h-3 border-l border-zinc-700" />
            <div className="text-zinc-600">Click a node for details · Toolbar controls filters & layout</div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
