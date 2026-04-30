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
