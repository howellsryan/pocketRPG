// Boss minions as REAL world npcs.
//
// The shared engine (src/engine/combat.js) spawns a boss's add INSIDE a combat
// session, as `state.add` — which in the world is one session per player, so an
// add spawned that way would be invisible, unkillable, and duplicated N times in
// a room of N. The world therefore never turned the engine's spawn on at all
// (its createCombatState call is the one that passes no monsters table), and
// Zaryth's sentinels simply did not exist out here.
//
// So the minion is a single npc instead: everyone sees the same one, it can be
// walked around and killed, and combat.ts mirrors it onto the sessions fighting
// its summoner (mirrorPairedAttacker) so the engine resolves its swings the way
// it does in the solo fight. One record, one clock, one silhouette in the room.
//
// A boss and its minion are ONE encounter, in both directions: a player may only
// attack one of them, but both attack the player. Turning on the sentinel does
// not walk you out of the boss fight — the same mirror runs the other way, and
// countsAsEngaged (npc.ts) keeps each half of the pair engaged with whoever is
// fighting the other.
//
// Entirely data-driven off `spawnsAdd` in monsters.json (via bossAdds.js, the
// same spec the solo fight and the co-op room read), so a second boss with
// minions needs a lair and a model — not code.
import monstersData from '../../src/data/monsters.json'
import { getAddSpec, addDefinitionsFor, selectAddDefinition, maxActiveAdds, rollFirstSpawnDelay, rollRespawnDelay } from '../../src/engine/bossAdds.js'
import { makeNpc, type NpcState } from './npc'
import type { TickContext, TickResult } from './tick'

type Monster = { attackSpeed?: number; spawnsAdd?: unknown }
type Monsters = Record<string, Monster | undefined>
const monsters = monstersData as Monsters

/** The add spec a monster summons by, or null when it summons nothing. */
export function summonSpec(monsterId: string): Record<string, unknown> | null {
  return getAddSpec(monsters[monsterId]) as Record<string, unknown> | null
}

/** How many minions this monster may have on the field at once. */
export function maxMinions(monsterId: string): number {
  return maxActiveAdds(summonSpec(monsterId))
}

/**
 * Which minion this monster summons for its `spawnCount`-th summon. A style-keyed
 * spec CYCLES: a boss that fields several at once is flanked by a mixed group,
 * and every authored variant reaches the field — passing nothing here is what
 * made only the first-listed sentinel ever appear.
 */
export function minionMonsterId(monsterId: string, spawnCount = 0): string | null {
  const spec = summonSpec(monsterId)
  if (!spec) return null
  const definition = selectAddDefinition(addDefinitionsFor(spec, monstersData), monsters[monsterId], spawnCount)
  return (definition as { id?: string } | null)?.id ?? null
}

function attackSpeedOf(monsterId: string): number {
  return Math.max(1, Math.floor(Number(monsters[monsterId]?.attackSpeed) || 4))
}

/** The spec counts boss ATTACKS; the world counts ticks. One attack is
 * `attackSpeed` ticks, which is the same wait the solo fight gives. */
function summonDelayTicks(monsterId: string, first: boolean): number {
  const spec = summonSpec(monsterId)
  const attacks = first ? rollFirstSpawnDelay(spec) : rollRespawnDelay(spec)
  return Math.max(1, attacks * attackSpeedOf(monsterId))
}

function walkable(collision: string[], x: number, z: number): boolean {
  return collision[z]?.[x] === '.'
}

/** A free tile beside the summoner to stand the minion on, searched outward so
 * it appears as close to the boss as the room allows. Null when it is walled in
 * — better no minion than one inside a pillar. */
function spawnTile(boss: NpcState, ctx: TickContext): { x: number; z: number } | null {
  const collision = ctx.collision ?? []
  const taken = new Set<string>()
  for (const npc of ctx.npcs?.values() ?? []) if (npc.state !== 'dead') taken.add(`${npc.x},${npc.z}`)
  for (const player of ctx.players?.values() ?? []) taken.add(`${player.x},${player.z}`)
  for (const radius of [1, 2, 3]) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue
        const x = boss.x + dx
        const z = boss.z + dz
        if (!walkable(collision, x, z) || taken.has(`${x},${z}`)) continue
        return { x, z }
      }
    }
  }
  return null
}

/** Drops a minion id from its summoner's stack. */
function forget(summoner: NpcState | undefined, minionId: string): void {
  if (summoner?.minionIds) summoner.minionIds = summoner.minionIds.filter((id) => id !== minionId)
}

function despawn(minion: NpcState, ctx: TickContext, result: TickResult): void {
  ctx.npcs?.delete(minion.id)
  result.npcRemoved.push(minion.id)
}

/**
 * Advances every summoner's minions by one tick: tops the stack up when the
 * countdown lands, and clears one away when it dies or its summoner does. Their
 * attack clocks are tickNpc's, not this pass's.
 *
 * Runs after tickNpc and before the player sessions, so a minion spawned this
 * tick is already on the field when the sessions that mirror it run.
 */
export function stepMinions(ctx: TickContext, result: TickResult): void {
  const npcs = ctx.npcs
  if (!npcs) return
  for (const npc of [...npcs.values()]) {
    if (npc.summonerId) {
      const summoner = npcs.get(npc.summonerId)
      // Orphaned — the summoner died, disengaged or lost track of it.
      if (!summoner || summoner.state !== 'combat' || !summoner.minionIds?.includes(npc.id)) {
        forget(summoner, npc.id)
        despawn(npc, ctx, result)
        continue
      }
      if (npc.state === 'dead') {
        // Killed: let the death clip play out, then take it off the field. A
        // kill always restarts the wait, even from a full stack — clearing them
        // is a treadmill, not a one-off.
        if (ctx.tick < npc.removeAtTick) continue
        forget(summoner, npc.id)
        summoner.summonCountdown = summonDelayTicks(summoner.monsterId, false)
        despawn(npc, ctx, result)
        continue
      }
      continue
    }

    if (!summonSpec(npc.monsterId)) continue
    if (npc.state !== 'combat') {
      // Out of the fight it summons NOTHING and forgets its wait — a boss
      // standing alone in its lair must not quietly stack minions up.
      npc.minionIds = []
      npc.summonCountdown = null
      continue
    }
    npc.minionIds = (npc.minionIds ?? []).filter((id) => npcs.has(id))
    if (npc.minionIds.length >= maxMinions(npc.monsterId)) {
      // Stack full. The wait restarts only when one of them falls.
      npc.summonCountdown = null
      continue
    }
    if (npc.summonCountdown == null) npc.summonCountdown = summonDelayTicks(npc.monsterId, npc.minionIds.length === 0)
    npc.summonCountdown -= 1
    if (npc.summonCountdown > 0) continue

    const ordinal = npc.summonsMade ?? 0
    const monsterId = minionMonsterId(npc.monsterId, ordinal)
    const tile = monsterId ? spawnTile(npc, ctx) : null
    if (!monsterId || !tile) {
      // Nowhere to put it this tick — try again on the next one rather than
      // dropping the summon, or a boss backed into a corner never summons again.
      npc.summonCountdown = 1
      continue
    }
    // A 1×1 wander rect is the tile it stands on: it never drifts, it CHASES.
    // countsAsEngaged hands it everyone fighting its summoner, so it picks a
    // target and closes on them — a planted melee sentinel would otherwise swing
    // at a player one tile beyond its reach forever. Losing them returns it here.
    npc.summonsMade = ordinal + 1
    const minion = makeNpc({ id: `${npc.id}__minion${npc.summonsMade}`, monsterId, x: tile.x, z: tile.z, wander: { x: tile.x, z: tile.z, w: 1, h: 1 } })
    minion.summonerId = npc.id
    // Straight into the fight, and seeded so the out-of-combat heal measures
    // from now rather than from tick 0 and resets it the moment it appears.
    minion.state = 'combat'
    minion.lastCombatTick = ctx.tick
    npcs.set(minion.id, minion)
    npc.minionIds.push(minion.id)
    // Straight into the next wait unless that filled the stack: leaving one
    // alive is exactly what lets the next one arrive on top of it.
    npc.summonCountdown = npc.minionIds.length < maxMinions(npc.monsterId)
      ? summonDelayTicks(npc.monsterId, false)
      : null
    result.npcChanged.push(minion.id)
  }
}
