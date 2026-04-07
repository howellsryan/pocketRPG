export default function HPBar({ current, max, label, size = 'normal' }) {
  const pct = max > 0 ? (current / max) * 100 : 0
  const color = pct > 50 ? 'var(--color-hp-green)' : pct > 25 ? 'var(--color-hp-yellow)' : 'var(--color-hp-red)'
  const barHeight = size === 'large' ? 'h-5' : 'h-3'

  return (
    <div class="w-full">
      {label && <div class="text-[10px] text-[var(--color-parchment)] opacity-60 mb-0.5">{label}</div>}
      <div class={`relative w-full ${barHeight} bg-[#222] rounded-full overflow-hidden border border-[#444]`}>
        <div
          class="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
        <span class="absolute inset-0 flex items-center justify-center text-[9px] font-[var(--font-mono)] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
          {current}/{max}
        </span>
      </div>
    </div>
  )
}
