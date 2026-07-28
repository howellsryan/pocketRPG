// Boss "adds": a second monster that spawns mid-fight and fights alongside the
// boss. This is deliberately NOT a form change — a form swaps one monster's
// stats, whereas both of these are alive at once, attack on independent timers,
// and the player picks which one to swing at. Killing an add despawns it (no
// drops, no kill count); the boss keeps spawning replacements until it dies.

const DEFAULT_FIRST_SPAWN = [4, 7]
const DEFAULT_RESPAWN = [10, 16]

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
 * matching the form it is currently in, so the minion always shares its style.
 */
export function selectAddDefinition(definitions, monster) {
  if (!definitions) return null
  const forForm = monster?.currentForm ? definitions[monster.currentForm] : null
  return forForm || definitions.default || Object.values(definitions)[0] || null
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

/** A combat-ready copy of an add's monster definition. */
export function prepareAdd(definition) {
  if (!definition) return null
  return {
    ...definition,
    currentHP: definition.hitpoints,
    attackTimer: Math.max(1, Math.floor(definition.attackSpeed || 4)),
  }
}

export function isAddAlive(state) {
  return !!(state?.add && state.add.currentHP > 0)
}

/**
 * The monster the player's next swing lands on. Falls back to the boss whenever
 * the add is dead or absent, so a stale `addTargeted` flag can never strand the
 * player attacking nothing.
 */
export function activeTarget(state) {
  return isAddAlive(state) && state?.addTargeted ? state.add : state?.monster
}

/**
 * True when `target` is the add rather than the boss. Identity-based, not
 * liveness-based, so it still answers correctly for an add that just died.
 */
export function isAddTarget(state, target) {
  return !!state?.add && !!target && target === state.add
}
