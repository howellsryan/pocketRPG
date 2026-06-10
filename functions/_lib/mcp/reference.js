// Reference data for the MCP context layer: compact indexes + lookups over the
// static game content, plus the derived shop catalog and a mechanics summary.
// Powers MCP resources (resources/read) and the inspect_* tools so the agent
// can resolve item/monster ids to names and reason about the game.

import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }
import skillsData from '../../../src/data/skills.json' assert { type: 'json' }
import spellsData from '../../../src/data/spells.json' assert { type: 'json' }
import prayersData from '../../../src/data/prayers.json' assert { type: 'json' }
import minigamesData from '../../../src/data/minigames.json' assert { type: 'json' }
import raidsData from '../../../src/data/raids.json' assert { type: 'json' }
import farmingData from '../../../src/data/farming.json' assert { type: 'json' }
import questsData from '../../../src/data/quests.json' assert { type: 'json' }
import cluesData from '../../../src/data/clues.json' assert { type: 'json' }

// ── Item / monster lookups ───────────────────────────────────────────────────

export function getItem(id) {
  return id && itemsData[id] ? itemsData[id] : null
}

export function itemName(id) {
  return itemsData[id]?.name || id || null
}

// Attach a human-readable name to an {itemId, quantity, …} record.
export function withItemName(entry) {
  if (!entry || typeof entry !== 'object') return entry
  const id = entry.itemId ?? entry.id
  return { ...entry, itemId: id, name: itemName(id) }
}

export function getMonster(id) {
  if (!id) return null
  if (Array.isArray(monstersData)) return monstersData.find((m) => m.id === id) || null
  return monstersData[id] || null
}

function monsterList() {
  return Array.isArray(monstersData) ? monstersData : Object.values(monstersData)
}

// ── Compact indexes (items.json/monsters.json are large; detail via inspect_*) ─

export function itemsIndex() {
  return Object.values(itemsData).map((it) => ({
    id: it.id,
    name: it.name,
    type: it.type,
    stackable: !!it.stackable,
    shopValue: it.shopValue ?? null,
  }))
}

export function monstersIndex() {
  return monsterList().map((m) => ({
    id: m.id,
    name: m.name,
    combatLevel: m.combatLevel ?? null,
    hitpoints: m.hitpoints ?? null,
    boss: !!m.boss,
  }))
}

// ── Browse/search helpers (power the list_* tools) ───────────────────────────
// The indexes above are large (hundreds of items/monsters), and many MCP
// clients don't surface resources to the model at all — so these let the agent
// discover PocketRPG ids and values through ordinary tool calls instead of
// guessing them (or importing them from another game).

const SKILL_ACTION_KEYS = ['actions', 'courses', 'npcs', 'options']

export const SKILL_IDS = Object.keys(skillsData)

function skillActionList(skill) {
  const key = SKILL_ACTION_KEYS.find((k) => Array.isArray(skill?.[k]))
  return { key: key || null, list: key ? skill[key] : [] }
}

// Overview of every skill: id, name and how many trainable options it has.
export function listSkills() {
  return Object.values(skillsData).map((sk) => {
    const { key, list } = skillActionList(sk)
    return { id: sk.id, name: sk.name, actionKey: key, actionCount: list.length }
  })
}

// Full trainable options for one skill (mining ores, agility courses, thieving
// npcs, …) with their level/xp so the agent can plan training. null = unknown id.
export function getSkillActions(skillId) {
  const skill = skillsData[skillId]
  if (!skill) return null
  const { key, list } = skillActionList(skill)
  return { id: skill.id, name: skill.name, actionKey: key, actions: list }
}

function nameMatches(name, id, query) {
  if (!query) return true
  const q = String(query).toLowerCase()
  return String(name || '').toLowerCase().includes(q) || String(id || '').toLowerCase().includes(q)
}

function clampLimit(limit) {
  return Math.max(1, Math.min(Number(limit) || 50, 200))
}

// Filter the item index by name/id substring and (optionally) type.
export function searchItems({ query, type, limit } = {}) {
  const cap = clampLimit(limit)
  const all = itemsIndex().filter((it) => (!type || it.type === type) && nameMatches(it.name, it.id, query))
  return { total: all.length, returned: Math.min(all.length, cap), items: all.slice(0, cap) }
}

// Filter the monster index by name/id substring.
export function searchMonsters({ query, limit } = {}) {
  const cap = clampLimit(limit)
  const all = monstersIndex().filter((m) => nameMatches(m.name, m.id, query))
  return { total: all.length, returned: Math.min(all.length, cap), monsters: all.slice(0, cap) }
}

// Item value reference. shopValue is the static reference price; since the
// 2026-06 order-book migration these items are traded player-to-player on
// the Trading Post order book (search_market / place_offer), NOT bought from
// an infinite store — buy_item only works for quest-unlock items, skill
// capes and minigame unlock products.
export function shopCatalog() {
  return Object.values(itemsData)
    .filter((it) => it.isGeneralStore === true && !it.isBossUnique && !it.isClueReward && !it.isRaidUnique)
    .map((it) => ({ id: it.id, name: it.name, shopValue: it.shopValue ?? null }))
}

// ── Mechanics summary (kept aligned with AGENTS.md core invariants) ──────────

export const MECHANICS = `# PocketRPG core mechanics

> PocketRPG is its own game — NOT Old School RuneScape / RuneScape. Item names,
> monster stats, drop tables, XP rates, requirements and prices are
> PocketRPG-specific and frequently differ from RuneScape. Source every value
> from these tools/resources; never import figures from another game or the web.

- Menu-driven idle/simulation fantasy RPG. Engine tick: 600ms.
- Levels 1–99 per skill. XP cap 200,000,000. Use floor() for all gameplay rounding.
- Inventory is a hard 28-slot limit. HP regenerates +1 every 60s.
- Combat XP: 4 XP per damage to the primary skill, 1.33 XP per damage to Hitpoints.
  Magic: base spell XP + 2 XP per damage. Hitpoints starts at level 10 (1,154 XP).
- Combat styles: Accurate/Aggressive/Defensive give +3 to the relevant effective
  level; Controlled gives +1 to attack/strength/defence.
- Melee max hit = floor(0.5 + effectiveStr * (bonus + 64) / 640).
- Economy model: XP, coins and most skilling/idle loot are computed by the
  client and saved; high-value uniques, purchases and credits are granted
  server-side. Prefer the server-authoritative tools for those.`

// ── Resource registry ────────────────────────────────────────────────────────

const REFERENCE = {
  'pocketrpg://reference/mechanics': { mime: 'text/markdown', name: 'Game mechanics', body: () => MECHANICS },
  'pocketrpg://reference/items': { mime: 'application/json', name: 'Item index', body: () => itemsIndex() },
  'pocketrpg://reference/monsters': { mime: 'application/json', name: 'Monster index', body: () => monstersIndex() },
  'pocketrpg://reference/shop': { mime: 'application/json', name: 'Item value reference (items trade on the player order book)', body: () => shopCatalog() },
  'pocketrpg://reference/skills': { mime: 'application/json', name: 'Skills & actions', body: () => skillsData },
  'pocketrpg://reference/spells': { mime: 'application/json', name: 'Spellbook', body: () => spellsData },
  'pocketrpg://reference/prayers': { mime: 'application/json', name: 'Prayers', body: () => prayersData },
  'pocketrpg://reference/quests': { mime: 'application/json', name: 'Quests', body: () => questsData },
  'pocketrpg://reference/clues': { mime: 'application/json', name: 'Clue scrolls', body: () => cluesData },
  'pocketrpg://reference/minigames': { mime: 'application/json', name: 'Minigames', body: () => minigamesData },
  'pocketrpg://reference/raids': { mime: 'application/json', name: 'Raids', body: () => raidsData },
  'pocketrpg://reference/farming': { mime: 'application/json', name: 'Farming', body: () => farmingData },
}

// Short topic names → reference uris, for the get_reference tool. The big
// item/monster indexes are intentionally omitted (use list_items/list_monsters
// or inspect_*); everything else is small enough to return whole.
export const REFERENCE_TOPICS = {
  mechanics: 'pocketrpg://reference/mechanics',
  shop: 'pocketrpg://reference/shop',
  skills: 'pocketrpg://reference/skills',
  spells: 'pocketrpg://reference/spells',
  prayers: 'pocketrpg://reference/prayers',
  quests: 'pocketrpg://reference/quests',
  clues: 'pocketrpg://reference/clues',
  minigames: 'pocketrpg://reference/minigames',
  raids: 'pocketrpg://reference/raids',
  farming: 'pocketrpg://reference/farming',
}

export const REFERENCE_TOPIC_NAMES = Object.keys(REFERENCE_TOPICS)

export const REFERENCE_RESOURCES = Object.entries(REFERENCE).map(([uri, r]) => ({
  uri,
  name: r.name,
  description: r.name,
  mimeType: r.mime,
}))

export function readReference(uri) {
  const r = REFERENCE[uri]
  if (!r) return null
  const value = r.body()
  return { mimeType: r.mime, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }
}
