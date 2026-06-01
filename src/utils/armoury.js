// Armoury compendium classifier. Pure logic, no UI imports — safe to unit test
// and to consume from the single-file build.
//
// There is no `tier`/`group` field in items.json, so both are derived:
//   - group: the first word of the item name (Dragon, Runeforged, Grondar, …);
//     items in the same equipment family share a first word. Max-level (99)
//     skill capes are collapsed into one "Skill Capes" group.
//   - tier: the lowest equip requirement (used purely as a sort key).
// Everything is presented as one flat, tier-ordered list of groups.
import itemsData from '../data/items.json'

const hasPositive = (obj) => !!obj && Object.values(obj).some(v => typeof v === 'number' && v > 0)

// An item belongs in the Armoury if it grants any positive attack or defence bonus.
export function hasPositiveCombatBonus(item) {
  return hasPositive(item?.attackBonus) || hasPositive(item?.defenceBonus)
}

export function hasSpecialAttack(item) {
  return !!item?.specialAttack
}

// Melee / ranged / magic for any equippable item. Retained as a general helper
// (the Armoury no longer splits by it, but it's the canonical combat-type rule).
export function categoryOf(item) {
  if (!item) return 'melee'
  if (item.type === 'weapon') {
    if (item.attackStyle === 'ranged') return 'ranged'
    if (item.attackStyle === 'magic') return 'magic'
    return 'melee'
  }
  const req = item.requirements || {}
  if (req.ranged) return 'ranged'
  if (req.magic) return 'magic'
  const other = item.otherBonus || {}
  if (other.rangedStrength > 0) return 'ranged'
  if (other.magicDamage > 0) return 'magic'
  const atk = item.attackBonus || {}
  if (atk.ranged > 0) return 'ranged'
  if (atk.magic > 0) return 'magic'
  return 'melee'
}

// Tier sort key: lowest equip requirement (0 when unrestricted).
export function tierOf(item) {
  const reqs = Object.values(item?.requirements || {}).filter(v => typeof v === 'number')
  return reqs.length ? Math.min(...reqs) : 0
}

export const SKILL_CAPES_GROUP_KEY = 'skill_capes'

// A max-level skill cape: a cape that requires exactly level 99 in a single
// skill (Attack Cape, Mining Cape, …). Excludes Fire/Infernal/Ava's/God capes.
export function isSkillCape(item) {
  if (!item || item.slot !== 'cape') return false
  const reqs = Object.values(item.requirements || {})
  return reqs.length === 1 && reqs[0] === 99
}

// Group key = "skill_capes" for max-level capes, else the first word of the
// name, lowercased and stripped of punctuation.
export function groupKeyOf(item) {
  if (isSkillCape(item)) return SKILL_CAPES_GROUP_KEY
  const first = String(item?.name || '').trim().split(/\s+/)[0] || ''
  return first.toLowerCase().replace(/[^a-z0-9]/g, '') || 'other'
}

export function groupLabelOf(item) {
  if (isSkillCape(item)) return 'Skill Capes'
  return String(item?.name || '').trim().split(/\s+/)[0] || 'Other'
}

// Build one flat, tier-ordered list of groups: [{ key, label, minTier, items[] }].
// Items sort by tier then name; groups sort by their lowest tier then label,
// so the Skill Capes group (all level 99) naturally lands at the end.
export function buildArmoury(items = itemsData) {
  const groups = new Map()
  const seenIds = new Set()
  for (const item of Object.values(items)) {
    if (!hasPositiveCombatBonus(item)) continue
    // Defensive: never list the same canonical id twice (e.g. if a legacy
    // duplicate ever re-enters the data).
    if (seenIds.has(item.id)) continue
    seenIds.add(item.id)
    const key = groupKeyOf(item)
    if (!groups.has(key)) groups.set(key, { key, label: groupLabelOf(item), items: [] })
    groups.get(key).items.push(item)
  }
  return [...groups.values()].map(group => {
    group.items.sort((a, b) => tierOf(a) - tierOf(b) || a.name.localeCompare(b.name))
    group.minTier = tierOf(group.items[0])
    return group
  }).sort((a, b) => a.minTier - b.minTier || a.label.localeCompare(b.label))
}
