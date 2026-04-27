interface TimeRangeOption {
  label: string
  days: number | null // null = all
}

const OPTIONS: TimeRangeOption[] = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '180D', days: 180 },
  { label: '1Y', days: 365 },
  { label: 'All', days: null },
]

interface Props {
  value: number | null
  onChange: (days: number | null) => void
}

export function TimeRangeSelector({ value, onChange }: Props) {
  return (
    <div className="flex gap-1">
      {OPTIONS.map((opt) => (
        <button
          key={opt.label}
          onClick={() => onChange(opt.days)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            value === opt.days
              ? 'bg-[#8000E0]/20 text-[#00D4FF] border border-[#8000E0]/30'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
