import type { ReactNode } from 'react'

interface KpiCardProps {
  title: string
  value: string
  subtitle?: string
  icon?: ReactNode
  trend?: number
  titleSuffix?: ReactNode
}

export function KpiCard({ title, value, subtitle, icon, trend, titleSuffix }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-sm p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400 flex items-center gap-1.5">{title}{titleSuffix}</span>
        {icon && <span className="rounded-lg bg-[#00D4FF]/10 p-1.5 text-[#00D4FF]">{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
      <div className="mt-1 flex items-center gap-2">
        {trend !== undefined && (
          <span className={`text-sm font-medium ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend >= 0 ? '+' : ''}{trend.toFixed(1)}%
          </span>
        )}
        {subtitle && <span className="text-sm text-gray-500">{subtitle}</span>}
      </div>
    </div>
  )
}
