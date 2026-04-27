import { useMemo, useState } from 'react'
import { ArrowLeftRight, Info, ChevronDown, ExternalLink, Copy, Check } from 'lucide-react'
import { ShareButton } from '../ui/ShareButton'
import { AreaChartComponent } from '../charts/AreaChart'
import { BarChartComponent } from '../charts/BarChart'
import { Spinner } from '../ui/Spinner'
import { TimeRangeSelector } from '../ui/TimeRangeSelector'
import { usePulsexDailyStats, usePulsexTopPairs, usePulsexDefillamaTvl, usePulsexDefillamaVolume, useNetworkTvl, useNetworkDexVolume } from '../../hooks/useSupabase'
import { useLivePulsexFactory } from '../../hooks/useLivePulsexFactory'
import { useLiveDefiLlama } from '../../hooks/useLiveDefiLlama'
import { formatUsd, formatNumber } from '../../lib/format'
import { useTranslation } from '../../i18n'

type DexSource = 'v1' | 'pulsex' | 'all'


function DexSourceSelector({ value, onChange }: { value: DexSource; onChange: (v: DexSource) => void }) {
  const { t } = useTranslation()
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as DexSource)}
        className="appearance-none bg-white/5 border border-white/10 rounded-lg px-3 py-1 pr-7 text-xs text-gray-300 cursor-pointer hover:bg-white/10 transition-colors focus:outline-none focus:border-[#00D4FF]/50"
      >
        <option value="v1">{t.dex.source_v1}</option>
        <option value="pulsex">{t.dex.source_pulsex}</option>
        <option value="all">{t.dex.source_all}</option>
      </select>
      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
    </div>
  )
}

function DexDataSourceNote({ liveFactory }: { liveFactory: ReturnType<typeof useLivePulsexFactory> }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
      >
        <Info className="h-3 w-3" />
        <span>{t.dex.metrics_info}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-2 rounded-lg bg-white/5 border border-white/10 p-4 text-xs text-gray-400 space-y-4">
          <div className="rounded bg-gray-800/50 border border-white/5 p-3">
            <p className="text-gray-300 font-medium mb-1">{t.dex.kpis_title}</p>
            <p>{t.dex.kpis_desc}</p>
          </div>

          <p>{t.dex.kpis_source_desc}</p>

          {/* Liquidity comparison */}
          <div>
            <p className="font-medium text-gray-300 mb-2">{t.dex.liquidity_comparison}</p>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="py-1 pr-3 text-gray-500 font-medium">{t.dex.table_source}</th>
                  <th className="py-1 pr-3 text-right text-gray-500 font-medium">{t.dex.table_liquidity}</th>
                  <th className="py-1 text-gray-500 font-medium">{t.dex.table_scope}</th>
                </tr>
              </thead>
              <tbody className="text-gray-400">
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">{t.dex.source_v1_raw}</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">{liveFactory.v1LiquidityUSD != null ? formatUsd(liveFactory.v1LiquidityUSD) : '$31.74M'}</td>
                  <td className="py-1">{t.dex.scope_v1}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">{t.dex.source_v2_raw}</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">{liveFactory.v2LiquidityUSD != null ? formatUsd(liveFactory.v2LiquidityUSD) : '$20.59M'}</td>
                  <td className="py-1">{t.dex.scope_v2}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3 font-medium text-emerald-400">{t.dex.source_combined}</td>
                  <td className="py-1 pr-3 text-right font-mono text-emerald-400">{liveFactory.totalLiquidityUSD != null ? formatUsd(liveFactory.totalLiquidityUSD) : '$52.33M'}</td>
                  <td className="py-1">{t.dex.scope_raw_subgraph_combined}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-3">DefiLlama &quot;PulseX&quot;</td>
                  <td className="py-1 pr-3 text-right font-mono text-gray-300">~$48.79M</td>
                  <td className="py-1">{t.dex.scope_defillama_pulsex}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Volume comparison */}
          <div>
            <p className="font-medium text-gray-300 mb-2">{t.dex.alltime_volume_comparison}</p>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="py-1 pr-3 text-gray-500 font-medium">{t.dex.table_source}</th>
                  <th className="py-1 pr-3 text-right text-gray-500 font-medium">{t.dex.table_volume}</th>
                  <th className="py-1 text-gray-500 font-medium">{t.dex.table_scope}</th>
                </tr>
              </thead>
              <tbody className="text-gray-400">
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">Subgraph V1</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">{liveFactory.v1VolumeUSD != null ? formatUsd(liveFactory.v1VolumeUSD) : '$19.4B'}</td>
                  <td className="py-1">{t.dex.scope_v1_total}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">Subgraph V2</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">{liveFactory.v2VolumeUSD != null ? formatUsd(liveFactory.v2VolumeUSD) : '$7.1B'}</td>
                  <td className="py-1">{t.dex.scope_v2_total}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3 font-medium text-emerald-400">{t.dex.source_combined}</td>
                  <td className="py-1 pr-3 text-right font-mono text-emerald-400">{liveFactory.totalVolumeUSD != null ? formatUsd(liveFactory.totalVolumeUSD) : '$26.4B'}</td>
                  <td className="py-1">{t.dex.scope_subgraph_combined}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-3">DefiLlama V1</td>
                  <td className="py-1 pr-3 text-right font-mono text-gray-300">~$19.35B</td>
                  <td className="py-1">{t.dex.scope_very_close_v1}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Transactions comparison */}
          <div>
            <p className="font-medium text-gray-300 mb-2">{t.dex.transaction_count}</p>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="py-1 pr-3 text-gray-500 font-medium">{t.dex.table_source}</th>
                  <th className="py-1 pr-3 text-right text-gray-500 font-medium">{t.dex.table_transactions}</th>
                  <th className="py-1 text-gray-500 font-medium">{t.dex.table_note}</th>
                </tr>
              </thead>
              <tbody className="text-gray-400">
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">Subgraph V1</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">{liveFactory.v1Transactions != null ? formatNumber(liveFactory.v1Transactions) : '79.5M'}</td>
                  <td className="py-1">{t.dex.scope_swaps_adds_removes}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">Subgraph V2</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">{liveFactory.v2Transactions != null ? formatNumber(liveFactory.v2Transactions) : '201.3M'}</td>
                  <td className="py-1">{t.dex.scope_v2_more_activity}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-3 font-medium text-emerald-400">{t.dex.source_combined}</td>
                  <td className="py-1 pr-3 text-right font-mono text-emerald-400">{liveFactory.totalTransactions != null ? formatNumber(liveFactory.totalTransactions) : '280.9M'}</td>
                  <td className="py-1">{t.dex.scope_total_pulsex_activity}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 30D Volume note */}
          <div className="rounded bg-emerald-500/5 border border-emerald-500/15 p-2.5 text-[11px]">
            <p className="text-emerald-400 font-medium mb-1">{t.dex.about_30d_volume_title}</p>
            <p className="text-gray-400">
              {t.dex.about_30d_volume_desc.split('{code}')[0]}<code className="text-gray-300 mx-1">pulsexDayDatas</code>{t.dex.about_30d_volume_desc.split('{code}')[1]}
            </p>
          </div>

          <div className="rounded bg-blue-500/5 border border-blue-500/15 p-2.5 text-[11px]">
            <p className="text-blue-400 font-medium mb-1">{t.dex.subgraph_differ_title}</p>
            <p className="text-gray-400">
              {t.dex.subgraph_differ_desc.split('{reserveUSD}')[0]}
              <code className="text-gray-300 mx-1">reserveUSD</code>
              {t.dex.subgraph_differ_desc.split('{reserveUSD}')[1].split('{totalLiquidityUSD}')[0]}
              <code className="text-gray-300 mx-1">totalLiquidityUSD</code>
              {t.dex.subgraph_differ_desc.split('{totalLiquidityUSD}')[1]}
            </p>
          </div>

          <p className="text-[10px] text-gray-600">
            {t.common.disclaimer}
          </p>
        </div>
      )}
    </div>
  )
}

function ChartDataSourceNote({ source }: { source: DexSource }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
      >
        <Info className="h-3 w-3" />
        <span>{t.dex.about_data_source}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-2 rounded-lg bg-white/5 border border-white/10 p-4 text-xs text-gray-400 space-y-3">
          <div className="rounded bg-gray-800/50 border border-white/5 p-3">
            <p className="text-gray-300 font-medium mb-1">{t.dex.chart_what_title}</p>
            <p>
              The <strong className="text-gray-300">{t.dex.chart_what_desc_liquidity}</strong> {t.dex.chart_what_desc_liquidity_text}
              {' '}The <strong className="text-gray-300">{t.dex.chart_what_desc_volume}</strong> {t.dex.chart_what_desc_volume_text}
              {' '}{t.dex.chart_what_desc_suffix}
            </p>
          </div>

          {source === 'v1' && (
            <>
              <p className="font-medium text-gray-300">{t.dex.source_v1_full}</p>
              <p>
                {t.dex.source_v1_desc_1.split('{code}')[0]}<code className="text-gray-300">pulsexDayDatas</code>{t.dex.source_v1_desc_1.split('{code}')[1]}
              </p>
              <p>
                {t.dex.source_v1_desc_2}
              </p>
            </>
          )}
          {source === 'pulsex' && (
            <>
              <p className="font-medium text-gray-300">{t.dex.source_pulsex_full}</p>
              <p>
                {t.dex.source_pulsex_desc}
              </p>
            </>
          )}
          {source === 'all' && (
            <>
              <p className="font-medium text-gray-300">{t.dex.source_all_full}</p>
              <p>
                {t.dex.source_all_desc}
              </p>
            </>
          )}

          {/* Cross-source daily comparison table */}
          <div>
            <p className="font-medium text-gray-300 mb-2">{t.dex.daily_volume_comparison}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="py-1 pr-3 text-gray-500 font-medium">{t.dex.table_date}</th>
                    <th className="py-1 pr-3 text-right text-gray-500 font-medium">{t.dex.table_v1_subgraph}</th>
                    <th className="py-1 pr-3 text-right text-gray-500 font-medium">{t.dex.table_v2_subgraph}</th>
                    <th className="py-1 pr-3 text-right text-gray-500 font-medium">{t.dex.table_v1v2_raw}</th>
                    <th className="py-1 pr-3 text-right text-gray-500 font-medium">{t.dex.table_defillama_pulsex}</th>
                    <th className="py-1 text-right text-gray-500 font-medium">{t.dex.table_defillama_all}</th>
                  </tr>
                </thead>
                <tbody className="text-gray-400 font-mono text-[11px]">
                  <tr className="border-b border-white/5">
                    <td className="py-1 pr-3 font-sans">05/03</td>
                    <td className="py-1 pr-3 text-right">$3.18M</td>
                    <td className="py-1 pr-3 text-right">$1.94M</td>
                    <td className="py-1 pr-3 text-right text-white">$5.12M</td>
                    <td className="py-1 pr-3 text-right text-emerald-400">$5.67M</td>
                    <td className="py-1 text-right text-[#00D4FF]">$6.52M</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1 pr-3 font-sans">06/03</td>
                    <td className="py-1 pr-3 text-right">$2.63M</td>
                    <td className="py-1 pr-3 text-right">$1.51M</td>
                    <td className="py-1 pr-3 text-right text-white">$4.14M</td>
                    <td className="py-1 pr-3 text-right text-emerald-400">$4.65M</td>
                    <td className="py-1 text-right text-[#00D4FF]">$5.37M</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1 pr-3 font-sans">07/03</td>
                    <td className="py-1 pr-3 text-right">$2.11M</td>
                    <td className="py-1 pr-3 text-right">$1.31M</td>
                    <td className="py-1 pr-3 text-right text-white">$3.42M</td>
                    <td className="py-1 pr-3 text-right text-emerald-400">$3.71M</td>
                    <td className="py-1 text-right text-[#00D4FF]">$4.26M</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1 pr-3 font-sans">08/03</td>
                    <td className="py-1 pr-3 text-right">$1.66M</td>
                    <td className="py-1 pr-3 text-right">$1.15M</td>
                    <td className="py-1 pr-3 text-right text-white">$2.81M</td>
                    <td className="py-1 pr-3 text-right text-emerald-400">$3.10M</td>
                    <td className="py-1 text-right text-[#00D4FF]">$3.44M</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1 pr-3 font-sans">09/03</td>
                    <td className="py-1 pr-3 text-right">$1.91M</td>
                    <td className="py-1 pr-3 text-right">$1.34M</td>
                    <td className="py-1 pr-3 text-right text-white">$3.25M</td>
                    <td className="py-1 pr-3 text-right text-emerald-400">$3.36M</td>
                    <td className="py-1 text-right text-[#00D4FF]">$3.84M</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1 pr-3 font-sans">10/03</td>
                    <td className="py-1 pr-3 text-right">$1.93M</td>
                    <td className="py-1 pr-3 text-right">$1.66M</td>
                    <td className="py-1 pr-3 text-right text-white">$3.59M</td>
                    <td className="py-1 pr-3 text-right text-emerald-400">$3.96M</td>
                    <td className="py-1 text-right text-[#00D4FF]">$4.42M</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Liquidity daily comparison */}
          <div>
            <p className="font-medium text-gray-300 mb-2">{t.dex.daily_liquidity_comparison}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="py-1 pr-3 text-gray-500 font-medium">{t.dex.table_date}</th>
                    <th className="py-1 pr-3 text-right text-gray-500 font-medium">{t.dex.table_v1_subgraph}</th>
                    <th className="py-1 pr-3 text-right text-gray-500 font-medium">{t.dex.table_v2_subgraph}</th>
                    <th className="py-1 pr-3 text-right text-gray-500 font-medium">{t.dex.table_v1v2_raw}</th>
                    <th className="py-1 text-right text-gray-500 font-medium">{t.dex.table_defillama_pulsex}</th>
                  </tr>
                </thead>
                <tbody className="text-gray-400 font-mono text-[11px]">
                  <tr className="border-b border-white/5">
                    <td className="py-1 pr-3 font-sans">05/03</td>
                    <td className="py-1 pr-3 text-right">$28.4M</td>
                    <td className="py-1 pr-3 text-right">$19.9M</td>
                    <td className="py-1 pr-3 text-right text-white">$48.4M</td>
                    <td className="py-1 text-right text-emerald-400">$46.6M</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1 pr-3 font-sans">06/03</td>
                    <td className="py-1 pr-3 text-right">$26.5M</td>
                    <td className="py-1 pr-3 text-right">$18.2M</td>
                    <td className="py-1 pr-3 text-right text-white">$44.6M</td>
                    <td className="py-1 text-right text-emerald-400">$42.6M</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1 pr-3 font-sans">07/03</td>
                    <td className="py-1 pr-3 text-right">$28.2M</td>
                    <td className="py-1 pr-3 text-right">$19.5M</td>
                    <td className="py-1 pr-3 text-right text-white">$47.7M</td>
                    <td className="py-1 text-right text-emerald-400">$45.5M</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1 pr-3 font-sans">08/03</td>
                    <td className="py-1 pr-3 text-right">$28.8M</td>
                    <td className="py-1 pr-3 text-right">$19.7M</td>
                    <td className="py-1 pr-3 text-right text-white">$48.5M</td>
                    <td className="py-1 text-right text-emerald-400">$46.2M</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1 pr-3 font-sans">09/03</td>
                    <td className="py-1 pr-3 text-right">$30.9M</td>
                    <td className="py-1 pr-3 text-right">$20.6M</td>
                    <td className="py-1 pr-3 text-right text-white">$51.5M</td>
                    <td className="py-1 text-right text-emerald-400">$48.9M</td>
                  </tr>
                  <tr className="border-b border-white/5">
                    <td className="py-1 pr-3 font-sans">10/03</td>
                    <td className="py-1 pr-3 text-right">$32.5M</td>
                    <td className="py-1 pr-3 text-right">$20.9M</td>
                    <td className="py-1 pr-3 text-right text-white">$53.4M</td>
                    <td className="py-1 text-right text-emerald-400">$49.8M</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* DefiLlama PulseX breakdown */}
          <div>
            <p className="font-medium text-gray-300 mb-2">{t.dex.defillama_pulsex_breakdown}</p>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="py-1 pr-3 text-gray-500 font-medium">{t.dex.table_sub_protocol}</th>
                  <th className="py-1 pr-3 text-right text-gray-500 font-medium">{t.dex.table_24h_volume}</th>
                  <th className="py-1 text-right text-gray-500 font-medium">{t.dex.table_share}</th>
                </tr>
              </thead>
              <tbody className="text-gray-400">
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">PulseX V1</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">$1,927,333</td>
                  <td className="py-1 text-right">48.7%</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">PulseX V2</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">$1,658,644</td>
                  <td className="py-1 text-right">41.9%</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">PulseX StableSwap</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">$371,084</td>
                  <td className="py-1 text-right">9.4%</td>
                </tr>
                <tr className="border-t border-white/10 font-medium">
                  <td className="py-1 pr-3 text-gray-300">Total PulseX</td>
                  <td className="py-1 pr-3 text-right font-mono text-emerald-400">$3,957,061</td>
                  <td className="py-1 text-right text-emerald-400">100%</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* All PulseChain DEX protocols */}
          <div>
            <p className="font-medium text-gray-300 mb-2">{t.dex.all_dex_protocols}</p>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="py-1 pr-3 text-gray-500 font-medium">{t.dex.table_protocol}</th>
                  <th className="py-1 pr-3 text-right text-gray-500 font-medium">{t.dex.table_24h_volume}</th>
                  <th className="py-1 text-right text-gray-500 font-medium">{t.dex.table_7d_volume}</th>
                </tr>
              </thead>
              <tbody className="text-gray-400">
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">PulseX V1</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">$1,747,186</td>
                  <td className="py-1 text-right font-mono">$16,608,916</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">PulseX V2</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">$1,615,579</td>
                  <td className="py-1 text-right font-mono">$10,652,477</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">PulseX StableSwap</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">$353,353</td>
                  <td className="py-1 text-right font-mono">~$2.1M</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">9mm V3</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">~$347K</td>
                  <td className="py-1 text-right font-mono">~$2.4M</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">PHUX</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">~$89K</td>
                  <td className="py-1 text-right font-mono">~$600K</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">9mm V2</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">~$288</td>
                  <td className="py-1 text-right font-mono">~$2K</td>
                </tr>
                <tr className="border-t border-white/10 font-medium">
                  <td className="py-1 pr-3 text-gray-300">Total (All DEX)</td>
                  <td className="py-1 pr-3 text-right font-mono text-[#00D4FF]">$4,424,468</td>
                  <td className="py-1 text-right font-mono text-[#00D4FF]">~$32.4M</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="rounded bg-amber-500/5 border border-amber-500/15 p-2.5 text-[11px]">
            <p className="text-amber-400 font-medium mb-1">{t.dex.key_discrepancies_title}</p>
            <ul className="text-gray-400 space-y-1 list-disc list-inside">
              <li>{t.dex.key_discrepancy_1.split('{reserveUSD}')[0]}<code className="text-gray-300">reserveUSD</code>{t.dex.key_discrepancy_1.split('{reserveUSD}').length > 1 ? t.dex.key_discrepancy_1.split('{reserveUSD}')[1] : ''}</li>
              <li>{t.dex.key_discrepancy_2.split('{reserveUSD}')[0]}<code className="text-gray-300">reserveUSD</code>{t.dex.key_discrepancy_2.split('{reserveUSD}').length > 1 ? t.dex.key_discrepancy_2.split('{reserveUSD}')[1] : ''}</li>
              <li>{t.dex.key_discrepancy_3}</li>
              <li>{t.dex.key_discrepancy_4}</li>
            </ul>
          </div>

          <p className="text-gray-600 text-[10px] pt-1 border-t border-white/5">
            {t.dex.chart_historical_note}{' '}
            {t.common.disclaimer}
          </p>
        </div>
      )}
    </div>
  )
}

function CumulativeVolumeNote({ source, liveFactory }: { source: DexSource; liveFactory: ReturnType<typeof useLivePulsexFactory> }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
      >
        <Info className="h-3 w-3" />
        <span>{t.dex.about_cumulative_volume}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-2 rounded-lg bg-white/5 border border-white/10 p-4 text-xs text-gray-400 space-y-4">
          {/* Introduction */}
          <div className="rounded bg-gray-800/50 border border-white/5 p-3">
            <p className="text-gray-300 font-medium mb-1">{t.dex.cumulative_volume_title}</p>
            <p>
              {t.dex.cumulative_volume_desc.split('{running_total}')[0]}<strong className="text-gray-300">{t.dex.cumulative_running_total}</strong>{t.dex.cumulative_volume_desc.split('{running_total}')[1]}
            </p>
          </div>

          {/* Current source explanation */}
          {source === 'v1' && (
            <p>
              <strong className="text-gray-300">{t.dex.cumulative_v1_source}</strong> — {t.dex.cumulative_v1_desc.split('{code}')[0]}<code className="text-gray-300">dailyVolumeUSD</code>{t.dex.cumulative_v1_desc.split('{code}')[1]}
            </p>
          )}
          {source === 'pulsex' && (
            <p>
              <strong className="text-gray-300">{t.dex.cumulative_pulsex_source}</strong> — {t.dex.cumulative_pulsex_desc}
            </p>
          )}
          {source === 'all' && (
            <p>
              <strong className="text-gray-300">{t.dex.cumulative_all_source}</strong> — {t.dex.cumulative_all_desc}
            </p>
          )}

          {/* How it's computed */}
          <div className="rounded bg-blue-500/5 border border-blue-500/15 p-2.5 text-[11px]">
            <p className="text-blue-400 font-medium mb-1">{t.dex.cumulative_how_computed_title}</p>
            <p className="text-gray-400">
              {t.dex.cumulative_how_computed_desc.split('{client_side}')[0]}<strong className="text-gray-300">{t.dex.cumulative_client_side}</strong>{t.dex.cumulative_how_computed_desc.split('{client_side}')[1].split('{code}')[0]}<code className="text-gray-300">totalVolumeUSD</code>{t.dex.cumulative_how_computed_desc.split('{client_side}')[1].split('{code}')[1]}
            </p>
          </div>

          {/* Cross-source all-time comparison */}
          <div>
            <p className="font-medium text-gray-300 mb-2">{t.dex.alltime_cumulative_comparison}</p>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="py-1 pr-3 text-gray-500 font-medium">{t.dex.table_source}</th>
                  <th className="py-1 pr-3 text-right text-gray-500 font-medium">{t.dex.table_cumulative_volume}</th>
                  <th className="py-1 text-gray-500 font-medium">{t.dex.table_method}</th>
                </tr>
              </thead>
              <tbody className="text-gray-400">
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">Subgraph V1 <code className="text-gray-500">totalVolumeUSD</code></td>
                  <td className="py-1 pr-3 text-right font-mono text-white">{liveFactory.v1VolumeUSD != null ? formatUsd(liveFactory.v1VolumeUSD) : '$19.39B'}</td>
                  <td className="py-1">{t.dex.method_onchain_counter}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">Subgraph V2 <code className="text-gray-500">totalVolumeUSD</code></td>
                  <td className="py-1 pr-3 text-right font-mono text-white">{liveFactory.v2VolumeUSD != null ? formatUsd(liveFactory.v2VolumeUSD) : '$7.05B'}</td>
                  <td className="py-1">{t.dex.method_onchain_counter}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3 font-medium text-emerald-400">{t.dex.source_combined}</td>
                  <td className="py-1 pr-3 text-right font-mono text-emerald-400">{liveFactory.totalVolumeUSD != null ? formatUsd(liveFactory.totalVolumeUSD) : '$26.44B'}</td>
                  <td className="py-1">{t.dex.method_sum_factories}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">DefiLlama <code className="text-gray-500">totalAllTime</code> (PulseX)</td>
                  <td className="py-1 pr-3 text-right font-mono text-gray-300">~$19.35B</td>
                  <td className="py-1">{t.dex.method_defillama_sum}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">GoPulse.com</td>
                  <td className="py-1 pr-3 text-right font-mono text-gray-300">~$26.3B</td>
                  <td className="py-1">{t.dex.method_raw_v1v2}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-3">DexScreener</td>
                  <td className="py-1 pr-3 text-right font-mono text-gray-500">N/A</td>
                  <td className="py-1">{t.dex.method_no_cumulative}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* KPI vs Chart discrepancy */}
          <div className="rounded bg-amber-500/5 border border-amber-500/15 p-2.5 text-[11px]">
            <p className="text-amber-400 font-medium mb-1">{t.dex.kpi_vs_chart_title}</p>
            <p className="text-gray-400">
              {t.dex.kpi_vs_chart_desc_1.split('{value}')[0]}<strong className="text-white">{liveFactory.totalVolumeUSD != null ? formatUsd(liveFactory.totalVolumeUSD) : '~$26.4B'}</strong>{t.dex.kpi_vs_chart_desc_1.split('{value}')[1].split('{code}')[0]}<code className="text-gray-300">totalVolumeUSD</code>{t.dex.kpi_vs_chart_desc_1.split('{value}')[1].split('{code}')[1]}
              {' '}{t.dex.kpi_vs_chart_desc_2.split('{daily}')[0]}<em>{t.dex.kpi_vs_chart_desc_2.split('{daily}')[0] ? 'daily' : ''}</em>{t.dex.kpi_vs_chart_desc_2.split('{daily}')[1]}
              {' '}{t.dex.kpi_vs_chart_desc_3.split('{code}')[0]}<code className="text-gray-300">totalAllTime</code>{t.dex.kpi_vs_chart_desc_3.split('{code}')[1]}
              {' '}{t.dex.kpi_vs_chart_desc_4}
            </p>
          </div>

          {/* Competitor comparison */}
          <div>
            <p className="font-medium text-gray-300 mb-2">{t.dex.competitor_comparison}</p>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="py-1 pr-3 text-gray-500 font-medium">{t.dex.table_platform}</th>
                  <th className="py-1 pr-3 text-right text-gray-500 font-medium">{t.dex.table_shows_cumulative}</th>
                  <th className="py-1 pr-3 text-right text-gray-500 font-medium">{t.common.value}</th>
                  <th className="py-1 text-gray-500 font-medium">{t.dex.table_source}</th>
                </tr>
              </thead>
              <tbody className="text-gray-400">
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">GoPulse</td>
                  <td className="py-1 pr-3 text-right text-emerald-400">Yes</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">~$26.3B</td>
                  <td className="py-1">Raw V1+V2 subgraph</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">DefiLlama</td>
                  <td className="py-1 pr-3 text-right text-emerald-400">Yes</td>
                  <td className="py-1 pr-3 text-right font-mono text-white">~$19.35B</td>
                  <td className="py-1">Filtered daily sum (~V1)</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">DexScreener</td>
                  <td className="py-1 pr-3 text-right text-red-400">No</td>
                  <td className="py-1 pr-3 text-right font-mono text-gray-500">—</td>
                  <td className="py-1">24h per-pair only</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">PulseChainStats</td>
                  <td className="py-1 pr-3 text-right text-gray-500">Offline</td>
                  <td className="py-1 pr-3 text-right font-mono text-gray-500">—</td>
                  <td className="py-1">Site down</td>
                </tr>
                <tr>
                  <td className="py-1 pr-3 font-medium text-[#00D4FF]">OpenPulsechain (KPI)</td>
                  <td className="py-1 pr-3 text-right text-emerald-400">Yes</td>
                  <td className="py-1 pr-3 text-right font-mono text-[#00D4FF]">{liveFactory.totalVolumeUSD != null ? formatUsd(liveFactory.totalVolumeUSD) : '~$26.4B'}</td>
                  <td className="py-1">Live V1+V2 subgraph</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Coherence scoring */}
          <div>
            <p className="font-medium text-gray-300 mb-2">{t.dex.coherence_scoring}</p>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="py-1 pr-3 text-gray-500 font-medium">{t.dex.table_criterion}</th>
                  <th className="py-1 pr-3 text-right text-gray-500 font-medium">{t.common.score}</th>
                  <th className="py-1 text-gray-500 font-medium">{t.dex.table_comment}</th>
                </tr>
              </thead>
              <tbody className="text-gray-400">
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">{t.dex.criterion_kpi_competitors}</td>
                  <td className="py-1 pr-3 text-right font-mono text-emerald-400">9/10</td>
                  <td className="py-1">{t.dex.comment_excellent}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">{t.dex.criterion_chart_defillama}</td>
                  <td className="py-1 pr-3 text-right font-mono text-emerald-400">8/10</td>
                  <td className="py-1">{t.dex.comment_coherent}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1 pr-3">{t.dex.criterion_source_transparency}</td>
                  <td className="py-1 pr-3 text-right font-mono text-emerald-400">9/10</td>
                  <td className="py-1">{t.dex.comment_source_selector}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-3">{t.dex.criterion_technical_robustness}</td>
                  <td className="py-1 pr-3 text-right font-mono text-yellow-400">7/10</td>
                  <td className="py-1">{t.dex.comment_client_side_gap}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Discrepancy explanation */}
          <div className="rounded bg-amber-500/5 border border-amber-500/15 p-2.5 text-[11px]">
            <p className="text-amber-400 font-medium mb-1">{t.dex.discrepancy_title}</p>
            <ul className="text-gray-400 space-y-1 list-disc list-inside">
              <li>{t.dex.discrepancy_1.split('{raw_v1v2}')[0]}<strong>{t.dex.raw_v1v2}</strong>{t.dex.discrepancy_1.split('{raw_v1v2}')[1].split('{code}')[0]}<code className="text-gray-300">totalVolumeUSD</code>{t.dex.discrepancy_1.split('{raw_v1v2}')[1].split('{code}')[1]}</li>
              <li>{t.dex.discrepancy_2.split('{code}')[0]}<code className="text-gray-300">totalAllTime</code>{t.dex.discrepancy_2.split('{code}')[1].split('{v1_only}')[0]}<strong>{t.dex.v1_only}</strong>{t.dex.discrepancy_2.split('{code}')[1].split('{v1_only}')[1]}</li>
              <li>{t.dex.discrepancy_3.split('{v2_volume}')[0]}<strong>{t.dex.v2_volume}</strong>{t.dex.discrepancy_3.split('{v2_volume}')[1]}</li>
              <li>{t.dex.discrepancy_4}</li>
            </ul>
          </div>

          <p className="text-[10px] text-gray-600 pt-1 border-t border-white/5">
            {t.common.disclaimer}
          </p>
        </div>
      )}
    </div>
  )
}

export function DexPage() {
  const { t } = useTranslation()
  // Historical data from database (sovereign)
  const pulsex = usePulsexDailyStats()         // V1+V2 subgraph daily (combined)
  const pulsexLLTvl = usePulsexDefillamaTvl()   // PulseX DefiLlama TVL
  const pulsexLLVol = usePulsexDefillamaVolume() // PulseX DefiLlama Volume
  const networkTvl = useNetworkTvl()             // All PulseChain TVL
  const networkVol = useNetworkDexVolume()        // All PulseChain DEX Volume
  const topPairs = usePulsexTopPairs()

  // Live data only (API calls, not stored)
  const liveFactory = useLivePulsexFactory()
  const liveLL = useLiveDefiLlama()

  // Source selection for charts
  const [liqSource, setLiqSource] = useState<DexSource>('v1')
  const [volSource, setVolSource] = useState<DexSource>('v1')
  const [cumSource, setCumSource] = useState<DexSource>('v1')
  const [expandedPair, setExpandedPair] = useState<string | null>(null)
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null)

  const latest = pulsex.data.length > 0 ? pulsex.data[pulsex.data.length - 1] : null

  // Filter out days with zero data (pre-launch)
  const validData = useMemo(() => pulsex.data.filter((d) => d.daily_volume_usd > 0 || d.total_liquidity_usd > 0), [pulsex.data])

  const [liqRange, setLiqRange] = useState<number | null>(null)
  const [volRange, setVolRange] = useState<number | null>(null)
  const [cumRange, setCumRange] = useState<number | null>(null)

  const kpis = useMemo(() => {
    if (!validData.length) return null
    const last30 = validData.slice(-30)
    const volume30d = last30.reduce((s, d) => s + d.daily_volume_usd, 0)
    const totalVolume = validData.reduce((s, d) => s + d.daily_volume_usd, 0)
    return {
      totalLiquidity: latest?.total_liquidity_usd ?? 0,
      totalVolume,
      totalTxs: latest?.total_transactions ?? 0,
      volume30d,
    }
  }, [validData, latest])

  // Today's date in YYYY-MM-DD (UTC)
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])

  // --- Liquidity data based on source (all from database) ---
  const v1LiqData = useMemo(() => validData.map((d) => ({ date: d.date, tvl_usd: d.total_liquidity_usd })), [validData])

  const liqBaseData = liqSource === 'v1' ? v1LiqData : liqSource === 'pulsex' ? pulsexLLTvl.data : networkTvl.data
  const liveLiq = liqSource === 'v1'
    ? liveFactory.v1LiquidityUSD
    : liqSource === 'pulsex'
      ? liveLL.tvlPulsex
      : liveLL.tvlAll

  const liqWithLive = useMemo(() => {
    if (!liveLiq || liqBaseData.length === 0) return liqBaseData
    const hist = [...liqBaseData]
    const last = hist[hist.length - 1]
    if (last.date === todayStr) {
      hist[hist.length - 1] = { ...last, tvl_usd: liveLiq }
    } else {
      hist.push({ date: todayStr, tvl_usd: liveLiq })
    }
    return hist
  }, [liqBaseData, liveLiq, todayStr])

  const liqRecent = liqRange ? liqWithLive.slice(-liqRange) : liqWithLive

  // --- Volume data based on source (all from database) ---
  const v1VolData = useMemo(() => validData.map((d) => ({ date: d.date, volume_usd: d.daily_volume_usd })), [validData])

  const volBaseData = volSource === 'v1' ? v1VolData : volSource === 'pulsex' ? pulsexLLVol.data : networkVol.data
  const liveVol = volSource === 'v1'
    ? null
    : volSource === 'pulsex'
      ? liveLL.volumePulsex
      : liveLL.volumeAll

  const volWithLive = useMemo(() => {
    if (!liveVol || volBaseData.length === 0) return volBaseData
    const hist = [...volBaseData]
    const last = hist[hist.length - 1]
    if (last.date === todayStr) {
      hist[hist.length - 1] = { ...last, volume_usd: liveVol }
    } else {
      hist.push({ date: todayStr, volume_usd: liveVol })
    }
    return hist
  }, [volBaseData, liveVol, todayStr])

  const volRecent = volRange ? volWithLive.slice(-volRange) : volWithLive

  // --- Cumulative volume with independent source ---
  const cumBaseData = cumSource === 'v1' ? v1VolData : cumSource === 'pulsex' ? pulsexLLVol.data : networkVol.data
  const liveCumVol = cumSource === 'v1'
    ? null
    : cumSource === 'pulsex'
      ? liveLL.volumePulsex
      : liveLL.volumeAll

  const cumWithLive = useMemo(() => {
    if (!liveCumVol || cumBaseData.length === 0) return cumBaseData
    const hist = [...cumBaseData]
    const last = hist[hist.length - 1]
    if (last.date === todayStr) {
      hist[hist.length - 1] = { ...last, volume_usd: liveCumVol }
    } else {
      hist.push({ date: todayStr, volume_usd: liveCumVol })
    }
    return hist
  }, [cumBaseData, liveCumVol, todayStr])

  const cumulativeVolume = useMemo(() => {
    let cumul = 0
    return cumWithLive.map((d) => {
      cumul += d.volume_usd
      return { date: d.date, cumulative_volume: cumul }
    })
  }, [cumWithLive])

  const cumRecent = cumRange ? cumulativeVolume.slice(-cumRange) : cumulativeVolume

  // Loading states
  const liqIsLoading = (liqSource === 'pulsex' && pulsexLLTvl.loading) || (liqSource === 'all' && networkTvl.loading)
  const volIsLoading = (volSource === 'pulsex' && pulsexLLVol.loading) || (volSource === 'all' && networkVol.loading)
  const cumIsLoading = (cumSource === 'pulsex' && pulsexLLVol.loading) || (cumSource === 'all' && networkVol.loading)

  if (pulsex.loading) return <Spinner />

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-blue-500/5 via-purple-500/5 to-cyan-500/5 backdrop-blur-sm p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-blue-400/10 border border-blue-400/20">
                <ArrowLeftRight className="h-6 w-6 text-blue-400" />
              </div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-300 to-purple-400 bg-clip-text text-transparent">
                {t.dex.page_title}
              </h1>
              <ShareButton title={t.dex.page_title} text={t.dex.page_description} />
            </div>
            <p className="text-gray-400 max-w-xl text-sm">
              {t.dex.page_description}
            </p>
          </div>
          {kpis && (
            <div className="flex flex-wrap gap-3">
              <div className="text-center px-4 py-2 rounded-xl bg-blue-500/5 border border-blue-500/10">
                <div className="text-lg font-bold text-blue-400">{formatUsd(liveFactory.totalLiquidityUSD ?? kpis.totalLiquidity)}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.dex.kpi_liquidity}</div>
              </div>
              <div className="text-center px-4 py-2 rounded-xl bg-white/[0.03] border border-white/5">
                <div className="text-lg font-bold text-white">{formatUsd(kpis.volume30d)}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.dex.kpi_30d_volume}</div>
              </div>
              <div className="text-center px-4 py-2 rounded-xl bg-purple-500/5 border border-purple-500/10">
                <div className="text-lg font-bold text-purple-400">{formatUsd(liveFactory.totalVolumeUSD ?? kpis.totalVolume)}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.dex.kpi_total_volume}</div>
              </div>
              <div className="text-center px-4 py-2 rounded-xl bg-cyan-500/5 border border-cyan-500/10">
                <div className="text-lg font-bold text-[#00D4FF]">{formatNumber(liveFactory.totalTransactions ?? kpis.totalTxs)}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t.dex.kpi_total_transactions}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {kpis && <DexDataSourceNote liveFactory={liveFactory} />}

      {/* Liquidity Chart */}
      <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">{t.dex.kpi_liquidity}</h2>
          <div className="flex items-center gap-2">
            <DexSourceSelector value={liqSource} onChange={setLiqSource} />
            <TimeRangeSelector value={liqRange} onChange={setLiqRange} />
          </div>
        </div>
        {liqIsLoading ? (
          <div className="py-12 flex justify-center"><Spinner /></div>
        ) : liqRecent.length > 0 ? (
          <AreaChartComponent data={liqRecent} xKey="date" yKey="tvl_usd" color="#00D4FF" liveDot={!!liveLiq} />
        ) : (
          <p className="py-12 text-center text-gray-500">{t.dex.no_liquidity_data}</p>
        )}
        <ChartDataSourceNote source={liqSource} />
      </div>

      {/* Daily Volume Bar Chart */}
      <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">{t.dex.chart_daily_volume}</h2>
          <div className="flex items-center gap-2">
            <DexSourceSelector value={volSource} onChange={setVolSource} />
            <TimeRangeSelector value={volRange} onChange={setVolRange} />
          </div>
        </div>
        {volIsLoading ? (
          <div className="py-12 flex justify-center"><Spinner /></div>
        ) : volRecent.length > 0 ? (
          <BarChartComponent
            data={volRecent}
            xKey="date"
            bars={[{ key: 'volume_usd', color: '#8000E0' }]}
          />
        ) : (
          <p className="py-12 text-center text-gray-500">{t.dex.no_volume_data}</p>
        )}
        <ChartDataSourceNote source={volSource} />
      </div>

      {/* Cumulative Volume */}
      <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">{t.dex.chart_alltime_volume}</h2>
          <div className="flex items-center gap-2">
            <DexSourceSelector value={cumSource} onChange={setCumSource} />
            <TimeRangeSelector value={cumRange} onChange={setCumRange} />
          </div>
        </div>
        {cumIsLoading ? (
          <div className="py-12 flex justify-center"><Spinner /></div>
        ) : cumRecent.length > 0 ? (
          <AreaChartComponent data={cumRecent} xKey="date" yKey="cumulative_volume" color="#D000C0" liveDot={!!liveCumVol} />
        ) : (
          <p className="py-12 text-center text-gray-500">{t.dex.no_volume_data}</p>
        )}
        <CumulativeVolumeNote source={cumSource} liveFactory={liveFactory} />
      </div>

      {/* Top Pairs */}
      {topPairs.data.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">{t.dex.top_pairs_section}</h2>
            {topPairs.data[0]?.updated_at && (
              <span className="text-[11px] text-gray-500">
                Updated {new Date(topPairs.data[0].updated_at).toLocaleString('en-US')} · Refreshes every 15 min
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-gray-400">
                  <th className="py-3 text-left">#</th>
                  <th className="py-3 text-left">{t.dex.table_pair}</th>
                  <th className="py-3 text-center">{t.dex.table_volume_24h}</th>
                  <th className="py-3 text-center hidden md:table-cell">{t.dex.table_volume_alltime}</th>
                  <th className="py-3 text-center">{t.dex.table_liquidity_header}</th>
                  <th className="py-3 text-center hidden md:table-cell">{t.dex.table_transactions}</th>
                </tr>
              </thead>
              <tbody>
                {topPairs.data.map((pair, i) => {
                  const isExpanded = expandedPair === pair.pair_address
                  const volLiqRatio = pair.reserve_usd > 0 ? pair.volume_usd / pair.reserve_usd : 0
                  const explorerUrl = `https://scan.mypinata.cloud/ipfs/bafybeienxyoyrhn5tswclvd3gdjy5mtkkwmu37aqtml6onbf7xnb3o22pe/#/address/${pair.pair_address}`
                  const dexScreenerUrl = `https://dexscreener.com/pulsechain/${pair.pair_address}`

                  return (
                    <>
                    <tr
                      key={pair.pair_address}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
                      onClick={() => setExpandedPair(isExpanded ? null : pair.pair_address)}
                    >
                      <td className="py-2.5 text-left text-gray-500">{i + 1}</td>
                      <td className="py-2.5 text-left">
                        <span className="font-medium text-white">{pair.token0_symbol}</span>
                        <span className="text-gray-500"> / </span>
                        <span className="text-gray-300">{pair.token1_symbol}</span>
                        <ChevronDown className={`inline-block ml-1.5 h-3 w-3 text-gray-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </td>
                      <td className="py-2.5 text-center text-gray-300 whitespace-nowrap">{pair.daily_volume_usd ? formatUsd(pair.daily_volume_usd) : <span className="text-gray-600">--</span>}</td>
                      <td className="py-2.5 text-center text-gray-300 whitespace-nowrap hidden md:table-cell">{formatUsd(pair.volume_usd)}</td>
                      <td className="py-2.5 text-center text-gray-300 whitespace-nowrap">{formatUsd(pair.reserve_usd)}</td>
                      <td className="py-2.5 text-center text-gray-400 whitespace-nowrap hidden md:table-cell">{formatNumber(pair.total_transactions)}</td>
                    </tr>

                    {/* Expanded details */}
                    {isExpanded && (
                      <tr key={`${pair.pair_address}-detail`} className="border-b border-white/5">
                        <td colSpan={6} className="p-0">
                          <div className="px-4 pb-4 pt-1 bg-white/[0.02] border-t border-white/5">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {/* Left: pair info */}
                              <div className="space-y-2.5">
                                <div>
                                  <span className="text-[11px] text-gray-500 block mb-0.5">{t.dex.pair_contract}</span>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono text-xs text-gray-300 truncate">{pair.pair_address}</span>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        navigator.clipboard.writeText(pair.pair_address)
                                        setCopiedAddr(pair.pair_address)
                                        setTimeout(() => setCopiedAddr(null), 2000)
                                      }}
                                      className="shrink-0 text-gray-500 hover:text-[#00D4FF] transition-colors"
                                      title="Copy address"
                                    >
                                      {copiedAddr === pair.pair_address
                                        ? <Check className="h-3 w-3 text-emerald-400" />
                                        : <Copy className="h-3 w-3" />}
                                    </button>
                                  </div>
                                </div>
                                <div>
                                  <span className="text-[11px] text-gray-500 block mb-0.5">{t.dex.pair_tokens}</span>
                                  <div className="text-xs text-gray-300">
                                    <span className="text-white font-medium">{pair.token0_symbol}</span>
                                    {pair.token0_name && <span className="text-gray-500 ml-1">({pair.token0_name})</span>}
                                    <span className="text-gray-600 mx-1.5">/</span>
                                    <span className="text-white font-medium">{pair.token1_symbol}</span>
                                    {pair.token1_name && <span className="text-gray-500 ml-1">({pair.token1_name})</span>}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-[11px] text-gray-500 block mb-0.5">{t.dex.pair_vol_liq_ratio}</span>
                                  <span className={`text-xs font-mono ${volLiqRatio > 100 ? 'text-emerald-400' : volLiqRatio > 10 ? 'text-gray-300' : 'text-amber-400'}`}>
                                    {volLiqRatio.toFixed(1)}x
                                  </span>
                                  <span className="text-[10px] text-gray-600 ml-1.5">
                                    {volLiqRatio > 100 ? t.dex.pair_very_active : volLiqRatio > 10 ? t.dex.pair_active : t.dex.pair_low_activity}
                                  </span>
                                </div>
                                <div className="text-[10px] text-gray-600">
                                  {t.dex.pair_source_note}
                                </div>
                              </div>

                              {/* Right: links */}
                              <div className="space-y-2">
                                <span className="text-[11px] text-gray-500 block mb-1">{t.dex.pair_verify_on}</span>
                                <a
                                  href={explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-gray-300 hover:bg-white/10 hover:text-[#00D4FF] transition-colors"
                                >
                                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                                  <span>{t.dex.pair_explorer_label}</span>
                                </a>
                                <a
                                  href={dexScreenerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-gray-300 hover:bg-white/10 hover:text-emerald-400 transition-colors"
                                >
                                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                                  <span>{t.dex.pair_dexscreener_label}</span>
                                </a>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
