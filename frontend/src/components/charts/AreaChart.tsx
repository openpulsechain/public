import {
  ResponsiveContainer,
  AreaChart as RechartsArea,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { formatUsd, formatDateShort, formatDateFull } from '../../lib/format'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface AreaChartProps {
  data: any[]
  xKey: string
  yKey: string
  color?: string
  yFormatter?: (v: number) => string
  /** Show a pulsing green dot on the last data point */
  liveDot?: boolean
}

/** Returns a dot render function that only draws a pulsing green dot on the last point */
function makeLiveDot(dataLength: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (props: any) => {
    const { cx, cy, index } = props
    if (index !== dataLength - 1 || cx == null || cy == null) return <g />
    return (
      <g>
        <circle cx={cx} cy={cy} r={6} fill="#34d399" opacity={0.3}>
          <animate attributeName="r" from="4" to="12" dur="1.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.6" to="0" dur="1.5s" repeatCount="indefinite" />
        </circle>
        <circle cx={cx} cy={cy} r={4} fill="#34d399" />
      </g>
    )
  }
}

export function AreaChartComponent({ data, xKey, yKey, color = '#34d399', yFormatter, liveDot }: AreaChartProps) {
  const fmt = yFormatter || formatUsd

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsArea data={data}>
        <defs>
          <linearGradient id={`grad-${yKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
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
          tickFormatter={(v) => fmt(v)}
          stroke="#6b7280"
          tick={{ fontSize: 12 }}
          width={70}
        />
        <Tooltip
          contentStyle={{ backgroundColor: 'rgba(17,24,39,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', backdropFilter: 'blur(8px)' }}
          labelFormatter={(label) => formatDateFull(String(label))}
          formatter={(v: unknown) => [fmt(Number(v)), '']}
        />
        <Area
          type="monotone"
          dataKey={yKey}
          stroke={color}
          fill={`url(#grad-${yKey})`}
          strokeWidth={2}
          dot={liveDot ? makeLiveDot(data.length) : false}
          activeDot={liveDot ? { r: 5, fill: '#34d399', stroke: '#059669', strokeWidth: 2 } : undefined}
        />
      </RechartsArea>
    </ResponsiveContainer>
  )
}
