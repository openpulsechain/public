import type { BridgeTokenStats } from '../../types'
import { formatUsd, formatNumber } from '../../lib/format'

interface TokenTableProps {
  data: BridgeTokenStats[]
}

export function TokenTable({ data }: TokenTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 text-gray-400">
            <th className="py-3 pr-4">#</th>
            <th className="py-3 pr-4">Token</th>
            <th className="py-3 pr-4 text-right">Deposits</th>
            <th className="py-3 pr-4 text-right">Withdrawals</th>
            <th className="py-3 pr-4 text-right">Net Flow</th>
            <th className="py-3 text-right">Txs</th>
          </tr>
        </thead>
        <tbody>
          {data.map((token, i) => (
            <tr key={token.token_address} className="border-b border-white/5 hover:bg-white/5 transition-colors">
              <td className="py-2.5 pr-4 text-gray-500">{i + 1}</td>
              <td className="py-2.5 pr-4 font-medium text-white">
                {token.token_symbol || token.token_address.slice(0, 10) + '...'}
              </td>
              <td className="py-2.5 pr-4 text-right text-emerald-400">
                {formatUsd(token.total_deposit_volume_usd)}
              </td>
              <td className="py-2.5 pr-4 text-right text-red-400">
                {formatUsd(token.total_withdrawal_volume_usd)}
              </td>
              <td className={`py-2.5 pr-4 text-right ${token.net_flow_usd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatUsd(token.net_flow_usd)}
              </td>
              <td className="py-2.5 text-right text-gray-300">
                {formatNumber(token.total_deposit_count + token.total_withdrawal_count)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
