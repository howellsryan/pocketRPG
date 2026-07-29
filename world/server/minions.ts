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
// walked around and killed, and combat.ts mirrors it onto every boss session's
// `state.add` so the engine resolves its swings the way it does in the solo
// fight. One record, one clock, one silhouette in the room.
//
// Entirely data-driven off `spawnsAdd` in monsters.json (via bossAdds.js, the
// same spec the solo fight and the co-op room read), so a second boss with
// minions needs a lair and a model — not code.
import monstersData from '../../src/data/monsters.json'
import { getAddSpec, addDefinitionsFor, selectAddDefinition, rollFirstSpawnDelay, rollRespawnDelay } from '../../src/engine/bossAdds.js'
import { advanceRoomWideAttackTimer } from '../../src/engine/roomWideAttacks.js'
import { makeNpc, type NpcState } from './npc'
import type { TickContext, TickResult } from './tick'

type Monster = { attackSpeed?: number; spawnsAdd?: unknown }
type Monsters = Record<string, Monster | undefined>
const monsters = monstersData as Monsters

/** The add spec a monster summons by, or null when it summons nothing. */
export function summonSpec(monsterId: string): Record<string, unknown> | null {
  return getAddSpec(monsters[monsterId]) as Record<string, unknown> | null
}

/** Which minion this monster summons right now. The world has no form rotation,
 * so a style-keyed spec answers with its first entry — the same fallback
 * selectAddDefinition applies to a boss that is not mid-form. */
export function minionMonsterId(monsterId: string): string | null {
  const spec = summonSpec(monsterId)
  if (!spec) return null
  const definition = selectAddDefinition(addDefinitionsFor(spec, monstersData), monsters[monsterId])
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

function despawn(minion: NpcState, ctx: TickContext, result: TickResult): void {
  ctx.npcs?.delete(minion.id)
  result.npcRemoved.push(minion.id)
}

/**
 * Advances every summoner's minion by one tick: spawns one when its countdown
 * lands, runs the live one's shared attack clock, and clears it away when it
 * dies or its summoner does.
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
      if (!summoner || summoner.state !== 'combat' || summoner.minionId !== npc.id) {
        if (summoner?.minionId === npc.id) summoner.minionId = null
        despawn(npc, ctx, result)
        continue
      }
      if (npc.state === 'dead') {
        // Killed: let the death clip play out, then take it off the field and
        // start the summoner's countdown to the next one.
        if (ctx.tick < npc.removeAtTick) continue
        summoner.minionId = null
        summoner.summonCountdown = summonDelayTicks(summoner.monsterId, false)
        despawn(npc, ctx, result)
        continue
      }
      // Its swings land inside the sessions fighting the SUMMONER, so like a
      // room-wide boss the clock belongs to the npc, not to any one session.
      const clock = { attackSpeed: monsters[npc.monsterId]?.attackSpeed, attackTimer: npc.attackTimer }
      npc.roomWideSwing = advanceRoomWideAttackTimer(clock)
      npc.attackTimer = clock.attackTimer
      continue
    }

    if (!summonSpec(npc.monsterId)) continue
    if (npc.state !== 'combat') {
      // Out of the fight: no minion, and the next fight starts its wait afresh.
      npc.minionId = null
      npc.summonCountdown = null
      continue
    }
    if (npc.minionId && npcs.has(npc.minionId)) continue
    npc.minionId = null
    if (npc.summonCountdown == null) npc.summonCountdown = summonDelayTicks(npc.monsterId, true)
    npc.summonCountdown -= 1
    if (npc.summonCountdown > 0) continue

    const monsterId = minionMonsterId(npc.monsterId)
    const tile = monsterId ? spawnTile(npc, ctx) : null
    if (!monsterId || !tile) {
      // Nowhere to put it this tick — try again on the next one rather than
      // dropping the summon, or a boss backed into a corner never summons again.
      npc.summonCountdown = 1
      continue
    }
    // A 1×1 wander rect is the tile it stands on, so it guards its summoner
    // instead of drifting off; attacking it starts an ordinary fight, chase and
    // all, and giving up returns it here.
    const minion = makeNpc({ id: `${npc.id}__minion`, monsterId, x: tile.x, z: tile.z, wander: { x: tile.x, z: tile.z, w: 1, h: 1 } })
    minion.summonerId = npc.id
    npcs.set(minion.id, minion)
    npc.minionId = minion.id
    npc.summonCountdown = null
    result.npcChanged.push(minion.id)
  }
}
