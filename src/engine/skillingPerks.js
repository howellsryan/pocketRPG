// Shared mechanism for equip-only skilling jewellery (bracelets/rings/amulets
// that boost a gathering or production skill's output). The percent itself
// lives on the item's otherBonus, same convention as the weapon-slot
// fishingXpPercent/herbYieldPercent perks (src/engine/skilling.js,
// src/engine/farming.ts) — authoring a new piece is a one-line items.json
// edit. This table only says which skill (and, where the effect targets one
// action rather than the whole skill, which action id) each key applies to;
// that scoping is a property of the SKILL, not of any one item, so it lives
// here once instead of being redeclared per item.
//
// Unlike the two weapon-slot perks above, jewellery can sit in any equipment
// slot, so this scans every slot rather than just `equipment.weapon` — which
// is also what makes "must be equipped, inventory/bank do nothing" true by
// construction: nothing here ever reads inventory or bank.
const YIELD_BONUS_SOURCES = [
  { skill: 'runecraft', otherBonusKey: 'runecraftYieldPercent' },
  { skill: 'mining', otherBonusKey: 'essenceYieldPercent', actionIds: ['rune_essence'] },
]

export const SKILLING_YIELD_BONUS_KEYS = YIELD_BONUS_SOURCES.map(s => s.otherBonusKey)

/**
 * Multiplier to apply to an action's base output quantity, from every
 * equipped item whose otherBonus grants a matching yield perk. 1 when
 * nothing matches (no perk equipped, or the wrong action within the skill).
 */
export function getSkillYieldMultiplier(skill, actionId, equipment, itemsData) {
  if (!equipment || typeof equipment !== 'object') return 1
  const sources = YIELD_BONUS_SOURCES.filter(s => s.skill === skill && (!s.actionIds || s.actionIds.includes(actionId)))
  if (sources.length === 0) return 1
  let multiplier = 1
  for (const slotEntry of Object.values(equipment)) {
    const itemId = slotEntry?.itemId
    const item = itemId ? itemsData?.[itemId] : null
    const otherBonus = item?.otherBonus
    if (!otherBonus) continue
    for (const source of sources) {
      const pct = Number(otherBonus[source.otherBonusKey] || 0)
      if (pct > 0) multiplier *= 1 + pct / 100
    }
  }
  return multiplier
}
