// Item 10 — right-click Follow. The re-path/cancel machinery lives in
// tick.ts's tickPlayer (updateFollow is private; exercised indirectly here
// through player.following/followTargetTile + ctx.players, exactly how
// WorldZone.ts drives it). Protocol parsing is covered in protocol.test.ts.
import { describe, expect, it } from 'vitest'
import { tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'

const COLLISION = Array.from({ length: 20 }, () => '.'.repeat(20))

function makePlayer(overrides: Partial<TickPlayer> = {}): TickPlayer {
  return {
    charId: '1', name: 'Follower', x: 0, z: 0, path: [], anim: 'idle',
    stats: { mining: { xp: 0, level: 1 } },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null, spell: null, pendingInteract: null,
    hp: 10, maxHp: 10, equipment: {}, gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', specialEnergy: 100, lastSpecSent: 100, lastSpecQueuedSent: false, pendingSpecial: false,
    prayerPoints: 1, maxPrayerPoints: 1, prayerDrainAccumulator: 0, activeProtectionPrayer: null, activeCombatPrayer: null,
    lastPrayerSent: null, activePotions: {}, following: null, followTargetTile: null,
    ...overrides,
  }
}

function followCtx(tick: number, players: Map<string, { x: number; z: number }>, onPathAdjacent?: () => void): TickContext {
  return {
    tick, rocks: new Map(), collision: COLLISION, players,
    pathAdjacent: (from, to) => {
      onPathAdjacent?.()
      return findPathAdjacent(COLLISION, from, to)
    },
  }
}

describe('follow — re-pathing', () => {
  it('paths toward a followed target and starts moving the same tick', () => {
    const player = makePlayer({ x: 0, z: 0, following: '2' })
    tickPlayer(player, followCtx(1, new Map([['2', { x: 6, z: 0 }]])))
    expect(player.followTargetTile).toEqual({ x: 6, z: 0 })
    expect(player.x).toBeGreaterThan(0) // took at least one step this tick
  })

  it('stops adjacent to the target, never on their occupied tile', () => {
    const player = makePlayer({ x: 0, z: 0, following: '2' })
    const target = { x: 5, z: 5 }
    let tick = 1
    tickPlayer(player, followCtx(tick, new Map([['2', target]])))
    while (player.path.length > 0 && tick < 20) {
      tick++
      tickPlayer(player, followCtx(tick, new Map([['2', target]])))
    }
    expect(player.x === target.x && player.z === target.z).toBe(false)
    expect(Math.max(Math.abs(player.x - target.x), Math.abs(player.z - target.z))).toBe(1)
  })

  it('only re-paths when the target tile actually changes (guards the pathfind cost)', () => {
    let pathCalls = 0
    const player = makePlayer({ x: 0, z: 0, following: '2' })
    const stationary = new Map([['2', { x: 6, z: 0 }]])
    tickPlayer(player, followCtx(1, stationary, () => pathCalls++))
    expect(pathCalls).toBe(1)
    tickPlayer(player, followCtx(2, stationary, () => pathCalls++))
    tickPlayer(player, followCtx(3, stationary, () => pathCalls++))
    expect(pathCalls).toBe(1) // target hasn't moved — no re-path

    const moved = new Map([['2', { x: 6, z: 8 }]])
    tickPlayer(player, followCtx(4, moved, () => pathCalls++))
    expect(pathCalls).toBe(2) // target moved — re-path
  })

  it('re-plans when the target moves to a new tile', () => {
    const player = makePlayer({ x: 0, z: 0, following: '2' })
    tickPlayer(player, followCtx(1, new Map([['2', { x: 5, z: 0 }]])))
    expect(player.followTargetTile).toEqual({ x: 5, z: 0 })
    tickPlayer(player, followCtx(2, new Map([['2', { x: 0, z: 8 }]])))
    expect(player.followTargetTile).toEqual({ x: 0, z: 8 })
  })
})

describe('follow — cancel conditions', () => {
  it('clears following when the target has left the zone', () => {
    const player = makePlayer({ following: '2', followTargetTile: { x: 5, z: 5 } })
    tickPlayer(player, followCtx(1, new Map()))
    expect(player.following).toBeNull()
    expect(player.followTargetTile).toBeNull()
  })

  it('clears following the tick combat starts (covers both attacking and being attacked)', () => {
    const player = makePlayer({
      following: '2',
      combat: { npcId: 'bull_1', state: {} as never },
    })
    tickPlayer(player, followCtx(1, new Map([['2', { x: 5, z: 5 }]])))
    expect(player.following).toBeNull()
  })

  it('does not move the player toward the target once following is cleared', () => {
    const player = makePlayer({ x: 0, z: 0, following: null })
    tickPlayer(player, followCtx(1, new Map([['2', { x: 10, z: 10 }]])))
    expect(player).toMatchObject({ x: 0, z: 0 })
  })
})
