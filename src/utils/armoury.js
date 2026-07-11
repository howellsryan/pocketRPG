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
import monstersData from '../data/monsters.json'
import skillsData from '../data/skills.json'

const hasPositive = (obj) => !!obj && Object.values(obj).some(v => typeof v === 'number' && v > 0)

// The combat-relevant keys of otherBonus. fishingXpPercent, prayer, etc. are
// skilling/utility bonuses, not combat stats, so they don't qualify an item.
const COMBAT_OTHER_BONUS = ['meleeStrength', 'rangedStrength', 'magicDamage']
const hasPositiveCombatOther = (obj) =>
  !!obj && COMBAT_OTHER_BONUS.some(k => typeof obj[k] === 'number' && obj[k] > 0)

// An item belongs in the Armoury if it grants any positive combat stat: an
// attack or defence bonus, or a strength / ranged-strength / magic-damage bonus
// (so strength amulets, combat rings and ammunition are included, not just
// items with an attack/defence line).
export function hasPositiveCombatBonus(item) {
  return hasPositive(item?.attackBonus) || hasPositive(item?.defenceBonus) || hasPositiveCombatOther(item?.otherBonus)
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

// Non-combat skills. An armoury item that requires one of these (a pickaxe's
// Mining req, a hatchet's Woodcutting req, …) is filed under "Skilling" rather
// than by its attack style, so tools group together in the type filter.
const SKILLING_SKILLS = new Set([
  'mining', 'woodcutting', 'fishing', 'cooking', 'smithing', 'fletching', 'crafting',
  'herblore', 'agility', 'thieving', 'firemaking', 'farming', 'hunter', 'dungeoneering',
  'runecraft', 'slayer', 'construction',
])

// The four Armoury type-filter buckets: 'skilling' | 'melee' | 'magic' | 'ranged'.
// Skilling (a non-combat requirement) wins over the combat style, so a Dragon
// Pickaxe files under Skilling even though it swings as a melee weapon.
export function typeFilterOf(item) {
  const reqs = item?.requirements || {}
  if (Object.keys(reqs).some(k => SKILLING_SKILLS.has(k))) return 'skilling'
  return categoryOf(item)
}

export const TYPE_FILTERS = [
  { value: 'all', label: 'All gear' },
  { value: 'skilling', label: 'Skilling' },
  { value: 'melee', label: 'Melee' },
  { value: 'magic', label: 'Magic' },
  { value: 'ranged', label: 'Ranged' },
]

// How a player can obtain an item — a short list of source lines for the item
// modal (crafted via a skill, dropped by monsters, stolen/hunted, clue/raid
// reward). Empty when no source is found in the data.
export function describeObtainment(item, data = {}) {
  const id = item?.id
  if (!id) return []
  const items = data.items || itemsData
  const skills = data.skills || skillsData
  const monsters = data.monsters || monstersData
  const out = []

  // Made with a production skill (action.product === id).
  for (const skill of Object.values(skills)) {
    const action = (skill.actions || []).find(a => a.product === id)
    if (action) { out.push(`Made with ${skill.name} (level ${action.level})`); break }
  }

  // Stolen from a Thieving target (npc drops or gem/seed reward tables).
  for (const npc of skills.thieving?.npcs || []) {
    const ids = [...(npc.drops || []).map(d => d.itemId), ...(npc.gems || []).map(g => g.itemId)]
    if (ids.includes(id)) { out.push(`Stolen from ${npc.name}`); break }
  }

  // Caught via a Hunter action reward table.
  for (const action of skills.hunter?.actions || []) {
    const hit = (action.rewardTables || []).some(t => (t.rewards || []).some(r => (r.itemId || r) === id))
    if (hit) { out.push(`Hunted via ${action.name}`); break }
  }

  // Dropped by monsters.
  const droppers = []
  for (const m of Object.values(monsters)) {
    if ((m.drops || []).some(d => d.itemId === id)) droppers.push(m.name)
  }
  if (droppers.length) {
    const shown = droppers.slice(0, 6).join(', ')
    out.push(`Dropped by ${shown}${droppers.length > 6 ? `, and ${droppers.length - 6} more` : ''}`)
  }

  if (!out.length && items[id]?.shopValue > 0) out.push('Bought from shops or traded for coins')
  return out
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
