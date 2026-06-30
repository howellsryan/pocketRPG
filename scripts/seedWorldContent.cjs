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
// A place's facilities are authored directly in world.json (`place.facilities`).
function facilitiesFor(placeId, place) {
  return Array.isArray(place.facilities) ? place.facilities : []
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
// Places ordered low -> high so low-level content lands in the easiest places and the
// highest in cities. The START place is anchored first so a fresh character always has
// the lowest-level monsters where they begin; the rest follow by tier rank then id.
// Robust to whichever tiers a world actually uses.
const TIER_RANK = { hamlet: 0, village: 1, town: 2, city: 3 }
const placesOrdered = [
  world.start,
  ...Object.keys(world.places)
    .filter((id) => id !== world.start)
    .sort((a, b) => (TIER_RANK[world.places[a].tier] ?? 2) - (TIER_RANK[world.places[b].tier] ?? 2) || (a < b ? -1 : 1)),
].filter((id) => world.places[id])

// Assign a category across places by level rank. `items` -> [{ ref, level }].
function distribute(kind, items, out) {
  const sorted = items.slice().sort((a, b) => (a.level - b.level) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  const n = sorted.length
  const N = placesOrdered.length
  sorted.forEach((item, i) => {
    const p = n <= 1 ? 0 : i / n // 0..<1 rank
    const placeId = placesOrdered[Math.min(N - 1, Math.floor(p * N))]
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

// Write back: activities only (geography + facilities are authored in world.json).
// Deduped, sorted for stable diffs.
for (const id of Object.keys(world.places)) {
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
