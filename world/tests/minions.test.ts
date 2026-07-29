// A boss's minion is a REAL npc out here, not a copy living inside each
// player's combat session. These drive the DO's actual per-tick order (every
// npc, then stepMinions, then every player) against the real engine, so what is
// asserted is what a zone does.
import { describe, expect, it } from 'vitest'
import { tickNpc, npcsFromZone, type NpcState } from '../server/npc'
import { stepMinions, minionMonsterId, summonSpec } from '../server/minions'
import { tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'
import { MONSTER_MODELS } from '../shared/monsterModels'
import monstersData from '../../src/data/monsters.json'

const COLLISION = Array.from({ length: 24 }, () => '.'.repeat(24))
const ZARYTH = 'zaryth_the_empty_lord'
const GRONDAR = 'warlord_grondar'
// The longest wait the spec can roll: 12 boss attacks at 3 ticks each.
const LONGEST_SUMMON_TICKS = 36
// Every sentinel hits for the same ceiling, whichever style is summoned.
const MINION_MAX_HIT = 15

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
    players: new Map(players.map((p) => [p.charId, { x: p.x, z: p.z }])),
    pathAdjacent: (from, to) => findPathAdjacent(COLLISION, from, to),
  } as TickContext
}

/** The DO's real per-tick order: every npc, the minion pass, then every player.
 * `betweenPasses` runs where the DO's own passes meet, which is the only place
 * a test can pin the shared swing clocks the sessions are about to read. */
function runTicks(
  count: number,
  npcs: Map<string, NpcState>,
  players: TickPlayer[],
  startTick = 1,
  betweenPasses?: () => void,
): number {
  let tick = startTick
  for (; tick < startTick + count; tick++) {
    const c = ctx(tick, npcs, players)
    const result = { npcChanged: [], npcRemoved: [] } as never
    for (const npc of [...npcs.values()]) tickNpc(npc, c, result)
    stepMinions(c, result)
    betweenPasses?.()
    for (const p of players) {
      tickPlayer(p, c)
      // Keep everyone alive and swinging: this is about the minion's lifecycle,
      // not about surviving a 1500-combat boss bare-handed.
      if (p.hp < 200) p.hp = 500
    }
  }
  return tick
}

/** Total damage the players took over `count` ticks with the BOSS silenced, so
 * every point of it came from the minion. Silencing the boss is exactly how a
 * room-wide attacker works: its sessions swing on the npc's flag, so a flag held
 * down is a boss that never swings (world/tests/roomWideAttacks.test.ts). */
function minionDamageOver(count: number, npcs: Map<string, NpcState>, players: TickPlayer[], tick: number, minionSwings: boolean): number {
  const boss = npcs.get('boss_1')!
  const minion = minionsIn(npcs)[0]
  let taken = 0
  for (let i = 0; i < count; i++) {
    const before = players.map((p) => p.hp)
    runTicks(1, npcs, players, tick + i, () => {
      boss.roomWideSwing = false
      minion.roomWideSwing = minionSwings
    })
    players.forEach((p, n) => { taken += Math.max(0, before[n] - p.hp) })
  }
  return taken
}

function monsterAttackSpeed(monsterId: string): number {
  return (monstersData as Record<string, { attackSpeed?: number }>)[monsterId].attackSpeed!
}

function minionsIn(npcs: Map<string, NpcState>): NpcState[] {
  return [...npcs.values()].filter((n) => n.summonerId)
}

describe('a boss that summons minions in the open world', () => {
  it('reads its minion straight off the monster data, for any boss that has one', () => {
    expect(summonSpec(ZARYTH)).toBeTruthy()
    expect(summonSpec(GRONDAR)).toBeNull()
    // The other shipped summoner uses the single-`monsterId` spec shape, so the
    // resolver has to answer for both without the caller branching.
    expect(minionMonsterId('corporeal_horror')).toBe('dread_core')
    expect(minionMonsterId(ZARYTH)).toMatch(/^zaryth_\w+_sentinel$/)
  })

  it('gives every minion it can summon a model to render with', () => {
    const summoned = Object.values(monstersData as Record<string, { isAdd?: boolean; summonedBy?: string }>)
      .filter((m) => m.isAdd && m.summonedBy === ZARYTH)
    expect(summoned.length).toBe(3)
    for (const style of ['blade', 'bolt', 'rune']) {
      expect(MONSTER_MODELS[`zaryth_${style}_sentinel`], `${style} sentinel has no model`).toBeTruthy()
    }
  })

  it('puts one on the field beside the boss once the fight has run long enough', () => {
    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)

    const minions = minionsIn(npcs)
    expect(minions).toHaveLength(1)
    const [minion] = minions
    expect(minion.summonerId).toBe('boss_1')
    expect(boss.minionId).toBe(minion.id)
    expect(minion.monsterId).toMatch(/^zaryth_\w+_sentinel$/)
    expect(Math.max(Math.abs(minion.x - boss.x), Math.abs(minion.z - boss.z))).toBeLessThanOrEqual(3)
    expect(minion.hp).toBe(minion.maxHp)
  })

  it('summons ONE for the whole room, not one per player', () => {
    // The trap this exists for: the engine spawns its add inside a combat
    // session, and out here that is one session per player.
    const { npcs } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11), makePlayer('2', 9, 10), makePlayer('3', 11, 10)]
    runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)
    expect(minionsIn(npcs)).toHaveLength(1)
  })

  it('mirrors that one minion onto every session, so it still swings at them', () => {
    const { npcs } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11), makePlayer('2', 9, 10)]
    runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)
    const [minion] = minionsIn(npcs)

    for (const p of players) {
      const add = (p.combat?.state as { add?: { id?: string; currentHP?: number } }).add
      expect(add?.id, `player ${p.charId} is not seeing the minion`).toBe(minion.monsterId)
      expect(add?.currentHP).toBe(minion.hp)
    }
  })

  it('leaves a session with no minion at all until the npc exists', () => {
    // The npc is the ONLY source of an add out here: mirrorMinion overwrites
    // state.add every tick, so nothing can put one there behind its back.
    const { npcs } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    runTicks(5, npcs, players)
    expect(minionsIn(npcs), 'too early for the npc to have appeared').toHaveLength(0)
    expect((players[0].combat?.state as { add?: unknown }).add).toBeNull()
  })

  it('never respawns a summoned minion on the spot, the way an authored spawn returns', () => {
    // tickNpc's own guard, asserted directly: stepMinions normally clears the
    // corpse first (linger 6 ticks, respawn 25), so nothing else reaches this.
    const { npcs } = bossAt(ZARYTH, 10, 10)
    const minion = npcsFromZone([{ id: 'boss_1__minion', monsterId: 'zaryth_blade_sentinel', x: 11, z: 10, wander: { x: 11, z: 10, w: 1, h: 1 } }]).get('boss_1__minion')!
    minion.summonerId = 'boss_1'
    minion.state = 'dead'
    minion.hp = 0
    minion.respawnAtTick = 5
    npcs.set(minion.id, minion)

    tickNpc(minion, ctx(9, npcs, []), { npcChanged: [], npcRemoved: [] } as never)
    expect(minion.state).toBe('dead')
    expect(minion.hp).toBe(0)
  })

  it('swings on its own clock, at its own speed', () => {
    // The clock belongs to the npc for the same reason the boss's does: the
    // sessions that resolve its swings are rebuilt per player, per tick.
    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    let tick = runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)
    const [minion] = minionsIn(npcs)
    expect(monsterAttackSpeed(minion.monsterId)).toBe(4)

    const seen: boolean[] = []
    for (let i = 0; i < 8; i++) {
      tick = runTicks(1, npcs, players, tick)
      seen.push(!!minion.roomWideSwing)
    }
    expect(seen.filter(Boolean)).toHaveLength(2)
    expect(boss.minionId).toBe(minion.id)
  })

  it('actually hurts the players fighting the boss, once per swing', () => {
    const { npcs } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11), makePlayer('2', 9, 10)]
    const tick = runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)

    const idle = minionDamageOver(30, npcs, players, tick, false)
    expect(idle, 'took damage on a tick nothing swung').toBe(0)

    const swinging = minionDamageOver(60, npcs, players, tick + 30, true)
    expect(swinging, 'the minion never landed a blow').toBeGreaterThan(0)
    // Each player rolls the swing against their own defence, so the ceiling is
    // one max hit per player per swing — never a multiple of that.
    expect(swinging).toBeLessThanOrEqual(60 * players.length * MINION_MAX_HIT)
  })

  it('takes it off the field with the boss', () => {
    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    const next = runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)
    expect(minionsIn(npcs)).toHaveLength(1)

    boss.state = 'dead'
    boss.respawnAtTick = next + 100
    boss.removeAtTick = next + 6
    const removed: string[] = []
    const c = ctx(next, npcs, players)
    stepMinions(c, { npcChanged: [], npcRemoved: removed } as never)

    expect(minionsIn(npcs)).toHaveLength(0)
    expect(removed).toHaveLength(1)
    expect(boss.minionId).toBeNull()
  })

  it('removes a killed one instead of respawning it, and summons a replacement', () => {
    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    let tick = runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)
    const [minion] = minionsIn(npcs)

    // Killed the way stepCombat kills anything: dead now, corpse gone shortly.
    minion.state = 'dead'
    minion.hp = 0
    minion.respawnAtTick = tick + 25
    minion.removeAtTick = tick + 6
    tick = runTicks(7, npcs, players, tick)

    expect(npcs.has(minion.id), 'the corpse is still on the field').toBe(false)
    expect(boss.minionId).toBeNull()
    expect(boss.summonCountdown).toBeGreaterThan(0)
    // A replacement follows on the boss's own schedule — it does not simply
    // pop back up where the old one stood.
    runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players, tick)
    expect(minionsIn(npcs)).toHaveLength(1)
  })

  it('summons nothing for a boss that has no minions', () => {
    const { npcs } = bossAt(GRONDAR, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)
    expect(minionsIn(npcs)).toHaveLength(0)
    expect((players[0].combat?.state as { add?: unknown }).add).toBeNull()
  })

  it('forgets its countdown when the fight ends, so the next one starts afresh', () => {
    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    runTicks(5, npcs, players)
    expect(boss.summonCountdown).toBeGreaterThan(0)

    boss.state = 'idle'
    stepMinions(ctx(99, npcs, []), { npcChanged: [], npcRemoved: [] } as never)
    expect(boss.summonCountdown).toBeNull()
    expect(boss.minionId).toBeNull()
  })
})
