import { useMemo, useState } from 'preact/hooks'
import itemsData from '../data/items.json'
import { buildArmoury, ARMOURY_CATEGORIES, CATEGORY_LABELS, hasSpecialAttack, tierOf } from '../utils/armoury.js'
import SharedItemModal from '../components/SharedItemModal.jsx'
import GameIcon from '../components/GameIcon.jsx'

const CATEGORY_ICONS = { melee: '⚔️', ranged: '🏹', magic: '🔮' }

// Special-attack detail block injected into the shared item modal.
function ArmourySpecial({ item }) {
  const spec = item?.specialAttack
  if (!spec) return null
  return (
    <div class="pt-2 mt-1 border-t border-[var(--color-void-border)]">
      <p class="text-[var(--color-gold)] font-semibold text-[12px] flex items-center gap-1">
        <span aria-hidden="true">⚔️</span> Special Attack
      </p>
      {spec.energyCost != null && (
        <p class="text-[11px] text-[var(--color-parchment)] opacity-70 mt-1">Energy cost: {spec.energyCost}%</p>
      )}
      {spec.description && <p class="text-[12px] text-[var(--color-parchment)] mt-1">{spec.description}</p>}
    </div>
  )
}

export default function ArmouryScreen() {
  const armoury = useMemo(() => buildArmoury(itemsData), [])
  const [category, setCategory] = useState('melee')
  const [selected, setSelected] = useState(null)
  const groups = armoury[category] || []

  return (
    <div class="h-full flex flex-col">
      <div class="px-4 pt-4 pb-2 flex-shrink-0">
        <h1 class="font-[var(--font-display)] text-[var(--color-gold)] text-lg font-bold tracking-wide">Armoury</h1>
        <p class="text-[11px] text-[var(--color-parchment)] opacity-50 mt-[2px]">
          Every weapon and piece of armour, by tier. <span aria-hidden="true">⚔️</span> marks a special attack.
        </p>
        <div class="flex gap-2 mt-3">
          {ARMOURY_CATEGORIES.map(cat => {
            const active = category === cat
            return (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                aria-pressed={active}
                class={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors border ${active
                  ? 'bg-[var(--color-gold)] text-[var(--color-void)] border-transparent'
                  : 'bg-[#222] text-[var(--color-parchment)] border-[var(--color-void-border)]'}`}
              >
                <span class="mr-1" aria-hidden="true">{CATEGORY_ICONS[cat]}</span>{CATEGORY_LABELS[cat]}
              </button>
            )
          })}
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-4 pb-4">
        {groups.length === 0 && (
          <p class="text-center text-[var(--color-parchment)] opacity-40 text-sm mt-8">No items in this category.</p>
        )}
        {groups.map(group => (
          <div key={group.key}>
            <div class="section-head">
              <span>{group.label}</span>
              <div class="section-head__rule" />
            </div>
            <div class="armoury-grid">
              {group.items.map(item => {
                const tier = tierOf(item)
                return (
                  <button key={item.id} class="armoury-card" onClick={() => setSelected(item)} aria-label={item.name}>
                    {hasSpecialAttack(item) && (
                      <span class="armoury-card__spec" title="Has a special attack" aria-label="Has a special attack">⚔️</span>
                    )}
                    <GameIcon item={item} size={26} class="shrink-0" />
                    <span class="min-w-0">
                      <span class="armoury-card__name">{item.name}</span>
                      <span class="armoury-card__tier">{tier > 0 ? `Lvl ${tier}` : '—'}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <SharedItemModal item={selected} onClose={() => setSelected(null)}>
          <ArmourySpecial item={selected} />
        </SharedItemModal>
      )}
    </div>
  )
}
