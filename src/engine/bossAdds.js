// Boss "adds": monsters that spawn mid-fight and fight alongside the boss. This
// is deliberately NOT a form change — a form swaps one monster's stats, whereas
// these are all alive at once, attack on independent timers, and the player
// picks which one to swing at. Killing an add despawns it (no drops, no kill
// count); the boss keeps spawning replacements until it dies.
//
// A boss fields UP TO `maxActive` of them at a time (default 1), so leaving them
// alive is a choice with a cost: the stack grows to the cap and the incoming
// damage grows with it. The player may only attack one thing; any number of
// things attack the player.

const DEFAULT_FIRST_SPAWN = [4, 7]
const DEFAULT_RESPAWN = [10, 16]
const DEFAULT_MAX_ACTIVE = 1

export function getAddSpec(monster) {
  const spec = monster?.spawnsAdd
  if (!spec || typeof spec !== 'object') return null
  if (!spec.monsterId && !spec.monsterIdByStyle) return null
  return spec
}

/**
 * Every add a spec can summon, keyed by the boss form that summons it. A spec
 * naming one `monsterId` collapses to a single `default` entry, so callers
 * never branch on which authoring shape was used.
 */
export function addDefinitionsFor(spec, monstersData) {
  if (!spec || !monstersData) return null
  const byStyle = spec.monsterIdByStyle
  if (byStyle && typeof byStyle === 'object') {
    const out = {}
    for (const [style, id] of Object.entries(byStyle)) {
      const definition = monstersData[id]
      if (definition) out[style] = definition
    }
    return Object.keys(out).length ? out : null
  }
  const definition = monstersData[spec.monsterId]
  return definition ? { default: definition } : null
}

/**
 * The add a boss summons right now. A style-rotating boss is flanked by the add
 * matching the form it is currently in, so the minion shares its style.
 *
 * With nothing to match — no form, or a boss that fields several at once, where
 * "the one matching the current form" stops being a meaningful choice — it
 * CYCLES on `spawnCount`. A stack of minions is then a mixed group rather than
 * four copies of whichever variant happened to be listed first, which is also
 * what makes every authored variant reachable at all.
 */
export function selectAddDefinition(definitions, monster, spawnCount = 0) {
  if (!definitions) return null
  const forForm = monster?.currentForm ? definitions[monster.currentForm] : null
  if (forForm) return forForm
  if (definitions.default) return definitions.default
  const all = Object.values(definitions)
  return all[Math.abs(Math.floor(spawnCount) || 0) % all.length] || null
}

/** How many adds this boss may have on the field at once. */
export function maxActiveAdds(spec) {
  const max = Math.floor(Number(spec?.maxActive))
  return max > 0 ? max : DEFAULT_MAX_ACTIVE
}

function rollRange(range, fallback, random) {
  let min = fallback[0]
  let max = fallback[1]
  if (Array.isArray(range)) {
    min = Number(range[0]) || min
    max = Number(range[1]) || max
  } else if (Number.isFinite(Number(range)) && Number(range) > 0) {
    min = max = Number(range)
  }
  if (max < min) max = min
  return Math.floor(random() * (max - min + 1)) + min
}

/** Boss attacks before the first add of a fight appears. */
export function rollFirstSpawnDelay(spec, random = Math.random) {
  return rollRange(spec?.firstSpawnAfterAttacks, DEFAULT_FIRST_SPAWN, random)
}

/** Boss attacks between an add dying and its replacement appearing. */
export function rollRespawnDelay(spec, random = Math.random) {
  return rollRange(spec?.respawnAfterAttacks, DEFAULT_RESPAWN, random)
}

/**
 * A combat-ready copy of an add's monster definition.
 *
 * `instanceId` identifies THIS spawn, not its kind: with several alive at once,
 * two of the same kind are two different monsters, and the co-op room has to
 * merge one member's damage onto the right one across a list that reshapes
 * whenever an add dies. Index alone cannot carry that.
 *
 * @param {object|null} definition
 * @param {string|number} [instanceId] anything unique within one fight — the
 *   spawn ordinal in the solo/co-op engine, the npc's id in the open world.
 */
export function prepareAdd(definition, instanceId = 0) {
  if (!definition) return null
  return {
    ...definition,
    instanceId: `${definition.id || 'add'}#${instanceId}`,
    currentHP: definition.hitpoints,
    attackTimer: Math.max(1, Math.floor(definition.attackSpeed || 4)),
  }
}

/**
 * A boss record's adds, tolerating the single-`add` shape that predates the
 * list. Co-op checkpoints its boss state to D1 (migration 0031), so a room that
 * reloads mid-fight across this change hydrates the old shape — and reading it
 * as an empty list would drop a live minion out of the fight.
 */
export function bossAddsOf(boss) {
  if (Array.isArray(boss?.adds)) return boss.adds
  return boss?.add ? [boss.add] : []
}

/**
 * Every add still standing, in spawn order. The list is the source of truth —
 * a dead add is spliced out of it, so this is normally the whole list, and the
 * liveness filter is here for the tick that kills one.
 */
export function liveAdds(state) {
  const adds = state?.adds
  return Array.isArray(adds) ? adds.filter((add) => add && add.currentHP > 0) : []
}

/** Whether the boss has anything at all on the field beside it. */
export function isAddAlive(state) {
  return liveAdds(state).length > 0
}

/**
 * The add the player has selected, or null when they are on the boss. Liveness
 * is re-checked here so a stale index can never strand the player attacking a
 * corpse — the fallback is always the boss.
 */
export function targetedAdd(state) {
  const index = state?.addTargetIndex
  if (typeof index !== 'number') return null
  const add = state?.adds?.[index]
  return add && add.currentHP > 0 ? add : null
}

/** The monster the player's next swing lands on. */
export function activeTarget(state) {
  return targetedAdd(state) || state?.monster
}

/**
 * True when `target` is one of the adds rather than the boss. Identity-based,
 * not liveness-based, so it still answers correctly for an add that just died.
 */
export function isAddTarget(state, target) {
  return !!target && Array.isArray(state?.adds) && state.adds.includes(target)
}

/**
 * The index of an add in the list, or -1. Callers that rebuild an add object
 * (the special-attack path clones its target) need the slot to write back to.
 */
export function addIndexOf(state, target) {
  return Array.isArray(state?.adds) ? state.adds.indexOf(target) : -1
}
