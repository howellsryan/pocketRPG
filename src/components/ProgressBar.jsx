export default function ProgressBar({ value, max, color = 'var(--color-xp-bar)', height = 'h-2', label, showText = false }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0

  return (
    <div class="w-full">
      {label && <div class="text-[10px] text-[var(--color-parchment)] opacity-60 mb-0.5">{label}</div>}
      <div class={`w-full ${height} bg-[#222] rounded-full overflow-hidden border border-[#333]`}>
        <div
          class="h-full rounded-full transition-all duration-200"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      {showText && (
        <div class="text-[10px] font-[var(--font-mono)] text-[var(--color-parchment)] opacity-50 mt-0.5 text-right">
          {Math.floor(pct)}%
        </div>
      )}
    </div>
  )
}
