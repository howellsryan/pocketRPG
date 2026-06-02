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

function itemsIndex() {
  return Object.values(itemsData).map((it) => ({
    id: it.id,
    name: it.name,
    type: it.type,
    stackable: !!it.stackable,
    shopValue: it.shopValue ?? null,
  }))
}

function monstersIndex() {
  return monsterList().map((m) => ({
    id: m.id,
    name: m.name,
    combatLevel: m.combatLevel ?? null,
    hitpoints: m.hitpoints ?? null,
  }))
}

// General-store catalogue (the agent's buyable list). Mirrors the buy path's
// gate that boss/clue/raid uniques are not purchasable.
export function shopCatalog() {
  return Object.values(itemsData)
    .filter((it) => it.isGeneralStore === true && !it.isBossUnique && !it.isClueReward && !it.isRaidUnique)
    .map((it) => ({ id: it.id, name: it.name, shopValue: it.shopValue ?? null }))
}

// ── Mechanics summary (kept aligned with AGENTS.md core invariants) ──────────

export const MECHANICS = `# PocketRPG core mechanics

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
  'pocketrpg://reference/shop': { mime: 'application/json', name: 'General store catalogue', body: () => shopCatalog() },
  'pocketrpg://reference/skills': { mime: 'application/json', name: 'Skills & actions', body: () => skillsData },
  'pocketrpg://reference/spells': { mime: 'application/json', name: 'Spellbook', body: () => spellsData },
  'pocketrpg://reference/prayers': { mime: 'application/json', name: 'Prayers', body: () => prayersData },
  'pocketrpg://reference/quests': { mime: 'application/json', name: 'Quests', body: () => questsData },
  'pocketrpg://reference/clues': { mime: 'application/json', name: 'Clue scrolls', body: () => cluesData },
  'pocketrpg://reference/minigames': { mime: 'application/json', name: 'Minigames', body: () => minigamesData },
  'pocketrpg://reference/raids': { mime: 'application/json', name: 'Raids', body: () => raidsData },
  'pocketrpg://reference/farming': { mime: 'application/json', name: 'Farming', body: () => farmingData },
}

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
