import { useMemo, useState } from 'preact/hooks'
import itemsData from '../data/items.json'
import { buildArmoury, describeObtainment, hasSpecialAttack, tierOf, typeFilterOf, TYPE_FILTERS } from '../utils/armoury.js'
import SharedItemModal from '../components/SharedItemModal.jsx'
import GameIcon from '../components/GameIcon.jsx'
import BackLink from '../components/BackLink.jsx'

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

// "How to obtain" detail block injected into the shared item modal.
function ArmourySources({ item }) {
  const sources = useMemo(() => describeObtainment(item), [item?.id])
  if (!sources.length) return null
  return (
    <div class="pt-2 mt-1 border-t border-[var(--color-void-border)]">
      <p class="text-[var(--color-gold)] font-semibold text-[12px] flex items-center gap-1">
        <span aria-hidden="true">📦</span> How to obtain
      </p>
      <ul class="mt-1 space-y-0.5">
        {sources.map(s => (
          <li key={s} class="text-[12px] text-[var(--color-parchment)]">• {s}</li>
        ))}
      </ul>
    </div>
  )
}

// `onBack` (from App): returns to the screen the player came from.
export default function ArmouryScreen({ onBack }) {
  const groups = useMemo(() => buildArmoury(itemsData), [])
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [type, setType] = useState('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q && type === 'all') return groups
    return groups
      .map(group => ({
        ...group,
        items: group.items.filter(item =>
          (type === 'all' || typeFilterOf(item) === type) &&
          (!q || item.name.toLowerCase().includes(q))
        ),
      }))
      .filter(group => group.items.length > 0)
  }, [groups, query, type])

  return (
    <div class="forge-shell h-full flex flex-col">
      <div class="px-4 pt-4 pb-2 flex-shrink-0">
        <BackLink onClick={onBack} className="mb-3" />
        <h1 class="font-[var(--font-display)] text-[var(--color-gold)] text-lg font-bold tracking-wide">Armoury</h1>
        <p class="text-[11px] text-[var(--color-parchment)] opacity-50 mt-[2px]">
          Every item you can wield or wear, grouped by set and ordered by tier. <span aria-hidden="true">⚔️</span> marks a special attack.
        </p>

        <div class="flex gap-2 mt-3">
          <input
            type="search"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search by name…"
            aria-label="Search the armoury by name"
            class="flex-1 min-w-0 min-h-[44px] px-3 rounded-xl bg-[var(--color-void-light)] border border-[var(--color-void-border)] text-[14px] text-[var(--color-parchment)] placeholder:text-[var(--color-parchment)] placeholder:opacity-40 focus:outline-none focus:border-[var(--color-gold)]"
          />
          <select
            value={type}
            onChange={(e) => setType(e.currentTarget.value)}
            aria-label="Filter by gear type"
            class="min-h-[44px] px-3 rounded-xl bg-[var(--color-void-light)] border border-[var(--color-void-border)] text-[14px] text-[var(--color-parchment)] focus:outline-none focus:border-[var(--color-gold)]"
          >
            {TYPE_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-4 pb-4">
        {filtered.length === 0 && (
          <p class="text-[13px] text-[var(--color-parchment)] opacity-60 mt-6 text-center">No gear matches your search.</p>
        )}
        {filtered.map(group => (
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
                    <GameIcon item={item} size={34} class="shrink-0" />
                    <span class="armoury-card__name">{item.name}</span>
                    <span class="armoury-card__tier">{tier > 0 ? `Lvl ${tier}` : '—'}</span>
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
          <ArmourySources item={selected} />
        </SharedItemModal>
      )}
    </div>
  )
}
