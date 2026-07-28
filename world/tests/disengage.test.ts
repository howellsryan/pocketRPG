// Walking away from a fight stops YOUR swings and nothing else. The session
// survives so the monster you woke keeps hitting you while it can reach, but
// the hero never lands another blow until the player clicks Attack again —
// there is no auto-retaliate in this world, for trash or for bosses.
import { describe, expect, it } from 'vitest'
import { tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { npcsFromZone, type NpcState } from '../server/npc'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'

const COLLISION = Array.from({ length: 16 }, () => '.'.repeat(16))

function makePlayer(overrides: Partial<TickPlayer> = {}): TickPlayer {
  return {
    charId: '1', name: 'WorldTester', x: 5, z: 6, path: [], anim: 'idle',
    stats: {
      attack: { xp: 100000, level: 40 }, strength: { xp: 100000, level: 40 },
      defence: { xp: 100000, level: 40 }, ranged: { xp: 0, level: 1 },
      magic: { xp: 0, level: 1 }, hitpoints: { xp: 100000, level: 40 },
    },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null, pendingInteract: null,
    hp: 40, maxHp: 40, equipment: {}, gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', spell: null, specialEnergy: 100, lastSpecSent: 100, lastSpecQueuedSent: false, pendingSpecial: false, prayerPoints: 1, maxPrayerPoints: 1, prayerDrainAccumulator: 0, activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null, activePotions: {}, following: null, followTargetTile: null,
    ...overrides,
  }
}

function npcAt(monsterId: string, x: number, z: number): { npcs: Map<string, NpcState>; npc: NpcState } {
  const npcs = npcsFromZone([{ id: 'n1', monsterId, x, z, wander: { x: 0, z: 0, w: 16, h: 16 } }])
  return { npcs, npc: npcs.get('n1')! }
}

function ctx(tick: number, npcs: Map<string, NpcState>): TickContext {
  return { tick, rocks: new Map(), npcs, collision: COLLISION, pathAdjacent: (from, to) => findPathAdjacent(COLLISION, from, to) }
}

/** Engages the player on the npc the way an Attack click does. */
function engage(player: TickPlayer, npcs: Map<string, NpcState>, tick = 1): void {
  player.pendingInteract = { kind: 'npc', id: 'n1', action: 'attack' }
  tickPlayer(player, ctx(tick, npcs))
}

describe('disengaging by walking away', () => {
  it('lands no further hits once the fight is marked passive', () => {
    const { npcs, npc } = npcAt('pasture_bull', 5, 5)
    const player = makePlayer()
    engage(player, npcs)
    expect(player.combat).not.toBeNull()

    // WorldZone sets this on a walk order; the player stays adjacent here so the
    // only thing stopping the swings is the disengage itself.
    player.combat!.passive = true
    const hpBefore = npc.hp
    for (let tick = 2; tick <= 30; tick++) {
      const r = tickPlayer(player, ctx(tick, npcs))
      expect(r.hits.filter((h) => h.targetId === 'n1')).toEqual([])
    }
    expect(npc.hp).toBe(hpBefore)
  })

  it('grants no XP for the swings it discards', () => {
    const { npcs } = npcAt('pasture_bull', 5, 5)
    const player = makePlayer()
    engage(player, npcs)
    player.combat!.passive = true
    player.pendingXp = {}
    for (let tick = 2; tick <= 30; tick++) tickPlayer(player, ctx(tick, npcs))
    expect(player.pendingXp).toEqual({})
  })

  it('never kills the monster it is no longer fighting', () => {
    const { npcs, npc } = npcAt('pasture_bull', 5, 5)
    const player = makePlayer()
    engage(player, npcs)
    // One hit from death: the engine still rolls the player's swing on a passive
    // tick, so an ungated monsterDeath would hand over the kill and its loot.
    npc.hp = 1
    player.combat!.passive = true
    for (let tick = 2; tick <= 30; tick++) tickPlayer(player, ctx(tick, npcs))
    expect(npc.state).not.toBe('dead')
    expect(npc.hp).toBe(1)
  })

  it('leaves the monster free to keep hitting the player', () => {
    const { npcs, npc } = npcAt('pasture_bull', 5, 5)
    const player = makePlayer()
    engage(player, npcs)
    player.combat!.passive = true
    npc.attackerId = player.charId

    let hitsTaken = 0
    for (let tick = 2; tick <= 40; tick++) {
      const r = tickPlayer(player, ctx(tick, npcs))
      hitsTaken += r.hits.filter((h) => h.targetId === player.charId).length
    }
    expect(hitsTaken).toBeGreaterThan(0)
  })

  it('re-engages on a fresh Attack click and starts landing hits again', () => {
    const { npcs, npc } = npcAt('pasture_bull', 5, 5)
    const player = makePlayer()
    engage(player, npcs)
    player.combat!.passive = true
    tickPlayer(player, ctx(2, npcs))

    player.pendingInteract = { kind: 'npc', id: 'n1', action: 'attack' }
    tickPlayer(player, ctx(3, npcs))
    expect(player.combat!.passive).toBe(false)

    let landed = false
    for (let tick = 4; tick <= 40 && !landed; tick++) {
      const r = tickPlayer(player, ctx(tick, npcs))
      if (r.hits.some((h) => h.targetId === 'n1')) landed = true
    }
    expect(landed).toBe(true)
    expect(npc.hp).toBeLessThan(npc.maxHp)
  })

  it('does not reset the engine attack timer, so re-clicking is not a free hit', () => {
    const { npcs } = npcAt('pasture_bull', 5, 5)
    const player = makePlayer()
    engage(player, npcs)
    const session = player.combat
    player.combat!.passive = true
    player.pendingInteract = { kind: 'npc', id: 'n1', action: 'attack' }
    tickPlayer(player, ctx(2, npcs))
    expect(player.combat).toBe(session) // same session object, not a rebuilt one
  })
})
