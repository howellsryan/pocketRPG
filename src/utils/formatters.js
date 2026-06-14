// Human-readable duration for a tick count (1 tick = 0.6s). Tiers up through
// hours so long skilling actions don't render as huge minute counts. Shared by
// every screen that shows action timings — keep it here rather than redefining
// per-screen (duplicate top-level names collide in the single-file build).
export function formatActionDuration(ticks) {
  const seconds = ticks * 0.6
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  if (seconds < 3600) {
    const mins = seconds / 60
    return Number.isInteger(mins) ? `${mins}m` : `${mins.toFixed(1)}m`
  }
  const hours = seconds / 3600
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`
}

export function formatCompactCoins(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0'

  const abs = Math.abs(num)
  const sign = num < 0 ? '-' : ''

  if (abs < 1_000) return `${Math.floor(num)}`

  const formatUnit = (divisor, suffix) => {
    const scaled = abs / divisor
    const useDecimal = scaled < 10 && Math.floor(scaled) !== scaled
    const shown = useDecimal ? Math.floor(scaled * 10) / 10 : Math.floor(scaled)
    const formatted = useDecimal ? shown.toFixed(1).replace(/\.0$/, '') : String(shown)
    return `${sign}${formatted}${suffix}`
  }

  if (abs >= 1_000_000_000) return formatUnit(1_000_000_000, 'b')
  if (abs >= 1_000_000) return formatUnit(1_000_000, 'M')
  return formatUnit(1_000, 'k')
}
