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
import cluesData from '../data/clues.json'
import raidsData from '../data/raids.json'
import minigamesData from '../data/minigames.json'
import { isOrderBookItem } from '../engine/storeRules.js'
import { SLAYER_UNLOCKS } from '../engine/slayerUnlocks.js'
import { isZestaUnique } from '../engine/pvpBotRewards.js'

// Lazily built the first time it's needed — never at module-eval time. In the
// single-file build this module is concatenated ahead of slayerUnlocks.js, so
// touching SLAYER_UNLOCKS at top level throws a temporal-dead-zone ReferenceError
// that takes the whole app down (§12). Deferring the access to call time avoids it.
let _slayerUnlockIds = null
function slayerUnlockIds() {
  if (!_slayerUnlockIds) _slayerUnlockIds = new Set(SLAYER_UNLOCKS.map(u => u.itemId))
  return _slayerUnlockIds
}

const hasPositive = (obj) => !!obj && Object.values(obj).some(v => typeof v === 'number' && v > 0)

// The combat-relevant keys of otherBonus. fishingXpPercent, prayer, etc. are
// skilling/utility bonuses, not combat stats, so they don't qualify an item.
const COMBAT_OTHER_BONUS = ['meleeStrength', 'rangedStrength', 'magicDamage']
const hasPositiveCombatOther = (obj) =>
  !!obj && COMBAT_OTHER_BONUS.some(k => typeof obj[k] === 'number' && obj[k] > 0)

// True when the item grants any positive combat stat (attack/defence bonus, or
// strength / ranged-strength / magic-damage). Retained as the canonical
// "is this combat gear" rule; the Armoury includes items regardless (below).
export function hasPositiveCombatBonus(item) {
  return hasPositive(item?.attackBonus) || hasPositive(item?.defenceBonus) || hasPositiveCombatOther(item?.otherBonus)
}

// The eleven equipment slots (mirrors EQUIPMENT_SLOTS in utils/constants.js).
const EQUIP_SLOTS = new Set(['head', 'body', 'legs', 'weapon', 'shield', 'gloves', 'boots', 'cape', 'neck', 'ring', 'ammo'])

// An item belongs in the Armoury if it can be equipped — it occupies one of the
// eleven equipment slots. Everything wieldable/wearable is listed, combat gear
// or not (fishing rods, spades, cosmetics, prayer ammo included).
export function isEquippable(item) {
  return !!item && EQUIP_SLOTS.has(item.slot)
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

// Gathering skills whose training uses an equipped tool-weapon (an axe for
// Woodcutting, a pickaxe for Mining, a harpoon for Fishing, …). A weapon that
// requires one of these is a skilling tool. Slayer, Dungeoneering and Agility
// gate *combat* gear rather than tools, so they are deliberately excluded — a
// Slayer-gated defender or gloves, or a Dungeoneering chaotic weapon, stays in
// its Melee/Magic/Ranged bucket.
const SKILLING_TOOL_SKILLS = new Set([
  'woodcutting', 'mining', 'fishing', 'farming', 'hunter', 'firemaking',
])

// Non-combat otherBonus keys that mark a skilling tool (an XP boost or a
// gathering-level requirement), e.g. the Angler Net's fishingXpPercent.
const SKILLING_OTHER_BONUS = new Set(['fishingXpPercent', 'miningLevel', 'woodcuttingLevel'])

// Item kinds (name noun) that are unambiguously gathering tools even without a
// skill requirement — Gold Spade, Angler Net, etc. "Axe"/"Pickaxe" are omitted:
// real ones carry a Woodcutting/Mining requirement, and the kind alone would
// misfile combat weapons like the Emberhowl Axe.
const SKILLING_TOOL_KINDS = new Set(['harpoon', 'net', 'rod', 'cage', 'spade', 'tinderbox', 'secateurs'])

// A weapon/tool used to train a gathering skill (not a combat weapon). Detected
// from the strongest signal down: an explicit `tool` type, a gathering-skill
// requirement, a skilling bonus, or an unambiguous tool kind.
export function isSkillingTool(item) {
  if (!item) return false
  const isToolLike = item.type === 'tool' || item.type === 'weapon' || item.slot === 'weapon'
  if (!isToolLike) return false
  if (item.type === 'tool') return true
  const reqs = item.requirements || {}
  if (Object.keys(reqs).some(k => SKILLING_TOOL_SKILLS.has(k))) return true
  const other = item.otherBonus || {}
  if (Object.keys(other).some(k => SKILLING_OTHER_BONUS.has(k) && other[k])) return true
  return SKILLING_TOOL_KINDS.has(kindOf(item).toLowerCase())
}

// The four Armoury type-filter buckets: 'skilling' | 'melee' | 'magic' | 'ranged'.
// Skilling holds skill capes and gathering-tool weapons (a Dragon Axe used for
// Woodcutting, a fishing rod, a spade); everything else — combat weapons, all
// other armour — files by its combat style even when a skill gates equipping it.
export function typeFilterOf(item) {
  if (isSkillCape(item) || isSkillingTool(item)) return 'skilling'
  return categoryOf(item)
}

export const TYPE_FILTERS = [
  { value: 'all', label: 'All gear' },
  { value: 'skilling', label: 'Skilling' },
  { value: 'melee', label: 'Melee' },
  { value: 'magic', label: 'Magic' },
  { value: 'ranged', label: 'Ranged' },
]

const titleCaseId = (id) => String(id || '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

const CLUE_TIER_ORDER = ['medium', 'hard', 'elite', 'master']

// Reverse indexes mapping an itemId to each place it can come from. Built once
// and cached — the tables are static content. Keyed by data identity so tests
// passing custom data get their own index.
const _sourceIndexCache = new WeakMap()
function sourceIndex(items, skills, monsters, clues, raids, minigames) {
  const cached = _sourceIndexCache.get(items)
  if (cached) return cached
  const name = (id) => items[id]?.name || titleCaseId(id)

  const crafted = new Map() // id -> { skill, level }
  for (const skill of Object.values(skills)) {
    for (const a of skill.actions || []) if (a.product && !crafted.has(a.product)) crafted.set(a.product, { skill: skill.name, level: a.level })
  }

  const combine = new Map() // result id -> "combine A with B" text
  for (const it of Object.values(items)) {
    if (it.combineResult && !combine.has(it.combineResult)) combine.set(it.combineResult, `Forged by combining ${it.name} with ${name(it.combineWith)}`)
  }

  const clueTiers = new Map() // id -> Set(tier)
  for (const [tier, data] of Object.entries(clues)) {
    for (const r of data.rewards || []) {
      if (!clueTiers.has(r.itemId)) clueTiers.set(r.itemId, new Set())
      clueTiers.get(r.itemId).add(tier)
    }
  }

  const raid = new Map() // id -> raid name (uniques come from the raid chest)
  const seenRaid = new Set()
  for (const [key, r] of Object.entries(raids)) {
    const rid = r.id || key
    if (seenRaid.has(rid)) continue
    seenRaid.add(rid)
    for (const u of (r.rewards?.unique?.items) || []) {
      const iid = u.itemId || u
      if (!raid.has(iid)) raid.set(iid, r.name)
    }
  }

  const minigame = new Map() // reward item id -> minigame label
  const mgLabels = Object.fromEntries((minigames.minigames || []).map(m => [m.id, m.label]))
  for (const t of minigames.tasks || []) {
    const label = mgLabels[t.minigame] || t.minigame || 'a minigame'
    // A task grants either a single `product` or a set via `rewardItems`.
    for (const iid of [t.product, ...(t.rewardItems || [])]) if (iid && !minigame.has(iid)) minigame.set(iid, label)
  }

  const drops = new Map() // id -> [monster names]
  for (const m of Object.values(monsters)) {
    for (const d of m.drops || []) {
      if (!drops.has(d.itemId)) drops.set(d.itemId, [])
      drops.get(d.itemId).push(m.name)
    }
  }

  const thieving = new Map() // id -> npc name
  for (const npc of skills.thieving?.npcs || []) {
    for (const iid of [...(npc.drops || []).map(d => d.itemId), ...(npc.gems || []).map(g => g.itemId)]) {
      if (!thieving.has(iid)) thieving.set(iid, npc.name)
    }
  }

  const hunter = new Map() // id -> hunter action name
  for (const a of skills.hunter?.actions || []) {
    for (const t of a.rewardTables || []) for (const r of t.rewards || []) {
      const iid = r.itemId || r
      if (!hunter.has(iid)) hunter.set(iid, a.name)
    }
  }

  const idx = { crafted, combine, clueTiers, raid, minigame, drops, thieving, hunter }
  _sourceIndexCache.set(items, idx)
  return idx
}

// How a player can obtain an item — the full set of source lines for the item
// modal, ordered from most specific (combine recipe, craft) to broad. Every
// equippable item resolves to at least one line.
export function describeObtainment(item, data = {}) {
  const id = item?.id
  if (!id) return []
  const items = data.items || itemsData
  const idx = sourceIndex(
    items, data.skills || skillsData, data.monsters || monstersData,
    data.clues || cluesData, data.raids || raidsData, data.minigames || minigamesData,
  )
  const out = []

  if (idx.combine.has(id)) out.push(idx.combine.get(id))
  if (idx.crafted.has(id)) { const c = idx.crafted.get(id); out.push(`Made with ${c.skill} (level ${c.level})`) }

  const raidName = idx.raid.get(id)
  if (raidName) out.push(`Reward from the ${raidName} raid`)

  if (idx.clueTiers.has(id)) {
    const tiers = [...idx.clueTiers.get(id)].sort((a, b) => CLUE_TIER_ORDER.indexOf(a) - CLUE_TIER_ORDER.indexOf(b))
    out.push(`Found in ${tiers.join(', ')} clue scrolls`)
  } else if (item.isClueReward) {
    out.push('Found in clue scroll rewards')
  }

  if (idx.minigame.has(id)) out.push(`Earned from ${idx.minigame.get(id)}`)
  if (idx.thieving.has(id)) out.push(`Stolen from ${idx.thieving.get(id)}`)
  if (idx.hunter.has(id)) out.push(`Hunted via ${idx.hunter.get(id)}`)

  if (slayerUnlockIds().has(id)) out.push('Bought with Slayer points on the Character Unlocks screen')
  if (isZestaUnique(id)) out.push('A rare drop from winning PvP bot matches')
  if (item.isSkillCape) out.push('Bought once you reach level 99 in its skill')
  else if (item.isMaxCape) out.push('Bought once every skill reaches level 99')

  // Monster drops — skipped for raid uniques (their raid-boss drop table is
  // never rolled; the loot comes from the raid chest, already noted above).
  const droppers = idx.drops.get(id)
  if (droppers?.length && !raidName) {
    const shown = droppers.slice(0, 6).join(', ')
    out.push(`Dropped by ${shown}${droppers.length > 6 ? `, and ${droppers.length - 6} more` : ''}`)
  }

  if (item.isGeneralStore) out.push('Bought from the general store')
  else if (item.questUnlock) out.push('Unlocked through a quest')

  if (!out.length) {
    if (item.isBossUnique) out.push('Dropped by a boss')
    else if (isOrderBookItem(item)) out.push('Traded from other players on the Trading Post')
    else out.push('Obtained through gameplay')
  }
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
    if (!isEquippable(item)) continue
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
