import { describe, expect, it } from 'vitest'
import {
  combatStanceFromSave,
  respawnedRocks,
  sessionCombatLevel,
  sessionInventoryFromSave,
  sessionStatsFromSave,
  tickPlayer,
  toEntityDiff,
  type RockState,
  type TickContext,
  type TickPlayer,
} from '../server/tick'
import { ROCK_DEPLETED_TICKS, emptyInventory } from '../server/mining'
import { npcsFromZone, type NpcState } from '../server/npc'
import { findPathAdjacent } from '../server/pathfind'

function makePlayer(overrides: Partial<TickPlayer> = {}): TickPlayer {
  return {
    charId: '1',
    name: 'WorldTester',
    x: 0,
    z: 0,
    path: [],
    anim: 'idle',
    stats: { mining: { xp: 0, level: 1 } },
    inventory: emptyInventory(),
    pendingXp: {},
    minted: {},
    mining: null,
    crafting: null,
    spell: null,
    pendingInteract: null,
    hp: 10,
    maxHp: 10,
    equipment: {},
    gear: {},
    combat: null,
    running: false,
    runEnergy: 100,
    lastRunSent: 100,
    stance: 'accurate',
    specialEnergy: 100,
    lastSpecSent: 100, lastSpecQueuedSent: false, pendingSpecial: false, prayerPoints: 1, maxPrayerPoints: 1, prayerDrainAccumulator: 0, activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null, activePotions: {}, following: null, followTargetTile: null,
    ...overrides,
  }
}

function makeRock(overrides: Partial<RockState> = {}): RockState {
  return { id: 'rock_tin_1', rock: 'tin', x: 1, z: 0, depletedUntilTick: 0, ...overrides }
}

function makeCtx(rock: RockState, tick = 1): TickContext {
  return { tick, rocks: new Map([[rock.id, rock]]) }
}

const COMBAT_COLLISION = Array.from({ length: 16 }, () => '.'.repeat(16))

function combatCtx(tick: number, npcs: Map<string, NpcState>): TickContext {
  return { tick, rocks: new Map(), npcs, collision: COMBAT_COLLISION, pathAdjacent: (from, to) => findPathAdjacent(COMBAT_COLLISION, from, to) }
}

function mineIntent(rockId = 'rock_tin_1'): TickPlayer['pendingInteract'] {
  return { kind: 'rock', id: rockId, action: 'mine' }
}

describe('movement', () => {
  it('consumes one tile per tick and settles to idle once', () => {
    const player = makePlayer({ path: [{ x: 1, z: 0 }, { x: 2, z: 0 }] })
    const ctx = makeCtx(makeRock())

    expect(tickPlayer(player, ctx).entChanged).toBe(true)
    expect(player).toMatchObject({ x: 1, z: 0, anim: 'walk' })

    tickPlayer(player, ctx)
    expect(player).toMatchObject({ x: 2, z: 0, anim: 'walk', path: [] })

    expect(tickPlayer(player, ctx).entChanged).toBe(true)
    expect(player.anim).toBe('idle')
    expect(tickPlayer(player, ctx).entChanged).toBe(false)
  })
})

describe('mining', () => {
  it('runs a full cycle: 4 ticks -> ore + 17 xp + depleted rock', () => {
    const rock = makeRock()
    const player = makePlayer({ x: 0, z: 0, pendingInteract: mineIntent() })

    let events: ReturnType<typeof tickPlayer>['events'] = []
    let rockChanges: ReturnType<typeof tickPlayer>['rockChanges'] = []
    for (let tick = 1; tick <= 4; tick++) {
      const result = tickPlayer(player, makeCtx(rock, tick))
      events = events.concat(result.events)
      rockChanges = rockChanges.concat(result.rockChanges)
    }

    expect(player.inventory.filter((s) => s?.itemId === 'tin_ore')).toHaveLength(1)
    expect(player.minted.tin_ore).toBe(1)
    expect(player.stats.mining.xp).toBe(17)
    expect(player.pendingXp.mining).toBe(17)
    expect(events).toContainEqual({ e: 'xp', skill: 'mining', amount: 17 })
    expect(events.some((e) => e.e === 'inv')).toBe(true)
    expect(rockChanges).toContainEqual({ id: rock.id, depleted: true })
    expect(rock.depletedUntilTick).toBe(4 + ROCK_DEPLETED_TICKS)
  })

  it('waits out depletion and auto-continues on the same rock', () => {
    const rock = makeRock()
    const player = makePlayer({ pendingInteract: mineIntent() })
    let tick = 0
    const oreCount = () => player.inventory.filter((s) => s?.itemId === 'tin_ore').length

    for (tick = 1; tick <= 4; tick++) tickPlayer(player, makeCtx(rock, tick))
    expect(oreCount()).toBe(1)

    // Depletion window: mining latched but idle, no progress.
    for (; tick <= 4 + ROCK_DEPLETED_TICKS - 1; tick++) {
      tickPlayer(player, makeCtx(rock, tick))
      expect(player.anim).toBe('idle')
      expect(oreCount()).toBe(1)
    }

    for (; oreCount() < 2 && tick < 100; tick++) tickPlayer(player, makeCtx(rock, tick))
    expect(oreCount()).toBe(2)
    expect(player.mining).not.toBeNull()
  })

  it('refuses a rock above the player level', () => {
    const rock = makeRock()
    const player = makePlayer({ pendingInteract: mineIntent() })
    const ctx: TickContext = {
      ...makeCtx(rock),
      actions: { tin: { id: 'tin', name: 'Mine tin ore', level: 50, ticks: 4, xp: 17, product: 'tin_ore' } },
    }
    const result = tickPlayer(player, ctx)
    expect(result.events).toContainEqual({ e: 'msg', text: 'You need Mining level 50 to mine this rock.' })
    expect(player.mining).toBeNull()
  })

  it('stops with a message when the pack is full', () => {
    const rock = makeRock()
    const player = makePlayer({
      pendingInteract: mineIntent(),
      inventory: new Array(28).fill({ itemId: 'tin_ore', quantity: 1 }),
    })
    const result = tickPlayer(player, makeCtx(rock))
    expect(result.events).toContainEqual({ e: 'msg', text: 'Your pack is full.' })
    expect(player.mining).toBeNull()
  })

  it('stops when the player is no longer adjacent to the rock', () => {
    const rock = makeRock()
    const player = makePlayer({ pendingInteract: mineIntent() })
    tickPlayer(player, makeCtx(rock, 1))
    expect(player.mining).not.toBeNull()
    player.x = 5
    tickPlayer(player, makeCtx(rock, 2))
    expect(player.mining).toBeNull()
  })

  it('levels up in-session and reports it', () => {
    const rock = makeRock()
    // 83 xp = level 2; start close enough that one ore crosses the boundary.
    const player = makePlayer({ stats: { mining: { xp: 66, level: 1 } }, pendingInteract: mineIntent() })
    const events: ReturnType<typeof tickPlayer>['events'] = []
    for (let tick = 1; tick <= 4; tick++) events.push(...tickPlayer(player, makeCtx(rock, tick)).events)
    expect(player.stats.mining.level).toBe(2)
    expect(events).toContainEqual({ e: 'msg', text: "Congratulations, you've reached Mining level 2!" })
  })
})

describe('bank chest', () => {
  it('signals a bank-open on arrival at the chest', () => {
    const player = makePlayer({
      path: [{ x: 1, z: 1 }],
      pendingInteract: { kind: 'object', id: 'chest_1', action: 'bank' },
    })
    const result = tickPlayer(player, makeCtx(makeRock()))
    expect(result.bankOpen).toBe(true)
    expect(player.pendingInteract).toBeNull()
  })
})

describe('respawnedRocks', () => {
  it('reports a respawn exactly when the window ends', () => {
    const rocks = new Map([
      ['a', makeRock({ id: 'a', depletedUntilTick: 10 })],
      ['b', makeRock({ id: 'b', depletedUntilTick: 12 })],
      ['c', makeRock({ id: 'c', depletedUntilTick: 0 })],
    ])
    expect(respawnedRocks(rocks, 10)).toEqual([{ id: 'a', depleted: false }])
    expect(respawnedRocks(rocks, 11)).toEqual([])
  })
})

describe('sessionInventoryFromSave', () => {
  it('seeds the pack from the save inventory and tallies save-backed units', () => {
    const { inventory, saveBacked } = sessionInventoryFromSave({
      inventory: [
        { itemId: 'tin_ore', quantity: 1 },
        { itemId: 'tin_ore', quantity: 1 },
        { itemId: 'coins', quantity: 250 },
        null,
        { itemId: '', quantity: 3 },
      ],
    })
    expect(inventory.filter(Boolean)).toEqual([
      { itemId: 'tin_ore', quantity: 1 },
      { itemId: 'tin_ore', quantity: 1 },
      { itemId: 'coins', quantity: 250 },
    ])
    expect(inventory).toHaveLength(28)
    expect(saveBacked).toEqual({ tin_ore: 2, coins: 250 })
  })

  it('returns an empty pack for a save with no inventory', () => {
    const { inventory, saveBacked } = sessionInventoryFromSave({})
    expect(inventory.every((s) => s === null)).toBe(true)
    expect(saveBacked).toEqual({})
  })
})

describe('sessionStatsFromSave', () => {
  it('copies xp and derives missing levels from xp', () => {
    const stats = sessionStatsFromSave({ stats: { mining: { xp: 83 }, attack: { xp: 0, level: 5 } } })
    expect(stats.mining).toEqual({ xp: 83, level: 2 })
    expect(stats.attack).toEqual({ xp: 0, level: 5 })
  })
})

describe('combatStanceFromSave', () => {
  it('reads a valid persisted stance', () => {
    expect(combatStanceFromSave({ settings: { combatStance: 'aggressive' } })).toBe('aggressive')
    expect(combatStanceFromSave({ settings: { combatStance: 'defensive' } })).toBe('defensive')
  })

  it('falls back to accurate for the legacy controlled stance', () => {
    expect(combatStanceFromSave({ settings: { combatStance: 'controlled' } })).toBe('accurate')
  })

  it('falls back to accurate when unset or the save is malformed', () => {
    expect(combatStanceFromSave({ settings: {} })).toBe('accurate')
    expect(combatStanceFromSave({})).toBe('accurate')
    expect(combatStanceFromSave({ settings: { combatStance: 42 } })).toBe('accurate')
  })
})

describe('toEntityDiff', () => {
  it('maps a player to a wire-format entity diff', () => {
    const player = makePlayer({ x: 3, z: 4, anim: 'walk' })
    // gear always rides player diffs (even empty) so unequips propagate.
    expect(toEntityDiff(player)).toEqual({
      id: '1', kind: 'player', x: 3, z: 4, anim: 'walk', name: 'WorldTester', combatLevel: 3, gear: {}, hp: 10, maxHp: 10,
    })
  })

  it('carries the combat level so other clients can show it on the right-click menu', () => {
    const player = makePlayer({
      stats: {
        attack: { xp: 0, level: 40 }, strength: { xp: 0, level: 40 }, defence: { xp: 0, level: 40 },
        hitpoints: { xp: 0, level: 40 }, prayer: { xp: 0, level: 20 }, ranged: { xp: 0, level: 1 }, magic: { xp: 0, level: 1 },
      },
    })
    expect(toEntityDiff(player).combatLevel).toBe(sessionCombatLevel(player.stats))
    expect(toEntityDiff(player).combatLevel).toBe(48)
  })

  it('floors the combat level at 3 for a fresh session', () => {
    expect(sessionCombatLevel({ mining: { xp: 0, level: 1 } })).toBe(3)
  })

  it('carries targetId while the player is in an active fight', () => {
    const player = makePlayer({ combat: { npcId: 'bull_1', state: {} as never } })
    expect(toEntityDiff(player).targetId).toBe('bull_1')
  })

  it('omits targetId outside combat', () => {
    const player = makePlayer({ combat: null })
    expect(toEntityDiff(player).targetId).toBeUndefined()
  })

  it('carries hp/maxHp (item 11 — players show an overhead HP bar like NPCs)', () => {
    const player = makePlayer({ hp: 7, maxHp: 40 })
    expect(toEntityDiff(player)).toMatchObject({ hp: 7, maxHp: 40 })
  })
})

describe('entChanged on hp change', () => {
  it('marks the entity changed on a tick where a monster hits the player, even standing still mid-fight', () => {
    // A ranged/magic monster can hit an adjacent, non-moving player without
    // ever changing their x/z/anim — entChanged must still catch the hp drop
    // (tick.ts:500), or a hit like this would never stream to observers.
    const npcs = npcsFromZone([{ id: 'mage_1', monsterId: 'arcane_adept', x: 5, z: 5, wander: { x: 0, z: 0, w: 16, h: 16 } }])
    const player = makePlayer({
      charId: '1', x: 5, z: 6, hp: 400, maxHp: 400,
      stats: {
        attack: { xp: 0, level: 1 }, strength: { xp: 0, level: 1 }, defence: { xp: 0, level: 1 },
        ranged: { xp: 0, level: 1 }, magic: { xp: 0, level: 1 }, hitpoints: { xp: 200000, level: 99 },
      },
      pendingInteract: { kind: 'npc', id: 'mage_1', action: 'attack' },
    })
    let tick = 0
    tick++
    tickPlayer(player, combatCtx(tick, npcs)) // engage adjacent
    expect(player.combat).not.toBeNull()

    let sawEntChangedOnHit = false
    for (let i = 0; i < 30 && !sawEntChangedOnHit; i++) {
      tick++
      const before = player.hp
      const r = tickPlayer(player, combatCtx(tick, npcs))
      const wasHit = player.hp < before
      if (wasHit) {
        expect(r.entChanged).toBe(true)
        sawEntChangedOnHit = true
      }
    }
    expect(sawEntChangedOnHit).toBe(true)
  })
})

describe('woodcutting', () => {
  function makeTree(overrides: Partial<RockState> = {}): RockState {
    return { id: 'tree_normal_1', rock: 'normal', skill: 'woodcutting', x: 1, z: 0, depletedUntilTick: 0, ...overrides }
  }
  function chopIntent(id = 'tree_normal_1'): TickPlayer['pendingInteract'] {
    return { kind: 'rock', id, action: 'chop' }
  }

  it('runs a full cycle: 4 ticks -> logs + 25 Woodcutting xp + depleted tree', () => {
    const tree = makeTree()
    const player = makePlayer({ stats: { woodcutting: { xp: 0, level: 1 } }, pendingInteract: chopIntent() })
    const ctx = makeCtx(tree)
    for (let i = 0; i < 4; i++) tickPlayer(player, ctx)
    expect(player.inventory[0]).toEqual({ itemId: 'logs', quantity: 1 })
    expect(player.minted.logs).toBe(1)
    expect(player.pendingXp.woodcutting).toBe(25)
    expect(tree.depletedUntilTick).toBe(1 + ROCK_DEPLETED_TICKS)
  })

  it('gates oak behind Woodcutting 15 with the chop message', () => {
    const tree = makeTree({ id: 'tree_oak_1', rock: 'oak' })
    const player = makePlayer({ stats: { woodcutting: { xp: 0, level: 1 } }, pendingInteract: chopIntent('tree_oak_1') })
    const result = tickPlayer(player, makeCtx(tree))
    expect(result.events).toContainEqual({ e: 'msg', text: 'You need Woodcutting level 15 to chop this tree.' })
    expect(player.mining).toBeNull()
  })

  it('refuses the wrong verb for the node skill', () => {
    const tree = makeTree()
    const player = makePlayer({ stats: { woodcutting: { xp: 0, level: 99 } }, pendingInteract: mineIntent('tree_normal_1') })
    tickPlayer(player, makeCtx(tree))
    expect(player.mining).toBeNull()

    const rock = makeRock()
    const miner = makePlayer({ pendingInteract: { kind: 'rock', id: rock.id, action: 'chop' } })
    tickPlayer(miner, makeCtx(rock))
    expect(miner.mining).toBeNull()
  })

  it('oak at level 15 yields oak logs + 37 xp', () => {
    const tree = makeTree({ id: 'tree_oak_1', rock: 'oak' })
    const player = makePlayer({ stats: { woodcutting: { xp: 0, level: 15 } }, pendingInteract: chopIntent('tree_oak_1') })
    const ctx = makeCtx(tree)
    for (let i = 0; i < 5; i++) tickPlayer(player, ctx)
    expect(player.inventory[0]).toEqual({ itemId: 'oak_logs', quantity: 1 })
    expect(player.pendingXp.woodcutting).toBe(37)
  })
})

describe('Lumbright fishing and fieldwork', () => {
  const node = (skill: 'fishing' | 'gather', rock: string): RockState => makeRock({ id: 'resource', skill, rock })
  const playerFor = (action: string, overrides: Partial<TickPlayer> = {}) => makePlayer({
    pendingInteract: { kind: 'rock', id: 'resource', action }, ...overrides,
  })
  const run = (p: TickPlayer, n: RockState, count: number) => {
    const events: ReturnType<typeof tickPlayer>['events'] = []
    const changes: ReturnType<typeof tickPlayer>['rockChanges'] = []
    for (let t=1;t<=count;t++) {
      const r=tickPlayer(p,makeCtx(n,t)); events.push(...r.events); changes.push(...r.rockChanges)
    }
    return { events, changes }
  }
  it('gathers a bowstring every six ticks with no invented XP or depletion wait', () => {
    const p=playerFor('gather'), n=node('gather','gather_bowstring')
    run(p,n,5); expect(p.minted.bowstring).toBeUndefined()
    const result=run(p,n,7)
    expect(p.minted.bowstring).toBe(2)
    expect(p.inventory.filter((s)=>s?.itemId==='bowstring')).toHaveLength(2)
    expect(result.events.some((e)=>e.e==='xp')).toBe(false)
    expect(p.stats.gather).toBeUndefined()
    expect(n.depletedUntilTick).toBe(0)
    expect(result.changes).toEqual([])
    expect(p.anim).toBe('idle')
  })
  it('uses the idle fishing tool timing and grants the canonical shrimp product and XP', () => {
    const bare=playerFor('fish'), shore=node('fishing','shrimps')
    run(bare,shore,7); expect(bare.minted.raw_shrimps).toBeUndefined()
    run(bare,shore,1)
    expect(bare.minted.raw_shrimps).toBe(1)
    expect(bare.pendingXp.fishing).toBe(10)
    const net=playerFor('fish',{ inventory: [{itemId:'fishing_net',quantity:1},...new Array(27).fill(null)] })
    const result=run(net,node('fishing','shrimps'),4)
    expect(net.minted.raw_shrimps).toBe(1)
    expect(result.events).toContainEqual({e:'xp',skill:'fishing',amount:10})
    expect(result.changes).toEqual([])
  })
  it('refuses forged verbs, unsupported conversions, distance and a full inventory', () => {
    const wrong=playerFor('mine'); run(wrong,node('fishing','shrimps'),12); expect(wrong.minted).toEqual({})
    const distant=playerFor('gather',{x:10}); run(distant,node('gather','gather_bowstring'),12); expect(distant.minted).toEqual({})
    const conversion=playerFor('gather'); run(conversion,node('gather','burn_seaweed'),12); expect(conversion.minted).toEqual({})
    const full=playerFor('gather',{inventory:new Array(28).fill({itemId:'copper_ore',quantity:1})})
    const result=run(full,node('gather','gather_bowstring'),6)
    expect(full.minted).toEqual({})
    expect(result.events).toContainEqual({e:'msg',text:'Your pack is full.'})
  })
})
