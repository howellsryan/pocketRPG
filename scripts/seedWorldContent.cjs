#!/usr/bin/env node
/**
 * seedWorldContent.cjs — deterministic content -> place authoring tool.
 *
 * Phase 3 of the map-driven overhaul (docs/map-driven-overhaul-plan.md) needs every
 * startable activity (combat monster, skill action, gather task, agility/thieving/
 * hunter action, construction build) to live at a place so it can be gated by travel.
 * Hand-authoring ~400 assignments onto the placeholder 8-place "Cinder Reach" geography
 * is impractical and low-value (the geography is throwaway — real curated geography is a
 * later effort, decision #4). So this script distributes content deterministically by
 * level/tier band and writes the resulting `activities` arrays back into
 * src/data/world.json. COMMIT THE OUTPUT — world.json stays the source of truth.
 *
 * Re-run after adding content: `node scripts/seedWorldContent.cjs`. Output is stable
 * across runs (sorted by level then id), so the diff is meaningful.
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

// Skills that start as a `type: 'skill'` activeTask from SkillingScreen/ConstructionScreen
// and are genuinely place-bound resources. agility/thieving/hunter have their own kinds;
// magic/prayer/slayer/dungeoneering/farming are cast-in-combat, passive, or have no
// standalone place-bound action, so they are intentionally left unmapped (they fall
// through `resolveActivityStart` -> start normally).
const GATED_SKILLS = ['mining', 'woodcutting', 'fishing', 'smithing', 'cooking', 'fletching', 'crafting', 'herblore', 'firemaking', 'runecraft']

const asArray = (v) => (Array.isArray(v) ? v : Object.values(v || {}))

// Places grouped by tier rank, sorted by id for deterministic round-robin.
const TIER_ORDER = ['hamlet', 'village', 'town', 'city']
const placesByTier = {}
for (const t of TIER_ORDER) placesByTier[t] = []
for (const id of Object.keys(world.places)) {
  const tier = world.places[id].tier
  if (placesByTier[tier]) placesByTier[tier].push(id)
}
for (const t of TIER_ORDER) placesByTier[t].sort()

// Percentile -> tier band. Lower bands hold the bulk of (low-level, numerous) content;
// the top slice goes to the single city. Tuned so every tier receives content.
function tierForPercentile(p) {
  if (p < 0.40) return 'hamlet'
  if (p < 0.65) return 'village'
  if (p < 0.85) return 'town'
  return 'city'
}

// Assign a category of items across the places. `items` -> [{ ref, level }].
// Sorted by (level asc, ref asc); each item's rank percentile picks a tier, then a
// round-robin index picks a place within that tier. Guarantees full coverage.
function distribute(kind, items, out) {
  const sorted = items.slice().sort((a, b) => (a.level - b.level) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  const n = sorted.length
  sorted.forEach((item, i) => {
    const p = n <= 1 ? 0 : i / (n - 1)
    const tier = tierForPercentile(p)
    const pool = placesByTier[tier]
    const placeId = pool[i % pool.length]
    out[placeId] = out[placeId] || []
    out[placeId].push({ kind, ref: item.ref })
  })
}

const out = {}
for (const id of Object.keys(world.places)) out[id] = []

// Combat: every monster by combatLevel.
distribute('combat', asArray(monsters).map((m) => ({ ref: m.id, level: m.combatLevel ?? 1 })), out)

// Skill actions for the gated production/gathering skills.
const skillItems = []
for (const skillId of GATED_SKILLS) {
  for (const a of asArray(skills[skillId]?.actions)) {
    skillItems.push({ ref: `${skillId}:${a.id}`, level: a.level ?? 1 })
  }
}
distribute('skill', skillItems, out)

// Construction builds.
distribute('skill', asArray(BUILDING_ACTIONS).map((a) => ({ ref: `construction:${a.id}`, level: a.level ?? 1 })), out)

// Agility / thieving / hunter — own kinds, action.level for banding.
distribute('agility', asArray(skills.agility?.actions).map((a) => ({ ref: a.id, level: a.level ?? 1 })), out)
distribute('thieving', asArray(skills.thieving?.actions).map((a) => ({ ref: a.id, level: a.level ?? 1 })), out)
distribute('hunter', asArray(skills.hunter?.actions).map((a) => ({ ref: a.id, level: a.level ?? 1 })), out)

// Gather tasks have no level; band them by their order (proxy) so they spread.
distribute('gather', GATHER_TASKS.map((t, i) => ({ ref: t.id, level: i })), out)

// Write back: replace each place's activities, sorted (kind, ref) for stable diffs.
for (const id of Object.keys(world.places)) {
  const acts = (out[id] || []).slice().sort((a, b) =>
    (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  world.places[id].activities = acts
}

// Ensure kinds map has labels/colours for the new activity kinds (hub rendering).
world.kinds = Object.assign({}, world.kinds, {
  skill: { label: 'Skill', color: 'var(--color-emerald-light)' },
  gather: { label: 'Gather', color: 'var(--color-emerald)' },
  agility: { label: 'Agility', color: 'var(--color-mana-light)' },
  thieving: { label: 'Thieving', color: 'var(--tier-bronze)' },
  hunter: { label: 'Hunter', color: 'var(--color-gold)' },
})

fs.writeFileSync(worldPath, JSON.stringify(world, null, 2) + '\n')

const counts = {}
for (const id of Object.keys(world.places)) counts[id] = world.places[id].activities.length
const total = Object.values(counts).reduce((s, v) => s + v, 0)
console.log(`Seeded ${total} activities across ${Object.keys(world.places).length} places:`)
for (const id of Object.keys(counts)) console.log(`  ${id.padEnd(12)} ${counts[id]}`)
