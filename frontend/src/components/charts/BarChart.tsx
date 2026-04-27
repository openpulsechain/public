import {
  ResponsiveContainer,
  BarChart as RechartsBar,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'
import { formatUsd, formatDateShort, formatDateFull } from '../../lib/format'

interface BarChartProps {
  data: any[]
  xKey: string
  bars: { key: string; color: string; name?: string }[]
}

export function BarChartComponent({ data, xKey, bars }: BarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsBar data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey={xKey}
          tickFormatter={formatDateShort}
          stroke="#6b7280"
          tick={{ fontSize: 11 }}
          interval={Math.max(0, Math.ceil(data.length / 6) - 1)}
          angle={0}
        />
        <YAxis
          tickFormatter={(v) => formatUsd(v)}
          stroke="#6b7280"
          tick={{ fontSize: 12 }}
          width={70}
        />
        <Tooltip
          contentStyle={{ backgroundColor: 'rgba(17,24,39,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', backdropFilter: 'blur(8px)' }}
          labelFormatter={(label) => formatDateFull(String(label))}
          formatter={(v: unknown) => [formatUsd(Number(v)), '']}
        />
        {bars.some((b) => b.name) && <Legend />}
        {bars.map((bar) => (
          <Bar key={bar.key} dataKey={bar.key} fill={bar.color} name={bar.name || bar.key} radius={[2, 2, 0, 0]} />
        ))}
      </RechartsBar>
    </ResponsiveContainer>
  )
}
