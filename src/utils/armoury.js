// Armoury compendium classifier. Pure logic, no UI imports — safe to unit test
// and to consume from the single-file build.
//
// There is no `tier`/`group` field in items.json, so both are derived:
//   - group: the item *kind* — the noun in its name, so every Shortbow groups
//     with other shortbows, every Amulet with amulets, etc. (not by material
//     family). Max-level (99) skill capes collapse into one "Skill Capes" group.
//   - tier: the lowest equip requirement (used to order items within a group).
// Everything is presented as one flat list of kind groups, ordered alphabetically
// (Skill Capes last), with items inside each group ordered by tier.
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

// The item kind — the defining noun of the name. By default the last word
// ("Magic Shortbow" → "Shortbow", "Rune Platebody" → "Platebody"), with two
// fixes: strip a trailing variant tag in parentheses ("Climbing Boots (G)"),
// and for "<Kind> of <X>" names use the noun before "of" ("Amulet of Glory" →
// "Amulet", "Staff of Fire" → "Staff", "Trident of Venom" → "Trident").
export function kindOf(item) {
  let name = String(item?.name || '').trim().replace(/\s*\([^)]*\)\s*$/, '').trim()
  if (!name) return 'Other'
  const ofMatch = name.match(/^(.*?)\s+of\s+/i)
  const base = (ofMatch ? ofMatch[1] : name).trim()
  const words = base.split(/\s+/)
  return words[words.length - 1] || 'Other'
}

// Group key = "skill_capes" for max-level capes, else the item kind, lowercased
// and stripped of punctuation.
export function groupKeyOf(item) {
  if (isSkillCape(item)) return SKILL_CAPES_GROUP_KEY
  return kindOf(item).toLowerCase().replace(/[^a-z0-9]/g, '') || 'other'
}

export function groupLabelOf(item) {
  if (isSkillCape(item)) return 'Skill Capes'
  return kindOf(item)
}

// Build one flat list of kind groups: [{ key, label, minTier, items[] }].
// Items sort by tier then name; groups sort alphabetically by label, with the
// Skill Capes catch-all pinned last.
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
  }).sort((a, b) => {
    if (a.key === SKILL_CAPES_GROUP_KEY) return 1
    if (b.key === SKILL_CAPES_GROUP_KEY) return -1
    return a.label.localeCompare(b.label)
  })
}
