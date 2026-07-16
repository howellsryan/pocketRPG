// Distance combat: melee reaches 1 tile, ranged 5, magic 7 — for players and
// monsters alike. Covers the reach helpers, a magic weapon striking from range
// without closing in, a melee attacker having to close first, a melee monster
// unable to reach a kiting player, a magic monster striking (and hitting a
// fleeing player mid-walk), and chase-to-range on the npc side.
import { describe, expect, it } from 'vitest'
import {
  tickPlayer, emptyResult, rangeForCombatType, monsterAttackRange, withinRange, cutPathToRange,
  MELEE_RANGE, RANGED_RANGE, MAGIC_RANGE, type TickContext, type TickPlayer,
} from '../server/tick'
import { npcsFromZone, tickNpc, type NpcState } from '../server/npc'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'

const COLLISION = Array.from({ length: 24 }, () => '.'.repeat(24))

function makePlayer(overrides: Partial<TickPlayer> = {}): TickPlayer {
  return {
    charId: '1', name: 'Ranger', x: 5, z: 6, path: [], anim: 'idle',
    stats: {
      attack: { xp: 100000, level: 40 }, strength: { xp: 100000, level: 40 },
      defence: { xp: 0, level: 1 }, ranged: { xp: 0, level: 1 },
      magic: { xp: 0, level: 1 }, hitpoints: { xp: 100000, level: 40 },
    },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null, pendingInteract: null,
    hp: 40, maxHp: 40, equipment: {}, gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', spell: null, specialEnergy: 100, lastSpecSent: 100,
    ...overrides,
  }
}

function npcAt(id: string, monsterId: string, x: number, z: number): { npcs: Map<string, NpcState>; npc: NpcState } {
  const npcs = npcsFromZone([{ id, monsterId, x, z, wander: { x: 0, z: 0, w: 24, h: 24 } }])
  return { npcs, npc: npcs.get(id)! }
}

function ctx(tick: number, npcs: Map<string, NpcState>, players?: Map<string, { x: number; z: number }>): TickContext {
  return { tick, rocks: new Map(), npcs, collision: COLLISION, pathAdjacent: (from, to) => findPathAdjacent(COLLISION, from, to), players }
}

describe('attack reach', () => {
  it('reaches 1 tile with melee, 5 with ranged, 7 with magic', () => {
    expect(rangeForCombatType('melee')).toBe(MELEE_RANGE)
    expect(rangeForCombatType('ranged')).toBe(RANGED_RANGE)
    expect(rangeForCombatType('magic')).toBe(MAGIC_RANGE)
    expect(MELEE_RANGE).toBe(1)
    expect(RANGED_RANGE).toBe(5)
    expect(MAGIC_RANGE).toBe(7)
  })

  it('derives a monster reach from its attack style', () => {
    expect(monsterAttackRange('pasture_bull')).toBe(1) // crush → melee
    expect(monsterAttackRange('cinder_devil')).toBe(5) // ranged
    expect(monsterAttackRange('arcane_adept')).toBe(7) // magic
  })

  it('withinRange is Chebyshev distance', () => {
    expect(withinRange({ x: 0, z: 0 }, { x: 5, z: 3 }, 5)).toBe(true)
    expect(withinRange({ x: 0, z: 0 }, { x: 6, z: 0 }, 5)).toBe(false)
    expect(withinRange({ x: 0, z: 0 }, { x: 1, z: 1 }, 1)).toBe(true)
  })

  it('cutPathToRange trims a straight path to the first in-range tile (ranged)', () => {
    const target = { x: 5, z: 5 }
    const steps = [12, 11, 10, 9, 8, 7, 6].map((z) => ({ x: 5, z }))
    const cut = cutPathToRange(steps, target, RANGED_RANGE)
    // z=10 is Chebyshev 5 from z=5 — the first tile within ranged reach.
    expect(cut.map((t) => t.z)).toEqual([12, 11, 10])
    expect(withinRange(cut[cut.length - 1], target, RANGED_RANGE)).toBe(true)
  })

  it('cutPathToRange walks all the way to adjacency for melee', () => {
    const target = { x: 5, z: 5 }
    const steps = [12, 11, 10, 9, 8, 7, 6].map((z) => ({ x: 5, z }))
    const cut = cutPathToRange(steps, target, MELEE_RANGE)
    expect(cut.map((t) => t.z)).toEqual([12, 11, 10, 9, 8, 7, 6])
  })
})

describe('players attacking from a distance', () => {
  it('a magic weapon strikes a monster from 7 tiles without closing to melee', () => {
    const { npcs, npc } = npcAt('bull_1', 'pasture_bull', 5, 5)
    const player = makePlayer({
      x: 5, z: 12, // Chebyshev 7 from the bull
      stats: { magic: { xp: 100000, level: 40 }, hitpoints: { xp: 100000, level: 40 }, defence: { xp: 100000, level: 40 } },
      equipment: { weapon: { itemId: 'magic_staff' } },
      spell: 'wind_strike',
      pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' },
    })
    player.inventory[0] = { itemId: 'air_rune', quantity: 99 }
    player.inventory[1] = { itemId: 'mind_rune', quantity: 99 }

    tickPlayer(player, ctx(1, npcs))
    expect(player.combat).not.toBeNull() // engaged from range, no walk needed
    expect({ x: player.x, z: player.z }).toEqual({ x: 5, z: 12 })

    let landed = false
    for (let t = 2; t < 30 && !landed; t++) {
      const r = tickPlayer(player, ctx(t, npcs))
      if (r.hits.some((h) => h.targetId === 'bull_1' && h.dmg > 0)) landed = true
    }
    expect(landed).toBe(true)
    expect(player.hp).toBe(player.maxHp) // the melee bull never reached back
    expect(npc.hp).toBeLessThan(npc.maxHp)
  })

  it('a melee attacker must close to an adjacent tile before it can hit', () => {
    const { npcs } = npcAt('bull_1', 'pasture_bull', 5, 5)
    const player = makePlayer({ x: 5, z: 9, pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' } })
    tickPlayer(player, ctx(1, npcs))
    expect(player.combat).toBeNull() // 4 tiles is out of melee reach
    expect(player.path.length).toBeGreaterThan(0) // walking in to close the gap
  })
})

describe('monsters attacking from a distance', () => {
  it('a melee monster cannot hit a player kiting it at magic range, yet is still struck', () => {
    const { npcs, npc } = npcAt('bull_1', 'pasture_bull', 5, 5)
    const player = makePlayer({
      x: 5, z: 6,
      stats: { magic: { xp: 100000, level: 40 }, hitpoints: { xp: 100000, level: 40 }, defence: { xp: 100000, level: 40 } },
      equipment: { weapon: { itemId: 'magic_staff' } },
      spell: 'wind_strike',
      pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' },
    })
    player.inventory[0] = { itemId: 'air_rune', quantity: 99 }
    player.inventory[1] = { itemId: 'mind_rune', quantity: 99 }
    tickPlayer(player, ctx(1, npcs)) // engage adjacent
    expect(player.combat).not.toBeNull()

    player.z = 10 // kite to 5 tiles: within magic 7, beyond the bull's melee 1
    const hpBefore = player.hp
    let landed = false
    for (let t = 2; t < 30 && !landed; t++) {
      const r = tickPlayer(player, ctx(t, npcs))
      if (r.hits.some((h) => h.targetId === 'bull_1' && h.dmg > 0)) landed = true
    }
    expect(player.combat).not.toBeNull() // still fighting from range
    expect(landed).toBe(true) // player keeps casting
    expect(player.hp).toBe(hpBefore) // bull can't reach the kiter
    expect(npc.hp).toBeLessThan(npc.maxHp)
  })

  it('a magic monster keeps hitting a fleeing player while they are still walking', () => {
    const { npcs } = npcAt('mage_1', 'arcane_adept', 5, 5)
    const player = makePlayer({
      charId: '1', x: 5, z: 6, hp: 400, maxHp: 400,
      stats: {
        attack: { xp: 0, level: 1 }, strength: { xp: 0, level: 1 }, defence: { xp: 0, level: 1 },
        ranged: { xp: 0, level: 1 }, magic: { xp: 0, level: 1 }, hitpoints: { xp: 200000, level: 99 },
      },
      pendingInteract: { kind: 'npc', id: 'mage_1', action: 'attack' },
    })
    tickPlayer(player, ctx(1, npcs)) // engage adjacent — the session persists across the flee
    expect(player.combat).not.toBeNull()

    const hpBefore = player.hp
    let hitWhileWalking = false
    for (let t = 2; t <= 40 && !hitWhileWalking; t++) {
      if (player.z < 10) player.path = [{ x: 5, z: player.z + 1 }] // keep a step queued: the player is moving
      const r = tickPlayer(player, ctx(t, npcs)) // stays within the mage's 7-tile reach
      if (r.hits.some((h) => h.targetId === '1' && h.dmg > 0)) hitWhileWalking = true
    }
    expect(hitWhileWalking).toBe(true)
    expect(player.hp).toBeLessThan(hpBefore)
  })
})

describe('chase-to-range (npc.ts)', () => {
  it('a magic monster already within its reach stands its ground instead of closing further', () => {
    const { npcs, npc } = npcAt('mage_1', 'arcane_adept', 5, 5)
    npc.state = 'combat'
    npc.attackerId = '1'
    const players = new Map([['1', { x: 5, z: 11 }]]) // 6 tiles: inside magic reach
    tickNpc(npc, ctx(1, npcs, players), emptyResult())
    expect({ x: npc.x, z: npc.z }).toEqual({ x: 5, z: 5 }) // no step taken
  })

  it('a melee monster still closes all the way to an adjacent tile', () => {
    const { npcs, npc } = npcAt('bull_1', 'pasture_bull', 5, 5)
    npc.state = 'combat'
    npc.attackerId = '1'
    const players = new Map([['1', { x: 5, z: 11 }]]) // 6 tiles: out of melee reach
    tickNpc(npc, ctx(1, npcs, players), emptyResult())
    expect(npc.z).toBeGreaterThan(5) // stepped toward the player
  })
})
