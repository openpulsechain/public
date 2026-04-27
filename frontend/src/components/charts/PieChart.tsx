import {
  ResponsiveContainer,
  PieChart as RechartsPie,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from 'recharts'
import { formatUsd } from '../../lib/format'

const COLORS = ['#00D4FF', '#8000E0', '#FF0040', '#4040E0', '#D000C0', '#00D4FF80', '#8000E080', '#FF004080']

interface PieChartProps {
  data: { name: string; value: number }[]
}

export function PieChartComponent({ data }: PieChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsPie>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          dataKey="value"
          nameKey="name"
          paddingAngle={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ backgroundColor: 'rgba(17,24,39,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', backdropFilter: 'blur(8px)' }}
          formatter={(v: unknown) => [formatUsd(Number(v)), '']}
        />
        <Legend />
      </RechartsPie>
    </ResponsiveContainer>
  )
}
