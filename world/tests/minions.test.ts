// A boss's minion is a REAL npc out here, not a copy living inside each
// player's combat session. These drive the DO's actual per-tick order (every
// npc, then stepMinions, then every player) against the real engine, so what is
// asserted is what a zone does.
import { describe, expect, it } from 'vitest'
import { countsAsEngaged, tickNpc, npcsFromZone, reselectAttacker, type NpcState } from '../server/npc'
import { stepMinions, minionMonsterId, summonSpec } from '../server/minions'
import { monsterAttackRange, tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
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

/** The DO's real per-tick order: retarget, every npc, the minion pass, then
 * every player.
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
    for (const npc of npcs.values()) {
      if (npc.state !== 'combat') continue
      const engaged = players.filter((p) => countsAsEngaged(npc, p.combat?.npcId)).map((p) => ({ charId: p.charId, x: p.x, z: p.z }))
      reselectAttacker(npc, engaged, COLLISION)
    }
    for (const npc of [...npcs.values()]) tickNpc(npc, c, result)
    stepMinions(c, result)
    betweenPasses?.()
    for (const p of players) {
      // Full health at the top of every tick: this is about who gets hit, not
      // about surviving a 1500-combat boss bare-handed — and it makes the damage
      // a tick dealt readable as maxHp - hp afterwards.
      p.hp = p.maxHp
      tickPlayer(p, c)
    }
  }
  return tick
}

/** Damage the players took over `count` ticks with each of the two enemies
 * either swinging every tick or silenced throughout — so a total can be
 * attributed to one of them. Holding the flag is exactly how these npcs work:
 * their sessions swing on the npc's own flag, so a flag held down is an npc that
 * never swings (world/tests/roomWideAttacks.test.ts). */
function damageOver(
  count: number,
  npcs: Map<string, NpcState>,
  players: TickPlayer[],
  tick: number,
  swings: { boss: boolean; minion: boolean },
): number[] {
  const boss = npcs.get('boss_1')!
  const minion = minionsIn(npcs)[0]
  const taken = players.map(() => 0)
  for (let i = 0; i < count; i++) {
    // The sentinel must outlive the measurement, or it despawns partway and the
    // rest of the ticks silently contribute nothing.
    minion.hp = minion.maxHp
    runTicks(1, npcs, players, tick + i, () => {
      boss.sharedSwing = swings.boss
      minion.sharedSwing = swings.minion
    })
    players.forEach((p, n) => { taken[n] += p.maxHp - p.hp })
  }
  return taken
}

const total = (perPlayer: number[]): number => perPlayer.reduce((a, b) => a + b, 0)

/** Turns this player onto another npc, the way a tap does. */
function turnOn(player: TickPlayer, npcId: string): void {
  player.pendingInteract = { kind: 'npc', id: npcId, action: 'attack' }
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
    // The npcs are the ONLY source of an add out here: mirrorPairedAttacker overwrites
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
      seen.push(!!minion.sharedSwing)
    }
    expect(seen.filter(Boolean)).toHaveLength(2)
    expect(boss.minionId).toBe(minion.id)
  })

  it('actually hurts the players fighting the boss, once per swing', () => {
    const { npcs } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11), makePlayer('2', 9, 10)]
    const tick = runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)

    const idle = total(damageOver(30, npcs, players, tick, { boss: false, minion: false }))
    expect(idle, 'took damage on a tick nothing swung').toBe(0)

    const swinging = total(damageOver(60, npcs, players, tick + 30, { boss: false, minion: true }))
    expect(swinging, 'the minion never landed a blow').toBeGreaterThan(0)
    // Each player rolls the swing against their own defence, so the ceiling is
    // one max hit per player per swing — never a multiple of that.
    expect(swinging).toBeLessThanOrEqual(60 * players.length * MINION_MAX_HIT)
  })

  it('keeps swinging at a player who has turned to fight its sentinel', () => {
    // The point of the whole pair: a player may only ATTACK one thing, but both
    // things attack them. Turning on the sentinel used to walk you out of the
    // boss fight entirely, and Zaryth stopped hitting you.
    const { npcs } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    let tick = runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)
    const [minion] = minionsIn(npcs)

    turnOn(players[0], minion.id)
    tick = runTicks(6, npcs, players, tick)
    expect(players[0].combat?.npcId, 'the player is not fighting the sentinel').toBe(minion.id)

    // Sentinel silenced, so every point of this came from the boss.
    const fromBoss = total(damageOver(60, npcs, players, tick, { boss: true, minion: false }))
    expect(fromBoss, 'the boss stopped hitting a player who turned on its sentinel').toBeGreaterThan(0)
    expect(players[0].combat?.npcId, 'the player was pulled off the sentinel').toBe(minion.id)
  })

  it('is still hit by the sentinel while the player is fighting the boss', () => {
    // The other direction of the same pair, so neither can regress alone. Unlike
    // the boss it is not room-wide: it picks one of them and closes on them.
    const { npcs } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11), makePlayer('2', 9, 10)]
    const tick = runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)
    for (const p of players) expect(p.combat?.npcId).toBe('boss_1')
    const [minion] = minionsIn(npcs)
    const chased = players.findIndex((p) => p.charId === minion.attackerId)
    expect(chased, 'the sentinel claimed nobody, so this proves nothing').toBeGreaterThanOrEqual(0)

    const fromMinion = damageOver(60, npcs, players, tick, { boss: false, minion: true })
    expect(fromMinion[chased], 'the sentinel never reached the player it chose').toBeGreaterThan(0)
  })

  it('does not let go of a player who is killing its sentinel', () => {
    // reselectAttacker empties on an empty engaged list, and an unclaimed boss
    // heals to full and leaves combat after OUT_OF_COMBAT_HEAL_TICKS (17) —
    // taking its sentinel with it. Killing the add cannot switch the boss off.
    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    let tick = runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)
    const [minion] = minionsIn(npcs)
    // Bare-handed against 310 defence the player may not have landed a blow, so
    // wound it here — the assertion is that it does not heal back, and a boss at
    // full health could not show that.
    const wounded = boss.maxHp - 100
    boss.hp = wounded

    turnOn(players[0], minion.id)
    tick = runTicks(25, npcs, players, tick)

    expect(boss.state, 'the boss dropped out of the fight').toBe('combat')
    expect(boss.hp, 'the boss healed while its sentinel was being killed').toBeLessThanOrEqual(wounded)
    expect(boss.attackerId).toBe('1')
    expect(minionsIn(npcs), 'the sentinel vanished mid-fight').toHaveLength(1)
  })

  it('counts either half of the pair as engagement with the other, and nothing else', () => {
    const { boss } = bossAt(ZARYTH, 10, 10)
    boss.minionId = 'boss_1__minion'
    expect(countsAsEngaged(boss, 'boss_1')).toBe(true)
    expect(countsAsEngaged(boss, 'boss_1__minion')).toBe(true)
    expect(countsAsEngaged(boss, 'some_other_npc')).toBe(false)
    expect(countsAsEngaged(boss, undefined)).toBe(false)
    boss.minionId = null
    expect(countsAsEngaged(boss, 'boss_1__minion')).toBe(false)

    const { boss: minion } = bossAt('zaryth_blade_sentinel', 12, 10)
    minion.summonerId = 'boss_1'
    expect(countsAsEngaged(minion, 'boss_1'), 'the sentinel ignores the boss it guards').toBe(true)
    expect(countsAsEngaged(minion, 'some_other_npc')).toBe(false)
  })

  it('animates both of them swinging, including the one nobody is fighting', () => {
    // The sentinel has no attacker of its own, so no session but the boss's is
    // in a position to pulse its swing — and a boss on a shared clock cannot be
    // pulsed off its session timer at all, since that is pinned to 0-or-full.
    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    let tick = runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)
    const [minion] = minionsIn(npcs)
    expect(players[0].combat?.npcId, 'no session has the sentinel as its target').toBe('boss_1')

    const swung = { boss: false, minion: false }
    for (let i = 0; i < 12; i++) {
      tick = runTicks(1, npcs, players, tick)
      if (boss.anim.startsWith('attack')) swung.boss = true
      if (minion.anim.startsWith('attack')) swung.minion = true
    }
    expect(swung).toEqual({ boss: true, minion: true })
  })

  it('cannot reach a player it is nowhere near, whatever the boss can reach', () => {
    // The partner's swing is gated on the PARTNER's reach. Reusing the session
    // npc's would have a melee sentinel striking someone on the far side of the
    // room because the boss beside it happened to be in range of them.
    const { npcs } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    let tick = runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)
    const [minion] = minionsIn(npcs)
    expect(monsterAttackRange(minion.monsterId), 'this sentinel is not the melee one').toBe(1)

    let taken = 0
    for (let i = 0; i < 40; i++) {
      const boss = npcs.get('boss_1')!
      tick = runTicks(1, npcs, players, tick, () => {
        // Pinned four tiles off the player and swinging every tick. Close enough
        // to home that it keeps chasing (a leash break would clear its target
        // and prove nothing), far enough that only its REACH can stop it.
        minion.x = 14
        minion.z = 14
        minion.hp = minion.maxHp
        minion.sharedSwing = true
        boss.sharedSwing = false
      })
      expect(minion.attackerId, 'it let go of its target, so reach is not what is being tested').toBe('1')
      taken += players[0].maxHp - players[0].hp
    }
    expect(taken, 'a melee sentinel four tiles away landed a blow').toBe(0)
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
