/**
 * worldContent — maps live game content (monsters, skill actions, gather/agility/
 * thieving/hunter actions) to the world places that offer them, and decides whether an
 * activity can start where the player is or requires travel.
 *
 * Phase 3 of the map-driven overhaul (docs/map-driven-overhaul-plan.md). Pure logic, no
 * UI imports (engine layer — CLAUDE.md §3). The place->activity assignments are authored
 * into src/data/world.json by scripts/seedWorldContent.cjs; this module is the read/
 * reverse-index side plus the gating decision. Activity refs here MUST match the refs the
 * seed script writes and the shapes `activityRef` derives from a live activeTask.
 */
import worldData from '../data/world.json'
import monstersData from '../data/monsters.json'
import skillsData from '../data/skills.json'
import raidsData from '../data/raids.json'
import minigamesData from '../data/minigames.json'
import { GATHER_TASKS } from './gatherTasks.js'
import { BUILDING_ACTIONS } from './construction.js'
import { normaliseLocation } from './world.js'

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

// ---- reverse index: `${kind}|${ref}` -> [placeId, ...] ----------------------------
let _index = null
function index() {
  if (_index) return _index
  _index = {}
  for (const [placeId, place] of Object.entries(worldData.places)) {
    for (const a of place.activities || []) {
      if (!a || !a.kind || !a.ref) continue
      const key = a.kind + '|' + a.ref
      ;(_index[key] || (_index[key] = [])).push(placeId)
    }
  }
  return _index
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
    // Gated per-minigame (not per-task) — every reward task of a minigame lives at the
    // same place, so the whole minigame is the unit that's location-bound.
    case 'minigame': return task.minigameTask?.minigame ? { kind: 'minigame', ref: task.minigameTask.minigame } : null
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
    // Carries the specific reward task id (not just the minigame) so arrival resumes
    // exactly the task the player picked, not just any task from that minigame.
    case 'minigame': return task.minigameTask?.id ? { kind: 'minigame', taskId: task.minigameTask.id } : null
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

/**
 * Sub-group label for an activity within its kind — currently only meaningful for
 * `skill` (refs are `skillId:actionId`, e.g. `cooking:cook_eel`), used to break the
 * "Skill" category up by skill (Cooking / Crafting / Fletching / ...) instead of one
 * flat list. Returns null for kinds that aren't sub-groupable.
 */
export function activityGroupLabel(kind, ref) {
  if (kind !== 'skill') return null
  const skillId = ref.indexOf(':') >= 0 ? ref.slice(0, ref.indexOf(':')) : null
  return skillsData[skillId]?.name || skillId
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
    case 'skill': {
      const a = skillAction(ref)
      return { name: a?.name || ref, icon: a?.icon || '🛠️', level: a?.level ?? null }
    }
    case 'gather': {
      const t = gatherById[ref]
      return { name: t?.name || ref, icon: t?.icon || '🌿', level: null }
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
    case 'minigame': {
      const mg = minigamesById[ref]
      return { name: mg?.label || ref, icon: mg?.icon || '🎮', level: null }
    }
    default:
      return { name: ref, icon: '•', level: null }
  }
}
