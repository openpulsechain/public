import type { HyperlaneChainStats } from '../../types'
import { formatUsd, formatNumber } from '../../lib/format'

interface ChainTableProps {
  data: HyperlaneChainStats[]
}

export function ChainTable({ data }: ChainTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 text-gray-400">
            <th className="py-3 pr-4">#</th>
            <th className="py-3 pr-4">Chain</th>
            <th className="py-3 pr-4 text-right">Inbound</th>
            <th className="py-3 pr-4 text-right">Outbound</th>
            <th className="py-3 pr-4 text-right">Net Flow</th>
            <th className="py-3 text-right">Txs</th>
          </tr>
        </thead>
        <tbody>
          {data.map((chain, i) => (
            <tr key={chain.chain_id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
              <td className="py-2.5 pr-4 text-gray-500">{i + 1}</td>
              <td className="py-2.5 pr-4 font-medium text-white capitalize">
                {chain.chain_name || `Chain ${chain.chain_id}`}
              </td>
              <td className="py-2.5 pr-4 text-right text-emerald-400">
                {formatUsd(chain.total_inbound_volume_usd)}
              </td>
              <td className="py-2.5 pr-4 text-right text-red-400">
                {formatUsd(chain.total_outbound_volume_usd)}
              </td>
              <td className={`py-2.5 pr-4 text-right ${chain.net_flow_usd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatUsd(chain.net_flow_usd)}
              </td>
              <td className="py-2.5 text-right text-gray-300">
                {formatNumber(chain.total_inbound_count + chain.total_outbound_count)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
