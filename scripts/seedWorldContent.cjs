#!/usr/bin/env node
/**
 * seedWorldContent.cjs — deterministic content -> place authoring tool.
 *
 * Phase 3 of the map-driven overhaul (docs/map-driven-overhaul-plan.md) needs every
 * startable activity (combat monster, skill action, gather task, agility/hunter action)
 * to live at a place so it can be gated by travel. Hand-authoring ~400 assignments onto
 * the placeholder 8-place "Cinder Reach" geography is impractical and low-value (the
 * geography is throwaway — real curated geography is a later effort, decision #4). So
 * this script assigns content and writes the resulting `activities` arrays back into
 * src/data/world.json. COMMIT THE OUTPUT — world.json stays the source of truth.
 *
 * Two assignment modes:
 *  - FACILITY skills are tied to a building (bank, furnace & anvil): every action of the
 *    skill is offered at every place that has the facility.
 *  - Everything else (combat, the remaining skills, agility/hunter, gather tasks) is
 *    distributed deterministically by level/tier band.
 *
 * Re-run after adding content: `node scripts/seedWorldContent.cjs`. Output is stable.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const worldPath = path.join(ROOT, 'src/data/world.json')
const world = JSON.parse(fs.readFileSync(worldPath, 'utf8'))

const monsters = require(path.join(ROOT, 'src/data/monsters.json'))
const skills = require(path.join(ROOT, 'src/data/skills.json'))
const { GATHER_TASKS } = require(path.join(ROOT, 'src/engine/gatherTasks.js'))
const { BUILDING_ACTIONS } = require(path.join(ROOT, 'src/engine/construction.js'))

const asArray = (v) => (Array.isArray(v) ? v : Object.values(v || {}))

// ---- facilities -------------------------------------------------------------------
// Skills tied to a building. Every action of these skills is available at every place
// that has the matching facility (not level-banded).
const FACILITY_SKILLS = {
  bank: ['construction', 'magic', 'thieving', 'prayer', 'firemaking', 'herblore', 'fletching', 'crafting', 'cooking'],
  furnace_anvil: ['smithing'],
}
const FACILITY_META = {
  bank: { label: 'Bank', icon: '🏦' },
  furnace_anvil: { label: 'Furnace & Anvil', icon: '🔨' },
}
// Facility placement rule for the PLACEHOLDER geography (real geography re-authors this):
// banks at every city + town; furnace & anvil at a curated subset ("only some").
const FURNACE_ANVIL_PLACES = new Set(['emberhold', 'saltmarket'])
function facilitiesFor(placeId, place) {
  const f = []
  if (place.tier === 'city' || place.tier === 'town') f.push('bank')
  if (FURNACE_ANVIL_PLACES.has(placeId)) f.push('furnace_anvil')
  return f
}

// Skills distributed by level band (kind 'skill'); the facility skills are excluded.
const LEVEL_BAND_SKILLS = ['mining', 'woodcutting', 'fishing', 'runecraft']

// All { kind, ref } activities for a single skill's actions.
function skillActivities(skillId) {
  if (skillId === 'construction') return asArray(BUILDING_ACTIONS).map((a) => ({ kind: 'skill', ref: `construction:${a.id}` }))
  if (skillId === 'thieving') return asArray(skills.thieving?.npcs).map((a) => ({ kind: 'thieving', ref: a.id }))
  return asArray(skills[skillId]?.actions).map((a) => ({ kind: 'skill', ref: `${skillId}:${a.id}` }))
}

// ---- level-band distribution ------------------------------------------------------
const TIER_ORDER = ['hamlet', 'village', 'town', 'city']
const placesByTier = {}
for (const t of TIER_ORDER) placesByTier[t] = []
for (const id of Object.keys(world.places)) {
  const tier = world.places[id].tier
  if (placesByTier[tier]) placesByTier[tier].push(id)
}
for (const t of TIER_ORDER) placesByTier[t].sort()

function tierForPercentile(p) {
  if (p < 0.40) return 'hamlet'
  if (p < 0.65) return 'village'
  if (p < 0.85) return 'town'
  return 'city'
}

// Assign a category across places by level rank. `items` -> [{ ref, level }].
function distribute(kind, items, out) {
  const sorted = items.slice().sort((a, b) => (a.level - b.level) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  const n = sorted.length
  sorted.forEach((item, i) => {
    const p = n <= 1 ? 0 : i / (n - 1)
    const pool = placesByTier[tierForPercentile(p)]
    const placeId = pool[i % pool.length]
    out[placeId] = out[placeId] || []
    out[placeId].push({ kind, ref: item.ref })
  })
}

const out = {}
for (const id of Object.keys(world.places)) out[id] = []

// Combat: every monster by combatLevel.
distribute('combat', asArray(monsters).map((m) => ({ ref: m.id, level: m.combatLevel ?? 1 })), out)

// Level-band skill actions (gathering + runecraft).
const skillItems = []
for (const skillId of LEVEL_BAND_SKILLS) {
  for (const a of asArray(skills[skillId]?.actions)) skillItems.push({ ref: `${skillId}:${a.id}`, level: a.level ?? 1 })
}
distribute('skill', skillItems, out)

// Agility / hunter — own kinds, level-banded.
distribute('agility', asArray(skills.agility?.actions).map((a) => ({ ref: a.id, level: a.level ?? 1 })), out)
distribute('hunter', asArray(skills.hunter?.actions).map((a) => ({ ref: a.id, level: a.level ?? 1 })), out)

// Gather tasks have no level; band them by their order so they spread.
distribute('gather', GATHER_TASKS.map((t, i) => ({ ref: t.id, level: i })), out)

// Facility skills: every action at every place that has the facility.
for (const id of Object.keys(world.places)) {
  const facs = facilitiesFor(id, world.places[id])
  for (const facility of facs) {
    for (const skillId of FACILITY_SKILLS[facility] || []) {
      for (const act of skillActivities(skillId)) out[id].push(act)
    }
  }
}

// Write back: facilities + activities (deduped, sorted for stable diffs).
for (const id of Object.keys(world.places)) {
  world.places[id].facilities = facilitiesFor(id, world.places[id])
  const seen = new Set()
  const acts = (out[id] || []).filter((a) => {
    const k = a.kind + '|' + a.ref
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).sort((a, b) =>
    (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  world.places[id].activities = acts
}

world.facilities = FACILITY_META
world.kinds = Object.assign({}, world.kinds, {
  skill: { label: 'Skill', color: 'var(--color-emerald-light)' },
  gather: { label: 'Gather', color: 'var(--color-emerald)' },
  agility: { label: 'Agility', color: 'var(--color-mana-light)' },
  thieving: { label: 'Thieving', color: 'var(--tier-bronze)' },
  hunter: { label: 'Hunter', color: 'var(--color-gold)' },
})

fs.writeFileSync(worldPath, JSON.stringify(world, null, 2) + '\n')

const total = Object.values(world.places).reduce((s, p) => s + p.activities.length, 0)
console.log(`Seeded ${total} activities across ${Object.keys(world.places).length} places:`)
for (const id of Object.keys(world.places)) {
  const p = world.places[id]
  console.log(`  ${id.padEnd(12)} ${String(p.activities.length).padStart(3)}  [${p.facilities.join(', ') || '—'}]`)
}
