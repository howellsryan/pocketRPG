// A roomWideAttacks boss (Zaryth) swings at everybody present, not just the one
// player its retaliation follows. The world's combat model is one engine session
// per player against a shared npc, so this needs the same two pieces the co-op
// room needed: a clock owned by the NPC, and every engaged session allowed to
// apply the swing to its own player.
import { describe, expect, it } from 'vitest'
import { tickNpc, npcsFromZone, type NpcState } from '../server/npc'
import { tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'
import monstersData from '../../src/data/monsters.json'

const COLLISION = Array.from({ length: 24 }, () => '.'.repeat(24))
const ZARYTH = 'zaryth_the_empty_lord'
const GRONDAR = 'warlord_grondar'

function makePlayer(charId: string, x: number, z: number): TickPlayer {
  return {
    charId, name: `p${charId}`, x, z, path: [], anim: 'idle',
    stats: {
      attack: { xp: 100000, level: 40 }, strength: { xp: 100000, level: 40 },
      defence: { xp: 100000, level: 40 }, ranged: { xp: 0, level: 1 },
      magic: { xp: 0, level: 1 }, hitpoints: { xp: 1200000, level: 90 },
    },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null,
    pendingInteract: { kind: 'npc', id: 'boss_1', action: 'attack' },
    hp: 500, maxHp: 500, equipment: {}, gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', spell: null,
    specialEnergy: 100, lastSpecSent: 100, lastSpecQueuedSent: false, pendingSpecial: false,
    prayerPoints: 1, maxPrayerPoints: 1, prayerDrainAccumulator: 0,
    activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null,
    activePotions: {}, following: null, followTargetTile: null,
  } as TickPlayer
}

function bossAt(monsterId: string, x: number, z: number) {
  const npcs = npcsFromZone([{ id: 'boss_1', monsterId, x, z, wander: { x: 0, z: 0, w: 24, h: 24 } }])
  return { npcs, boss: npcs.get('boss_1')! }
}

function ctx(tick: number, npcs: Map<string, NpcState>, players: TickPlayer[]): TickContext {
  return {
    tick, rocks: new Map(), npcs, collision: COLLISION,
    players: new Map(players.map((p) => [p.charId, p])),
    pathAdjacent: (from, to) => findPathAdjacent(COLLISION, from, to),
  } as TickContext
}

/** Runs the DO's real per-tick order: every npc, then every player. */
function runTicks(count: number, npcs: Map<string, NpcState>, players: TickPlayer[]) {
  const damage = new Map(players.map((p) => [p.charId, 0]))
  for (let tick = 1; tick <= count; tick++) {
    const c = ctx(tick, npcs, players)
    for (const npc of npcs.values()) tickNpc(npc, c, { npcChanged: [], npcRemoved: [] } as never)
    for (const p of players) {
      const before = p.hp
      tickPlayer(p, c)
      if (p.hp < before) damage.set(p.charId, damage.get(p.charId)! + (before - p.hp))
      // Keep everyone alive and in the fight: this is about who gets hit, not
      // about surviving a 1500-combat boss with no gear.
      if (p.hp < 200) p.hp = 500
    }
  }
  return damage
}

describe('a room-wide boss in the open world', () => {
  it('is flagged by its data, and no other world boss is', () => {
    expect((monstersData as never as Record<string, { roomWideAttacks?: boolean }>)[ZARYTH].roomWideAttacks).toBe(true)
    expect((monstersData as never as Record<string, { roomWideAttacks?: boolean }>)[GRONDAR].roomWideAttacks).toBeUndefined()
  })

  it('damages every engaged player, not just the one it is retaliating against', () => {
    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11), makePlayer('2', 9, 10), makePlayer('3', 11, 10)]
    const damage = runTicks(40, npcs, players)
    expect(boss.attackerId, 'one player still owns its retaliation').toBeTruthy()
    for (const p of players) {
      expect(damage.get(p.charId), `player ${p.charId} was never hit`).toBeGreaterThan(0)
    }
  })

  it('leaves a normal boss hitting only the player it is facing', () => {
    const { npcs, boss } = bossAt(GRONDAR, 10, 10)
    const players = [makePlayer('1', 10, 11), makePlayer('2', 9, 10), makePlayer('3', 11, 10)]
    const damage = runTicks(40, npcs, players)
    const hit = players.filter((p) => damage.get(p.charId)! > 0)
    expect(hit).toHaveLength(1)
    expect(hit[0].charId).toBe(boss.attackerId)
  })

  it('swings on the npc\'s own clock, so more players never means more swings', () => {
    // The trap: each player runs their own session with its own attack timer.
    // Left alone, a room of N players takes N times the swings.
    const solo = bossAt(ZARYTH, 10, 10)
    const soloDamage = runTicks(60, solo.npcs, [makePlayer('1', 10, 11)])

    const group = bossAt(ZARYTH, 10, 10)
    const groupPlayers = [makePlayer('1', 10, 11), makePlayer('2', 9, 10), makePlayer('3', 11, 10)]
    const groupDamage = runTicks(60, group.npcs, groupPlayers)

    const solo1 = soloDamage.get('1')!
    for (const p of groupPlayers) {
      // Each player takes their own rolls, so allow spread — but nobody may
      // take anything like the 3x a per-session clock would deal.
      expect(groupDamage.get(p.charId)!, `player ${p.charId} took far more in a group`)
        .toBeLessThan(solo1 * 2)
    }
  })

  it('keeps its clock ticking while it is chasing or unclaimed', () => {
    // advanceSharedSwing runs before the early returns for "no attacker" and
    // "out of reach", so a boss that spends a tick closing the gap resumes on
    // its own cadence instead of restarting the countdown.
    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    boss.state = 'combat'
    boss.attackerId = null
    const seen: boolean[] = []
    for (let tick = 1; tick <= 6; tick++) {
      tickNpc(boss, ctx(tick, npcs, []), { npcChanged: [], npcRemoved: [] } as never)
      seen.push(!!boss.sharedSwing)
    }
    // attackSpeed 3 → a swing every third tick, even with nobody claimed.
    expect(seen).toEqual([false, false, true, false, false, true])
  })

  it('clears the swing flag while it is dead', () => {
    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    boss.sharedSwing = true
    boss.state = 'dead'
    boss.respawnAtTick = 9999
    tickNpc(boss, ctx(1, npcs, []), { npcChanged: [], npcRemoved: [] } as never)
    expect(boss.sharedSwing).toBe(false)
  })
})
