import GameIcon from './GameIcon.jsx'

// Compact badges showing each active potion boost with its item icon and
// remaining duration. Reusable next to any HP bar; the future PvP design can
// feed it PvP potion state in the same { potionItemId: remainingTicks } shape.
export default function ActivePotionBadges({ activePotions, itemsData, class: cls = '' }) {
  const entries = Object.entries(activePotions || {})
    .filter(([potionId, ticks]) => ticks > 0 && itemsData?.[potionId])
  if (entries.length === 0) return null
  return (
    <div class={`flex items-center gap-1 flex-wrap ${cls}`}>
      {entries.map(([potionId, ticks]) => {
        const potion = itemsData[potionId]
        const remainingSeconds = Math.ceil(ticks * 0.6)
        return (
          <span
            key={potionId}
            class="flex items-center gap-0.5 bg-[#1a2a1a] border border-[#2a4a2a] rounded-md px-1 py-0.5"
            title={`${potion.name} · ${remainingSeconds}s remaining`}
          >
            <GameIcon item={potion} size={14} />
            <span class="text-[9px] font-[var(--font-mono)] text-[var(--color-emerald-light)]">
              {remainingSeconds}s
            </span>
          </span>
        )
      })}
    </div>
  )
}
