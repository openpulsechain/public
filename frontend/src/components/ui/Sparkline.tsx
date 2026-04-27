interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  color?: string
}

export function Sparkline({ data, width = 100, height = 32, color }: SparklineProps) {
  if (data.length < 3) return <span className="text-gray-600 text-xs">--</span>

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const lineColor = color || (data[data.length - 1] >= data[0] ? '#34d399' : '#f87171')

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x},${y}`
  })

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={lineColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
