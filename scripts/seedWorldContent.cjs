#!/usr/bin/env node
/**
 * seedWorldContent.cjs — deterministic content -> place authoring tool.
 *
 * Phase 3 of the map-driven overhaul (docs/map-driven-overhaul-plan.md) needs every
 * startable activity (combat monster, skill action, gather task, agility/hunter action)
 * to live at a place so it can be gated by travel. Hand-authoring ~400 assignments onto
 * the placeholder 8-place "Cinder Reach" geography is impractical and low-value (the
 * geography is throwaway — real curated geography is a later effort, decision #4). So
 * this script assigns content and writes the resulting `activities` mapping to
 * src/data/worldActivities.json ({ placeId: [{ kind, ref }] }); geography stays in
 * src/data/world.json. COMMIT THE OUTPUT — those two files are the source of truth.
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
const quests = require(path.join(ROOT, 'src/data/quests.json'))
const skills = require(path.join(ROOT, 'src/data/skills.json'))
const raids = require(path.join(ROOT, 'src/data/raids.json'))
const minigames = require(path.join(ROOT, 'src/data/minigames.json'))
const { GATHER_TASKS } = require(path.join(ROOT, 'src/engine/gatherTasks.js'))
const { BUILDING_ACTIONS } = require(path.join(ROOT, 'src/engine/construction.js'))

const asArray = (v) => (Array.isArray(v) ? v : Object.values(v || {}))

// ---- raids ------------------------------------------------------------------------
// Raids are their own activity kind (kind 'raid'), authored at a fixed city — NOT
// distributed as combat. raids.json keys content under both PocketRPG-canonical ids and
// OSRS-name aliases that share a `raid.id`; dedupe to the canonical id so each raid is
// placed once. Their boss monsters are excluded from the combat distribution below so a
// raid never shows up in a place hub as a standalone monster.
const canonicalRaids = []
const seenRaidIds = new Set()
for (const raid of asArray(raids)) {
  if (!raid || !raid.id || seenRaidIds.has(raid.id)) continue
  seenRaidIds.add(raid.id)
  canonicalRaids.push(raid)
}
// Raid -> host city (legend: cities host raids). Authored, not level-banded.
const RAID_PLACEMENT = {
  vaults_of_xyren: 'faloden',
  crimson_night_theatre: 'varrick',
  cryptbound_champions: 'ardounne',
  tomb_of_arasmus: 'ardounne',
}
const RAID_DEFAULT_CITY = 'varrick'
const raidBossIds = new Set()
for (const raid of canonicalRaids) for (const b of raid.bosses || []) raidBossIds.add(b)

// ---- facilities -------------------------------------------------------------------
// Skills tied to a building. Every action of these skills is available at every place
// that has the matching facility (not level-banded).
const FACILITY_SKILLS = {
  bank: ['construction', 'magic', 'firemaking', 'herblore', 'fletching', 'crafting'],
  furnace_anvil: ['smithing'],
  altar: ['prayer'],
  stove: ['cooking'],
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

// Combat: every monster by combatLevel, excluding raid bosses (those are raid content,
// placed below as kind 'raid' — never as a standalone monster).
distribute('combat', asArray(monsters).filter((m) => !raidBossIds.has(m.id)).map((m) => ({ ref: m.id, level: m.combatLevel ?? 1 })), out)

// Raids: authored at a fixed city (kind 'raid'), one entry per canonical raid.
for (const raid of canonicalRaids) {
  const placeId = world.places[RAID_PLACEMENT[raid.id]] ? RAID_PLACEMENT[raid.id] : RAID_DEFAULT_CITY
  out[placeId] = out[placeId] || []
  out[placeId].push({ kind: 'raid', ref: raid.id })
}

// Level-band skill actions (gathering + runecraft).
const skillItems = []
for (const skillId of LEVEL_BAND_SKILLS) {
  for (const a of asArray(skills[skillId]?.actions)) skillItems.push({ ref: `${skillId}:${a.id}`, level: a.level ?? 1 })
}
distribute('skill', skillItems, out)

// Agility — authored 1:1 to its namesake world city (rooftop courses are renamed to
// match the city they sit above), matching OSRS course levels. Not level-banded.
const AGILITY_PLACEMENT = {
  gnome_stronghold: 'lumbright',
  draynor_village: 'draynar',
  al_kharid: 'alkarid',
  varrock: 'varrick',
  canifis: 'canifel',
  falador: 'faloden',
  seers_village: 'seerhold',
  pollnivneach: 'brimhollow',
  rellekka: 'catherra',
  ardougne: 'ardounne',
}
for (const a of asArray(skills.agility?.actions)) {
  const placeId = world.places[AGILITY_PLACEMENT[a.id]] ? AGILITY_PLACEMENT[a.id] : placesOrdered[0]
  out[placeId] = out[placeId] || []
  out[placeId].push({ kind: 'agility', ref: a.id })
}

// Minigames — authored 1:1 to a place, like agility (a minigame is a fixed venue, not
// something to level-band). Every reward task of a minigame is gated together since
// they're all "the same place" from the player's perspective.
const MINIGAME_PLACEMENT = {
  pest_control: 'portsarin',
  castle_wars: 'ardounne',
  barbarian_assault: 'camlann',
  fishing_trawler: 'catherra',
  mage_arena: 'edgevale',
  warriors_guild: 'barlock',
}
for (const mg of asArray(minigames.minigames)) {
  const placeId = world.places[MINIGAME_PLACEMENT[mg.id]] ? MINIGAME_PLACEMENT[mg.id] : placesOrdered[0]
  out[placeId] = out[placeId] || []
  out[placeId].push({ kind: 'minigame', ref: mg.id })
}

// Thieving — own kind, level-banded (pickpocketing needs no facility, unlike the other
// bank skills, so it isn't bundled into FACILITY_SKILLS). ardougne_knight is authored to
// Ardounne by name, like the agility courses; every other target spreads by level, same
// as combat/mining, so a place only offers a handful of pickpocket targets, not all of
// them.
const THIEVING_PLACEMENT = { ardougne_knight: 'ardounne' }
const thievingItems = []
for (const n of asArray(skills.thieving?.npcs)) {
  if (THIEVING_PLACEMENT[n.id]) {
    const placeId = world.places[THIEVING_PLACEMENT[n.id]] ? THIEVING_PLACEMENT[n.id] : placesOrdered[0]
    out[placeId] = out[placeId] || []
    out[placeId].push({ kind: 'thieving', ref: n.id })
  } else {
    thievingItems.push({ ref: n.id, level: n.level ?? 1 })
  }
}
distribute('thieving', thievingItems, out)

// Hunter — own kind, level-banded.
distribute('hunter', asArray(skills.hunter?.actions).map((a) => ({ ref: a.id, level: a.level ?? 1 })), out)

// Quests — own kind, banded by complexity (Novice starts near the start place,
// Grandmaster ends up in the cities), duration as tie-break within a tier.
// Quest journeys plan from wherever the player is, so the listing place is a
// browse/flavour home, not a start gate. Mirror COMPLEXITY_ORDER in
// src/utils/complexityColors.js.
const QUEST_COMPLEXITY_ORDER = { Novice: 1, Intermediate: 2, Experienced: 3, Master: 4, Grandmaster: 5, Special: 6 }
distribute('quest', asArray(quests).map((q) => ({
  ref: q.id,
  level: (QUEST_COMPLEXITY_ORDER[q.complexity] || 9) * 100000 + Math.min(99999, q.durationSeconds || 0),
})), out)

// Gather tasks have no level; band them by their order so they spread — except
// the sawmill's log→plank conversions, which are facility-bound: every place
// with a `sawmill` facility (world.json) converts ALL log types.
const isSawmillTask = (t) => /_to_plank$/.test(t.id)
distribute('gather', GATHER_TASKS.filter((t) => !isSawmillTask(t)).map((t, i) => ({ ref: t.id, level: i })), out)

// Facility skills/tasks: every action at every place that has the facility.
for (const id of Object.keys(world.places)) {
  const facs = facilitiesFor(id, world.places[id])
  for (const facility of facs) {
    for (const skillId of FACILITY_SKILLS[facility] || []) {
      for (const act of skillActivities(skillId)) out[id].push(act)
    }
    if (facility === 'sawmill') {
      for (const t of GATHER_TASKS.filter(isSawmillTask)) out[id].push({ kind: 'gather', ref: t.id })
    }
  }
}

// Write back: activities go to worldActivities.json ({ placeId: [{kind, ref}] }),
// kept out of world.json so the geography can ship in the single-file build's inline
// core while this heavy mapping rides the game chunk (see build_single.cjs).
// Deduped, sorted for stable diffs.
const activitiesOut = {}
for (const id of Object.keys(world.places)) {
  const seen = new Set()
  activitiesOut[id] = (out[id] || []).filter((a) => {
    const k = a.kind + '|' + a.ref
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).sort((a, b) =>
    (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  delete world.places[id].activities // defensive: never let the mapping sneak back in
}
fs.writeFileSync(path.join(ROOT, 'src/data/worldActivities.json'), JSON.stringify(activitiesOut, null, 2) + '\n')

world.kinds = Object.assign({}, world.kinds, {
  raid: { label: 'Raid', color: 'var(--color-blood-light)' },
  skill: { label: 'Skill', color: 'var(--color-emerald-light)' },
  gather: { label: 'Gather', color: 'var(--color-emerald)' },
  agility: { label: 'Agility', color: 'var(--color-mana-light)' },
  thieving: { label: 'Thieving', color: 'var(--tier-bronze)' },
  hunter: { label: 'Hunter', color: 'var(--color-gold)' },
})

fs.writeFileSync(worldPath, JSON.stringify(world, null, 2) + '\n')

const total = Object.values(activitiesOut).reduce((s, acts) => s + acts.length, 0)
console.log(`Seeded ${total} activities across ${Object.keys(world.places).length} places:`)
for (const id of Object.keys(world.places)) {
  const p = world.places[id]
  console.log(`  ${id.padEnd(12)} ${String(activitiesOut[id].length).padStart(3)}  [${p.facilities.join(', ') || '—'}]`)
}
