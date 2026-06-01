// Armoury compendium classifier. Pure logic, no UI imports — safe to unit test
// and to consume from the single-file build.
//
// There is no `tier`/`group` field in items.json, so both are derived:
//   - category (melee/ranged/magic): from weapon attackStyle, else from the
//     item's requirements / bonus profile.
//   - group: the first word of the item name (Dragon, Runeforged, Grondar, …);
//     items in the same equipment family share a first word.
//   - tier: the lowest equip requirement (used purely as a sort key).
import itemsData from '../data/items.json'

const hasPositive = (obj) => !!obj && Object.values(obj).some(v => typeof v === 'number' && v > 0)

// An item belongs in the Armoury if it grants any positive attack or defence bonus.
export function hasPositiveCombatBonus(item) {
  return hasPositive(item?.attackBonus) || hasPositive(item?.defenceBonus)
}

export function hasSpecialAttack(item) {
  return !!item?.specialAttack
}

export const ARMOURY_CATEGORIES = ['melee', 'ranged', 'magic']
export const CATEGORY_LABELS = { melee: 'Melee', ranged: 'Ranged', magic: 'Magic' }

// Melee / ranged / magic for any equippable item.
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

// Group key = first word of the name, lowercased and stripped of punctuation.
export function groupKeyOf(item) {
  const first = String(item?.name || '').trim().split(/\s+/)[0] || ''
  return first.toLowerCase().replace(/[^a-z0-9]/g, '') || 'other'
}

export function groupLabelOf(item) {
  const first = String(item?.name || '').trim().split(/\s+/)[0] || 'Other'
  return first
}

// Build { melee: [...], ranged: [...], magic: [...] } where each entry is a
// group { key, label, minTier, items[] }. Items sort by tier then name; groups
// sort by their lowest tier then label.
export function buildArmoury(items = itemsData) {
  const cats = { melee: new Map(), ranged: new Map(), magic: new Map() }
  const seenIds = new Set()
  for (const item of Object.values(items)) {
    if (!hasPositiveCombatBonus(item)) continue
    // Defensive: never list the same canonical id twice (e.g. if a legacy
    // duplicate ever re-enters the data).
    if (seenIds.has(item.id)) continue
    seenIds.add(item.id)
    const cat = categoryOf(item)
    const key = groupKeyOf(item)
    if (!cats[cat].has(key)) cats[cat].set(key, { key, label: groupLabelOf(item), items: [] })
    cats[cat].get(key).items.push(item)
  }
  const shape = (map) => [...map.values()].map(group => {
    group.items.sort((a, b) => tierOf(a) - tierOf(b) || a.name.localeCompare(b.name))
    group.minTier = tierOf(group.items[0])
    return group
  }).sort((a, b) => a.minTier - b.minTier || a.label.localeCompare(b.label))
  return { melee: shape(cats.melee), ranged: shape(cats.ranged), magic: shape(cats.magic) }
}
