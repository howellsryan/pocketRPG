// Integration: drive the DO's per-player state machine (tickPlayer) through a
// full fight against a live npc, exercising startCombat + stepCombat exactly as
// WorldZone does. Complements combat-adapter.test.ts (which pins the engine) by
// verifying the session wiring: hits, XP into the flush tally, kill → loot.
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
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', specialEnergy: 100, lastSpecSent: 100,
    ...overrides,
  }
}

function bullAt(x: number, z: number): { npcs: Map<string, NpcState>; bull: NpcState } {
  const npcs = npcsFromZone([{ id: 'bull_1', monsterId: 'pasture_bull', x, z, wander: { x: 0, z: 0, w: 16, h: 16 } }])
  return { npcs, bull: npcs.get('bull_1')! }
}

function ctx(tick: number, npcs: Map<string, NpcState>): TickContext {
  return { tick, rocks: new Map(), npcs, collision: COLLISION, pathAdjacent: (from, to) => findPathAdjacent(COLLISION, from, to) }
}

describe('combat via tickPlayer', () => {
  it('attacks an adjacent bull, deals damage, and kills it with loot + XP', () => {
    const { npcs, bull } = bullAt(5, 5)
    const player = makePlayer({ x: 5, z: 6, pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' } })

    const allHits: { targetId: string; dmg: number }[] = []
    const allLoot: { itemId: string }[] = []
    let tick = 0
    while (bull.state !== 'dead' && tick < 1000) {
      tick++
      const r = tickPlayer(player, ctx(tick, npcs))
      allHits.push(...r.hits)
      allLoot.push(...r.newLoot)
    }

    expect(bull.state).toBe('dead')
    expect(allHits.some((h) => h.targetId === 'bull_1' && h.dmg > 0)).toBe(true)
    expect(allLoot.map((l) => l.itemId)).toEqual(expect.arrayContaining(['bones', 'raw_beef', 'cowhide']))
    // XP flowed into BOTH the live session stats and the pending flush tally.
    expect(player.stats.attack.xp).toBeGreaterThan(100000)
    expect(player.pendingXp.attack).toBe(8 * 4)
    expect(player.combat).toBeNull()
    expect(player.anim).toBe('idle')
  })

  it('re-approaches a bull that wandered away before arrival, then engages', () => {
    const { npcs, bull } = bullAt(5, 5)
    // Player starts several tiles away; the intent must survive the walk.
    const player = makePlayer({ x: 5, z: 10, pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' } })
    // Seed an initial approach path (WorldZone.handleInteract does this once).
    player.path = (findPathAdjacent(COLLISION, { x: 5, z: 10 }, bull)!).slice(1)

    let tick = 0
    while (!player.combat && bull.state !== 'dead' && tick < 60) {
      tick++
      // Nudge the bull one tile mid-approach to mimic wandering.
      if (tick === 2 && bull.state === 'idle') bull.x = 6
      tickPlayer(player, ctx(tick, npcs))
    }
    expect(player.combat).not.toBeNull()
  })

  it('two attackers drain one shared HP pool; top damage owns the drop (Phase 4)', () => {
    const { npcs, bull } = bullAt(5, 5)
    const a = makePlayer({ charId: '1', x: 5, z: 6, pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' } })
    const b = makePlayer({ charId: '2', x: 5, z: 4, pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' } })

    const dmgByChar: Record<string, number> = { '1': 0, '2': 0 }
    let owner: string | null = null
    let tick = 0
    while (bull.state !== 'dead' && tick < 1000) {
      tick++
      for (const p of [a, b]) {
        const r = tickPlayer(p, ctx(tick, npcs))
        for (const h of r.hits) if (h.targetId === 'bull_1') dmgByChar[p.charId] += h.dmg
        if (r.newLoot.length > 0) owner = r.newLoot[0].ownerCharId
      }
    }

    expect(bull.state).toBe('dead')
    // Shared pool: combined damage is exactly the bull's 8 HP — no double-kill.
    expect(dmgByChar['1'] + dmgByChar['2']).toBe(8)
    expect(owner).not.toBeNull()
    // The recorded top contributor owns the drop (either rule outcome on a tie).
    if (dmgByChar['1'] !== dmgByChar['2']) {
      expect(owner).toBe(dmgByChar['1'] > dmgByChar['2'] ? '1' : '2')
    }
  })

  it('only the retaliation target takes monster hits with two attackers (Phase 4)', () => {
    const { npcs, bull } = bullAt(5, 5)
    // Both too weak to kill quickly, so the bull gets many swings in.
    const weak = { attack: { xp: 0, level: 1 }, strength: { xp: 0, level: 1 }, defence: { xp: 0, level: 1 }, ranged: { xp: 0, level: 1 }, magic: { xp: 0, level: 1 }, hitpoints: { xp: 100000, level: 40 } }
    const a = makePlayer({ charId: '1', x: 5, z: 6, stats: weak, pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' } })
    const b = makePlayer({ charId: '2', x: 5, z: 4, stats: weak, pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' } })

    let hitsAtA = 0
    let hitsAtB = 0
    for (let tick = 1; tick <= 60 && bull.state !== 'dead'; tick++) {
      for (const p of [a, b]) {
        const r = tickPlayer(p, ctx(tick, npcs))
        for (const h of r.hits) {
          if (h.targetId === '1') hitsAtA++
          if (h.targetId === '2') hitsAtB++
        }
      }
    }

    expect(bull.attackerId === '1' || bull.state === 'dead').toBe(true)
    expect(hitsAtA).toBeGreaterThan(0)
    expect(hitsAtB).toBe(0)
  })

  it('aggro hands over to a surviving attacker when the target leaves (Phase 4)', () => {
    const { npcs, bull } = bullAt(5, 5)
    const weak = { attack: { xp: 0, level: 1 }, strength: { xp: 0, level: 1 }, defence: { xp: 0, level: 1 }, ranged: { xp: 0, level: 1 }, magic: { xp: 0, level: 1 }, hitpoints: { xp: 100000, level: 40 } }
    const a = makePlayer({ charId: '1', x: 5, z: 6, stats: weak, pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' } })
    const b = makePlayer({ charId: '2', x: 5, z: 4, stats: weak, pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' } })
    tickPlayer(a, ctx(1, npcs))
    tickPlayer(b, ctx(1, npcs))
    expect(bull.attackerId).toBe('1')

    a.x = 10 // target walks out of adjacency
    tickPlayer(a, ctx(2, npcs))
    expect(bull.attackerId).toBeNull()
    tickPlayer(b, ctx(2, npcs))
    expect(bull.attackerId).toBe('2')
  })

  it('walking out of range ends the fight (bull left in combat until it heals)', () => {
    const { npcs, bull } = bullAt(5, 5)
    const player = makePlayer({ x: 5, z: 6, pendingInteract: { kind: 'npc', id: 'bull_1', action: 'attack' } })
    tickPlayer(player, ctx(1, npcs)) // engage
    expect(player.combat).not.toBeNull()

    player.x = 10 // teleport out of adjacency (as a walk would)
    tickPlayer(player, ctx(2, npcs))
    expect(player.combat).toBeNull()
    expect(bull.attackerId).toBeNull()
  })
})
