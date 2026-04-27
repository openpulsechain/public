import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRpcHealth, type ServiceStatus } from '../../hooks/useRpcHealth'
import { useTranslation } from '../../i18n'

const STATUS_CONFIG: Record<ServiceStatus, { color: string; ping: string; label: string }> = {
  operational: { color: 'bg-emerald-400', ping: 'bg-emerald-400', label: 'Status' },
  degraded: { color: 'bg-amber-400', ping: 'bg-amber-400', label: 'Status' },
  down: { color: 'bg-red-500', ping: 'bg-red-500', label: 'Status' },
}

function StatusDot({ status }: { status: ServiceStatus }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {status !== 'operational' && (
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.ping} opacity-75`} />
      )}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${cfg.color}`} />
    </span>
  )
}

function LatencyBadge({ ms }: { ms: number | null }) {
  if (ms === null) return <span className="text-gray-600">--</span>
  const color = ms < 500 ? 'text-emerald-400' : ms < 2000 ? 'text-amber-400' : 'text-red-400'
  return <span className={`text-[11px] font-mono ${color}`}>{ms}ms</span>
}

export function RpcStatusIndicator() {
  const { t } = useTranslation()
  const { services, overall, loading, bestRpcUrl } = useRpcHealth()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const copyUrl = useCallback((url: string) => {
    navigator.clipboard.writeText(url)
    setCopied(url)
    setTimeout(() => setCopied(null), 2000)
  }, [])

  const cfg = STATUS_CONFIG[overall]

  if (loading) return null

  const rect = btnRef.current?.getBoundingClientRect()

  // Split services into RPC nodes vs indexers
  const rpcServices = services.filter((s) => s.type === 'rpc')
  const indexerServices = services.filter((s) => s.type === 'subgraph')
  const rpcUp = rpcServices.filter((s) => s.status === 'operational').length
  const rpcTotal = rpcServices.length
  const hasRpcDown = rpcServices.some((s) => s.status === 'down')
  const workingRpcs = rpcServices.filter((s) => s.status !== 'down')

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-white/5 transition-colors"
        title={cfg.label}
      >
        <StatusDot status={overall} />
        <span className="text-[11px] text-gray-400 hidden sm:inline">{t.rpc.status}</span>
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[9999] w-80 rounded-xl border border-white/10 bg-gray-950 shadow-2xl p-4"
            style={{
              top: rect ? rect.bottom + 8 : 50,
              right: rect ? window.innerWidth - rect.right : 16,
            }}
          >
            {/* Header */}
            <div className="flex items-center gap-2 mb-4">
              <StatusDot status={overall} />
              <span className="text-sm font-medium text-white">{t.rpc.status}</span>
            </div>

            {/* RPC Nodes */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{t.rpc.rpc_nodes}</span>
                <span className="text-[10px] text-gray-500">{rpcUp}/{rpcTotal} {t.rpc.online}</span>
              </div>
              <div className="space-y-2">
                {rpcServices.map((svc) => (
                  <div key={svc.name}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StatusDot status={svc.status} />
                        <span className="text-xs font-medium text-gray-200">{svc.name}</span>
                      </div>
                      <LatencyBadge ms={svc.latencyMs} />
                    </div>
                    <p className="text-[10px] text-gray-500 ml-[18px] mt-0.5">{svc.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Indexers */}
            <div className="mb-3 pt-3 border-t border-white/5">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2 block">{t.rpc.indexers}</span>
              <div className="space-y-2">
                {indexerServices.map((svc) => (
                  <div key={svc.name}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StatusDot status={svc.status} />
                        <span className="text-xs font-medium text-gray-200">{svc.name}</span>
                      </div>
                      <LatencyBadge ms={svc.latencyMs} />
                    </div>
                    <p className="text-[10px] text-gray-500 ml-[18px] mt-0.5">{svc.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Alternative RPCs when one is down */}
            {hasRpcDown && workingRpcs.length > 0 && (
              <div className="mb-3 pt-3 border-t border-white/5">
                <p className="text-[10px] font-medium text-amber-400 mb-2">{t.rpc.switch_rpc}</p>
                <div className="space-y-1.5">
                  {workingRpcs.map((svc) => (
                    <button
                      key={svc.endpoint}
                      onClick={() => copyUrl(svc.endpoint)}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <StatusDot status={svc.status} />
                        <span className="text-[11px] font-mono text-gray-300 truncate">{svc.endpoint}</span>
                      </div>
                      <span className="text-[10px] text-gray-500 group-hover:text-[#00D4FF] shrink-0 ml-2">
                        {copied === svc.endpoint ? t.common.copied : t.rpc.copy}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-gray-600 mt-1.5">{t.rpc.metamask_instructions}</p>
              </div>
            )}

            {/* Best RPC indicator (when all are up) */}
            {!hasRpcDown && bestRpcUrl && (
              <div className="mb-3 pt-3 border-t border-white/5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-500">{t.rpc.fastest_rpc}</span>
                  <span className="text-[10px] font-mono text-emerald-400">{bestRpcUrl.replace('https://', '')}</span>
                </div>
              </div>
            )}

            {/* Legend */}
            <div className="pt-3 border-t border-white/5 space-y-1.5">
              <p className="text-[10px] font-medium text-gray-400 mb-1.5">{t.rpc.status_legend}</p>
              <div className="flex items-center gap-2">
                <span className="inline-flex rounded-full h-2 w-2 bg-emerald-400 shrink-0" />
                <span className="text-[10px] text-gray-400"><span className="text-emerald-400">{t.rpc.operational}</span> — {t.rpc.operational_desc}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex rounded-full h-2 w-2 bg-amber-400 shrink-0" />
                <span className="text-[10px] text-gray-400"><span className="text-amber-400">{t.rpc.degraded}</span> — {t.rpc.degraded_desc}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex rounded-full h-2 w-2 bg-red-500 shrink-0" />
                <span className="text-[10px] text-gray-400"><span className="text-red-400">{t.rpc.down}</span> — {t.rpc.down_desc}</span>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-3 pt-2 border-t border-white/5">
              <span className="text-[10px] text-gray-600">
                {t.rpc.auto_check} {services[0]?.lastChecked?.toLocaleTimeString() || '--'}
              </span>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
