import { useState } from 'preact/hooks'
import SectionHeader from './SectionHeader.jsx'

/**
 * Displays all bonuses from an item (attack, defence, other).
 * Data-driven component that shows any bonus the item has.
 * Collapsed by default to reduce noise on mobile; tap header to expand.
 */
export default function BonusDisplay({ item }) {
  const [expanded, setExpanded] = useState(false)
  if (!item) return null

  const hasAttackBonus = item.attackBonus && Object.values(item.attackBonus).some(v => v !== 0)
  const hasDefenceBonus = item.defenceBonus && Object.values(item.defenceBonus).some(v => v !== 0)
  const hasOtherBonus = item.otherBonus && Object.values(item.otherBonus).some(v => v !== 0)

  if (!hasAttackBonus && !hasDefenceBonus && !hasOtherBonus) {
    return null
  }

  const otherBonusLabels = {
    meleeStrength: 'Str',
    rangedStrength: 'Rng Str',
    magicDamage: 'Mag %'
  }

  return (
    <div class="text-[12px]">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        class="w-full flex items-center gap-2 py-1 text-left rounded-lg active:bg-[#1a1a1a]"
      >
        <SectionHeader size="sm" className="opacity-60">Bonuses</SectionHeader>
        <span class="ml-auto text-[10px] text-[var(--color-parchment)] opacity-60">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div class="mt-1">
          {hasAttackBonus && (
            <div class="mb-2">
              <SectionHeader size="sm" className="mb-1 opacity-40">Attack Bonuses</SectionHeader>
              {Object.entries(item.attackBonus).map(([k, v]) =>
                v !== 0 ? (
                  <div key={k} class="flex justify-between text-[var(--color-parchment)] opacity-70 py-[2px]">
                    <span class="capitalize">{k}</span>
                    <span class="font-[var(--font-mono)]" style={{ color: v > 0 ? '#27ae60' : '#c0392b' }}>
                      {v > 0 ? '+' : ''}{v}
                    </span>
                  </div>
                ) : null
              )}
            </div>
          )}

          {hasDefenceBonus && (
            <div class="mb-2">
              <SectionHeader size="sm" className="mb-1 opacity-40">Defence Bonuses</SectionHeader>
              {Object.entries(item.defenceBonus).map(([k, v]) =>
                v !== 0 ? (
                  <div key={k} class="flex justify-between text-[var(--color-parchment)] opacity-70 py-[2px]">
                    <span class="capitalize">{k}</span>
                    <span class="font-[var(--font-mono)]" style={{ color: v > 0 ? '#27ae60' : '#c0392b' }}>
                      {v > 0 ? '+' : ''}{v}
                    </span>
                  </div>
                ) : null
              )}
            </div>
          )}

          {hasOtherBonus && (
            <div>
              <SectionHeader size="sm" className="mb-1 opacity-40">Other Bonuses</SectionHeader>
              {Object.entries(item.otherBonus).map(([k, v]) =>
                v !== 0 ? (
                  <div key={k} class="flex justify-between text-[var(--color-parchment)] opacity-70 py-[2px]">
                    <span>{otherBonusLabels[k] || k}</span>
                    <span class="font-[var(--font-mono)]" style={{ color: v > 0 ? '#27ae60' : '#c0392b' }}>
                      {v > 0 ? '+' : ''}{v}
                    </span>
                  </div>
                ) : null
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
