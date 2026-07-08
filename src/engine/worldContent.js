/**
 * worldContent — maps live game content (monsters, skill actions, gather/agility/
 * thieving/hunter actions) to the world places that offer them, and decides whether an
 * activity can start where the player is or requires travel.
 *
 * Phase 3 of the map-driven overhaul (docs/map-driven-overhaul-plan.md). Pure logic, no
 * UI imports (engine layer — CLAUDE.md §3). The place->activity assignments are authored
 * into src/data/worldActivities.json by scripts/seedWorldContent.cjs; this module is the
 * read/reverse-index side plus the gating decision. Activity refs here MUST match the refs
 * the seed script writes and the shapes `activityRef` derives from a live activeTask.
 *
 * worldActivities.json is deliberately separate from world.json: the geography (a few KB)
 * ships in the single-file build's inline core (boot-time location/travel need it), while
 * the heavy activities mapping (~150 KB) rides the lazily-loaded game chunk — see
 * build_single.cjs. Core code must therefore only touch it through `placeActivities`,
 * whose typeof guard tolerates the chunk not having loaded yet.
 */
import worldData from '../data/world.json'
import worldActivitiesData from '../data/worldActivities.json'
import monstersData from '../data/monsters.json'
import skillsData from '../data/skills.json'
import raidsData from '../data/raids.json'
import minigamesData from '../data/minigames.json'
import questsData from '../data/quests.json'
import farmingData from '../data/farming.json'
import { GATHER_TASKS } from './gatherTasks.js'
import { BUILDING_ACTIONS } from './construction.js'
import { SLAYER_MASTERS } from './slayerMasters.js'
import { normaliseLocation } from './world.js'
import { getLevelFromXP } from './experience.js'
import { combatLevelFromStats } from './combatLevel.js'
import { checkQuestEligibility } from './quests.js'
import { checkBossRequirementsPure, checkRaidRequirementsPure } from './combatRequirements.js'
import { COMPLEXITY_ORDER } from '../utils/complexityColors.js'

const asArray = (v) => (Array.isArray(v) ? v : Object.values(v || {}))

// ---- content lookup tables (built once) ------------------------------------------
const monstersById = {}
for (const m of asArray(monstersData)) monstersById[m.id] = m

const gatherById = {}
for (const t of GATHER_TASKS) gatherById[t.id] = t

const buildingById = {}
for (const a of asArray(BUILDING_ACTIONS)) buildingById[a.id] = a

const minigamesById = {}
for (const mg of asArray(minigamesData.minigames)) minigamesById[mg.id] = mg

const questsById = {}
for (const q of asArray(questsData)) questsById[q.id] = q

// Farm locations keyed by their own id (src/data/farming.json). Each carries a
// `placeId` pinning it to the world place that offers it (kind 'farming' — a
// place hosts at most one farm). Used to describe/gate the farming activity.
const farmLocationsById = {}
for (const loc of asArray(farmingData.locations)) farmLocationsById[loc.id] = loc

/** Resolve a `${skillId}:${actionId}` skill ref to its action object. */
function skillAction(skillRef) {
  const idx = skillRef.indexOf(':')
  if (idx < 0) return null
  const skillId = skillRef.slice(0, idx)
  const actionId = skillRef.slice(idx + 1)
  if (skillId === 'construction') return buildingById[actionId] || null
  return asArray(skillsData[skillId]?.actions).find((a) => a.id === actionId) || null
}

function actionInSkill(skillId, actionId) {
  // Thieving stores its targets under `npcs`, every other skill under `actions`.
  const list = skillId === 'thieving' ? skillsData.thieving?.npcs : skillsData[skillId]?.actions
  return asArray(list).find((a) => a.id === actionId) || null
}

// Slayer masters live at places directly from SLAYER_MASTERS (engine data in the
// core bundle — not seeded into worldActivities.json). Resolved lazily so the
// single-file concat order between engine files never matters at eval time.
function slayerRefsAt(placeId) {
  return SLAYER_MASTERS.filter((m) => m.placeId === placeId).map((m) => ({ kind: 'slayer', ref: m.id }))
}

function slayerMasterById(id) {
  return SLAYER_MASTERS.find((m) => m.id === id) || null
}

/**
 * Activities offered at a place: `[{ kind, ref }, ...]` — the seeded mapping
 * (worldActivities.json) plus any slayer masters homed there. In the single-file
 * build the seeded data global lives in the game chunk; before it loads (only
 * reachable pre-game, where nothing gates) the seeded part is [] — which
 * downstream means "unmapped, never gate".
 */
export function placeActivities(placeId) {
  const src = typeof worldActivitiesData !== 'undefined' ? worldActivitiesData : {}
  const seeded = src[placeId] || []
  const slayer = slayerRefsAt(placeId)
  return slayer.length ? [...seeded, ...slayer] : seeded
}

// ---- reverse index: `${kind}|${ref}` -> [placeId, ...] ----------------------------
let _index = null
function index() {
  if (_index) return _index
  const built = {}
  for (const placeId of Object.keys(worldData.places)) {
    for (const a of placeActivities(placeId)) {
      if (!a || !a.kind || !a.ref) continue
      const key = a.kind + '|' + a.ref
      ;(built[key] || (built[key] = [])).push(placeId)
    }
  }
  // Only memoise once the seeded data global is loaded: before the game chunk
  // arrives the index would hold just the engine-side slayer entries, and
  // caching that would leave the rest of the gating dead for the whole session.
  if (typeof worldActivitiesData !== 'undefined') _index = built
  return built
}

/** Place ids that offer the given activity, in world order. Empty = unmapped. */
export function placesForActivity(kind, ref) {
  if (!kind || !ref) return []
  return index()[kind + '|' + ref] || []
}

/**
 * Derive the gating ref `{ kind, ref }` from a live activeTask, or null for task types
 * that are not place-bound (and so are never gated). Mirrors the setActiveTask shapes in
 * the activity screens (§6 of the plan).
 */
export function activityRef(task) {
  if (!task) return null
  switch (task.type) {
    case 'combat': return task.monster?.id ? { kind: 'combat', ref: task.monster.id } : null
    case 'raid': return task.raid?.id ? { kind: 'raid', ref: task.raid.id } : null
    case 'skill': return (task.skill && task.action?.id) ? { kind: 'skill', ref: `${task.skill}:${task.action.id}` } : null
    case 'gather': return task.gatherTask?.id ? { kind: 'gather', ref: task.gatherTask.id } : null
    case 'agility': return task.action?.id ? { kind: 'agility', ref: task.action.id } : null
    case 'thieving': return task.npc?.id ? { kind: 'thieving', ref: task.npc.id } : null
    case 'hunter': return task.action?.id ? { kind: 'hunter', ref: task.action.id } : null
    // Farming is place-bound by its farm location id (one farm per place).
    case 'farming': return task.location?.id ? { kind: 'farming', ref: task.location.id } : null
    // Gated per-minigame (not per-task) — every reward task of a minigame lives at the
    // same place, so the whole minigame is the unit that's location-bound.
    case 'minigame': return task.minigameTask?.minigame ? { kind: 'minigame', ref: task.minigameTask.minigame } : null
    // Getting a slayer task from a master (never an activeTask — the shape only
    // rides the gating/travel-prompt flow, assignment itself is instant).
    case 'slayermaster': return task.master?.id ? { kind: 'slayer', ref: task.master.id } : null
    default: return null
  }
}

/**
 * Compact, serialisable descriptor of the action a player was trying to start when a
 * travel prompt sent them across the map — embedded in the travel task so arrival can
 * resume it (auto-start on arrival, even while idling). Returns null for task types that
 * carry no resumable action. Kept minimal (ids only) so it rides the save blob cheaply.
 */
export function autoStartFromTask(task) {
  if (!task) return null
  switch (task.type) {
    case 'combat': return task.monster?.id ? { kind: 'combat', monsterId: task.monster.id } : null
    case 'raid': return task.raid?.id ? { kind: 'raid', raidId: task.raid.id } : null
    case 'skill': return (task.skill && task.action?.id) ? { kind: 'skill', skill: task.skill, actionId: task.action.id } : null
    case 'gather': return task.gatherTask?.id ? { kind: 'gather', gatherTaskId: task.gatherTask.id } : null
    case 'agility': return task.action?.id ? { kind: 'agility', actionId: task.action.id } : null
    case 'thieving': return task.npc?.id ? { kind: 'thieving', npcId: task.npc.id } : null
    case 'hunter': return task.action?.id ? { kind: 'hunter', actionId: task.action.id } : null
    // Arrival opens the farm's patch view for this location.
    case 'farming': return task.location?.id ? { kind: 'farming', locationId: task.location.id } : null
    // Carries the specific reward task id (not just the minigame) so arrival resumes
    // exactly the task the player picked, not just any task from that minigame.
    case 'minigame': return task.minigameTask?.id ? { kind: 'minigame', taskId: task.minigameTask.id } : null
    // Arrival auto-assigns a task from the master (via the Slayer screen).
    case 'slayermaster': return task.master?.id ? { kind: 'slayer', masterId: task.master.id } : null
    default: return null
  }
}

/**
 * Decide what happens when a player tries to start `{ kind, ref }` from `location`,
 * given current `travel` state. Returns one of:
 *   { status: 'start',            places }  — at a place that offers it, or unmapped
 *   { status: 'blocked-transit',  places }  — currently travelling; can't start
 *   { status: 'travel',           places }  — must travel; `places` are the candidates
 */
export function resolveActivityStart({ location, travel, kind, ref }) {
  const places = placesForActivity(kind, ref)
  if (places.length === 0) return { status: 'start', places }       // unmapped -> never gate
  if (travel) return { status: 'blocked-transit', places }
  const loc = normaliseLocation(location)
  if (places.includes(loc)) return { status: 'start', places }
  return { status: 'travel', places }
}

/** Convenience: gate a whole activeTask. Untracked task types always 'start'. */
export function resolveTaskStart(task, { location, travel }) {
  const r = activityRef(task)
  if (!r) return { status: 'start', places: [] }
  return resolveActivityStart({ location, travel, kind: r.kind, ref: r.ref })
}

// Facility-bound skills offer the exact same actions at every place that has the
// matching facility (bank, furnace & anvil, altar, stove) — they never vary by
// location, so listing them in a place's World Map hub tells the player nothing
// about that specific place. Must stay in sync with FACILITY_SKILLS in
// scripts/seedWorldContent.cjs. Exported so the place map's facility spots (bank
// modal, smithy/altar/stove markers) provably mirror the seeded reality.
export const FACILITY_SKILL_MAP = {
  bank: ['construction', 'magic', 'firemaking', 'herblore', 'fletching', 'crafting'],
  furnace_anvil: ['smithing'],
  altar: ['prayer'],
  stove: ['cooking'],
}
export const FACILITY_SKILLS = new Set(Object.values(FACILITY_SKILL_MAP).flat())

/**
 * True if a `skill` kind ref's skill varies by place (i.e. isn't a facility-bound skill
 * whose actions are identical at every place that offers it). Used to declutter the
 * World Map place hub's "Available here" list down to location-meaningful skills.
 */
export function isPlaceVaryingSkillRef(ref) {
  const skillId = ref.indexOf(':') >= 0 ? ref.slice(0, ref.indexOf(':')) : ref
  return !FACILITY_SKILLS.has(skillId)
}

/**
 * Human-readable place name(s) where an activity actually happens — the same
 * "you'll find this at X" label combat shows per monster, generalised to any
 * kind via the same worldActivities.json index `placesForActivity` reads (so
 * it can never drift from what actually gates the start). Facility-bound skill
 * refs (smithing/cooking/prayer/magic/firemaking/herblore/fletching/crafting/
 * construction) return null — they're offered at every place with the matching
 * building, so no single location would be accurate.
 */
export function activityLocationLabel(kind, ref) {
  if (kind === 'skill' && !isPlaceVaryingSkillRef(ref)) return null
  const places = placesForActivity(kind, ref)
  if (!places.length) return null
  return places.map((id) => worldData.places[id]?.name || id).join(' · ')
}

/**
 * Sub-group label for an activity within its kind — currently only meaningful for
 * `skill` (refs are `skillId:actionId`, e.g. `cooking:cook_eel`), used to break the
 * "Skill" category up by skill (Cooking / Crafting / Fletching / ...) instead of one
 * flat list. Returns null for kinds that aren't sub-groupable.
 */
export function activityGroupLabel(kind, ref) {
  if (kind === 'quest') return questsById[ref]?.complexity || null
  if (kind !== 'skill') return null
  const skillId = ref.indexOf(':') >= 0 ? ref.slice(0, ref.indexOf(':')) : null
  return skillsData[skillId]?.name || skillId
}

/**
 * Skill-level requirement to start an activity: `{ skill, level }`, or null when the
 * kind carries none the client enforces at start time (combat/raid/gather/minigame
 * gate on their own screens). The World Map hub checks this before starting/queuing
 * an activity — its rows would otherwise bypass the owning screens' level locks.
 */
export function activityLevelRequirement(kind, ref) {
  if (kind === 'skill') {
    const i = ref.indexOf(':')
    const level = Number(skillAction(ref)?.level) || 0
    return i >= 0 && level > 1 ? { skill: ref.slice(0, i), level } : null
  }
  if (kind === 'agility' || kind === 'thieving' || kind === 'hunter') {
    const level = Number(actionInSkill(kind, ref)?.level) || 0
    return level > 1 ? { skill: kind, level } : null
  }
  return null
}

/**
 * Human-readable `{ name, icon, level }` for an activity ref, for hub/picker rendering.
 * Falls back to the raw ref if the content can't be resolved.
 */
export function describeActivity(kind, ref) {
  switch (kind) {
    case 'combat': {
      const m = monstersById[ref]
      return { name: m?.name || ref, icon: '⚔️', level: m?.combatLevel ?? null }
    }
    case 'raid': {
      const r = raidsData[ref]
      return { name: r?.name || ref, icon: r?.icon || '🩸', level: null }
    }
    // `product` (an item id, or null for actions with no item output — e.g.
    // dungeoneering floors) lets map-spot rendering show the actual item's
    // icon instead of a generic tool glyph; see placeMaps.js describeSpot.
    case 'skill': {
      const a = skillAction(ref)
      return { name: a?.name || ref, icon: a?.icon || '🛠️', level: a?.level ?? null, product: a?.product || null }
    }
    case 'gather': {
      const t = gatherById[ref]
      return { name: t?.name || ref, icon: t?.icon || '🌿', level: null, iconKey: t?.iconKey || null }
    }
    case 'agility': {
      const a = actionInSkill('agility', ref)
      return { name: a?.name || ref, icon: '🤸', level: a?.level ?? null }
    }
    case 'thieving': {
      const a = actionInSkill('thieving', ref)
      return { name: a?.name || ref, icon: '🗡️', level: a?.level ?? null }
    }
    case 'hunter': {
      const a = actionInSkill('hunter', ref)
      return { name: a?.name || ref, icon: '🪤', level: a?.level ?? null }
    }
    // Farming: ref is the farm location id; the whole farm is the unit (no single
    // level — patches gate their own crops), so `level` stays null.
    case 'farming': {
      const loc = farmLocationsById[ref]
      return { name: loc?.name || ref, icon: '🌱', level: null }
    }
    case 'minigame': {
      const mg = minigamesById[ref]
      return { name: mg?.label || ref, icon: mg?.icon || '🎮', level: null, iconKey: mg?.iconKey || null }
    }
    // Slayer masters: getting a task from the master homed at this place.
    case 'slayer': {
      const m = slayerMasterById(ref)
      return { name: m ? `${m.name} — Slayer Master` : ref, icon: m?.icon || '💀', level: null, iconKey: m?.iconKey || null }
    }
    // Quests carry no single level; `level` is the complexity rank so pickers
    // sort Novice → Grandmaster (render `complexity`, not the rank number).
    case 'quest': {
      const q = questsById[ref]
      return { name: q?.name || ref, icon: '📜', level: q ? (COMPLEXITY_ORDER[q.complexity] || null) : null, complexity: q?.complexity || null }
    }
    default:
      return { name: ref, icon: '•', level: null }
  }
}

/**
 * Why the player cannot start an activity right now, or null when nothing
 * blocks it. This is the single gate behind every clickable activity row on
 * the World Map / place maps (disabled rows + the start-time check), mirroring
 * the owning screens' locks: skill/agility/thieving/hunter level requirements,
 * monster slayer/quest/kill-count gates, raid quest gates, and quest
 * eligibility. Returns `{ reason, completed? }` — `completed: true` marks a
 * quest that is done rather than locked.
 *
 * `ctx`: { stats, completedQuests, bossKillCounts } from the live game state.
 */
export function activityLockReason(kind, ref, ctx = {}) {
  const { stats = {}, completedQuests = new Set(), bossKillCounts = {} } = ctx
  const levelOf = (skill) => getLevelFromXP(stats?.[skill]?.xp || 0)
  const req = activityLevelRequirement(kind, ref)
  if (req && levelOf(req.skill) < req.level) {
    return { reason: `Requires ${req.skill.charAt(0).toUpperCase()}${req.skill.slice(1)} level ${req.level}` }
  }
  if (kind === 'combat') {
    const check = checkBossRequirementsPure(monstersById[ref], {
      slayerLevel: levelOf('slayer'), completedQuests, bossKillCounts, questsData,
    })
    return check.locked ? { reason: check.reason } : null
  }
  if (kind === 'raid') {
    const check = checkRaidRequirementsPure(raidsData[ref], { completedQuests })
    return check.locked ? { reason: check.reason } : null
  }
  if (kind === 'slayer') {
    const master = slayerMasterById(ref)
    if (!master) return { reason: 'Unknown slayer master' }
    if (master.combatReq > 0 && combatLevelFromStats(stats) < master.combatReq) {
      return { reason: `Requires combat level ${master.combatReq}` }
    }
    if (master.slayerReq > 0 && levelOf('slayer') < master.slayerReq) {
      return { reason: `Requires Slayer level ${master.slayerReq}` }
    }
    return null
  }
  if (kind === 'quest') {
    const quest = questsById[ref]
    if (!quest) return { reason: 'Unknown quest' }
    if (completedQuests.has(quest.id)) return { reason: 'Already complete', completed: true }
    const elig = checkQuestEligibility(quest, stats, completedQuests, questsData)
    return elig.eligible ? null : { reason: `Requires ${elig.reasons.join(', ')}` }
  }
  return null
}
