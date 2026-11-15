/** 细进度环。mastery/percent 都走 0..1 */
export function Ring({
  value,
  size = 40,
  stroke = 3,
  label,
}: {
  value: number
  size?: number
  stroke?: number
  label?: string
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const dash = c * pct

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line-strong)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
        />
      </svg>
      <span
        className={`absolute text-[10px] font-medium tabular-nums ${
          pct > 0 ? 'text-ink-dim' : 'text-ink-mute/60'
        }`}
      >
        {label ?? `${Math.round(pct * 100)}`}
      </span>
    </div>
  )
}
