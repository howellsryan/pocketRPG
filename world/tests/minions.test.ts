// A boss's minion is a REAL npc out here, not a copy living inside each
// player's combat session. These drive the DO's actual per-tick order (every
// npc, then stepMinions, then every player) against the real engine, so what is
// asserted is what a zone does.
import { describe, expect, it } from 'vitest'
import { countsAsEngaged, tickNpc, npcsFromZone, reselectAttacker, type NpcState } from '../server/npc'
import { stepMinions, maxMinions, minionMonsterId, summonSpec } from '../server/minions'
import { monsterAttackRange, tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { monsterWindupLeadTicks } from '../server/combat'
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
  const taken = players.map(() => 0)
  for (let i = 0; i < count; i++) {
    runTicks(1, npcs, players, tick + i, () => {
      boss.sharedSwing = swings.boss
      // EVERY sentinel on the field, not just the first — the boss keeps
      // summoning, and one left swinging would be counted as the boss's.
      for (const minion of minionsIn(npcs)) {
        // They must outlive the measurement, or one despawns partway and the
        // rest of the ticks silently contribute nothing.
        minion.hp = minion.maxHp
        minion.sharedSwing = swings.minion
      }
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
    expect(minions.length).toBeGreaterThanOrEqual(1)
    const [minion] = minions
    expect(minion.summonerId).toBe('boss_1')
    expect(boss.minionIds).toContain(minion.id)
    expect(minion.monsterId).toMatch(/^zaryth_\w+_sentinel$/)
    expect(Math.max(Math.abs(minion.x - boss.x), Math.abs(minion.z - boss.z))).toBeLessThanOrEqual(3)
    expect(minion.hp).toBe(minion.maxHp)
  })

  it('summons for the whole ROOM, not once per player', () => {
    // The trap this exists for: the engine spawns its add inside a combat
    // session, and out here that is one session per player. A room of three sees
    // the same stack a solo player does.
    const solo = bossAt(ZARYTH, 10, 10)
    runTicks(LONGEST_SUMMON_TICKS + 2, solo.npcs, [makePlayer('1', 10, 11)])

    const group = bossAt(ZARYTH, 10, 10)
    runTicks(LONGEST_SUMMON_TICKS + 2, group.npcs, [makePlayer('1', 10, 11), makePlayer('2', 9, 10), makePlayer('3', 11, 10)])
    expect(minionsIn(group.npcs).length).toBe(minionsIn(solo.npcs).length)
  })

  it('mirrors that one minion onto every session, so it still swings at them', () => {
    const { npcs } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11), makePlayer('2', 9, 10)]
    runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)
    const [minion] = minionsIn(npcs)

    for (const p of players) {
      const adds = (p.combat?.state as { adds?: { instanceId?: string; currentHP?: number }[] }).adds ?? []
      const mirror = adds.find((add) => add.instanceId === minion.id)
      expect(mirror, `player ${p.charId} is not seeing the minion`).toBeTruthy()
      expect(mirror?.currentHP).toBe(minion.hp)
    }
  })

  it('leaves a session with no minion at all until the npc exists', () => {
    // The npcs are the ONLY source of an add out here: mirrorPairedAttacker overwrites
    // state.add every tick, so nothing can put one there behind its back.
    const { npcs } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    runTicks(5, npcs, players)
    expect(minionsIn(npcs), 'too early for the npc to have appeared').toHaveLength(0)
    expect((players[0].combat?.state as { adds?: unknown[] }).adds).toHaveLength(0)
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
    expect(boss.minionIds).toContain(minion.id)
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
    expect(minionsIn(npcs).length, 'its sentinels vanished mid-fight').toBeGreaterThan(0)
  })

  it('counts either half of the pair as engagement with the other, and nothing else', () => {
    const { boss } = bossAt(ZARYTH, 10, 10)
    boss.minionIds = ['boss_1__minion']
    expect(countsAsEngaged(boss, 'boss_1')).toBe(true)
    expect(countsAsEngaged(boss, 'boss_1__minion')).toBe(true)
    expect(countsAsEngaged(boss, 'some_other_npc')).toBe(false)
    expect(countsAsEngaged(boss, undefined)).toBe(false)
    boss.minionIds = []
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
    for (let i = 0; i < 20; i++) {
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
        // Hold the stack at one: the RANGED sentinel that follows reaches five
        // tiles and would be measured as this melee one landing a blow.
        boss.summonCountdown = 999
      })
      expect(minion.attackerId, 'it let go of its target, so reach is not what is being tested').toBe('1')
      expect(minionsIn(npcs), 'a second sentinel joined the measurement').toHaveLength(1)
      taken += players[0].maxHp - players[0].hp
    }
    expect(taken, 'a melee sentinel four tiles away landed a blow').toBe(0)
  })

  it('mirrors the boss onto its sentinel\'s attacker wearing the form it is in', () => {
    // The mirror was built straight off the monsters.json row and never pinned
    // to the boss's form, so it carried no formMaxHit and monsterMaxHit fell
    // through to its DERIVED branch: Zaryth's 440 ranged and 240 strength bonus
    // came out at 213 against a player who had turned to fight a sentinel,
    // where its hardest authored form hits 60. Its style was the top-level one
    // for every swing too, so the protection prayer the room could read off the
    // boss was the wrong one two forms in three.
    const worstForm = Math.max(...Object.values(
      (monstersData as Record<string, any>)[ZARYTH].forms as Record<string, { maxHit: number }>,
    ).map((f) => f.maxHit))
    expect(worstForm, 'this boss no longer authors a per-form max hit').toBe(60)

    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    let tick = runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)
    const [minion] = minionsIn(npcs)
    turnOn(players[0], minion.id)
    tick = runTicks(4, npcs, players, tick)
    expect(players[0].combat?.npcId, 'the player never turned on the sentinel').toBe(minion.id)

    let worstHit = 0
    let landed = 0
    for (let i = 0; i < 300; i++) {
      runTicks(1, npcs, players, tick + i, () => {
        boss.sharedSwing = true                    // the boss swings every measured tick
        for (const m of minionsIn(npcs)) { m.hp = m.maxHp; m.sharedSwing = false }
      })
      const taken = players[0].maxHp - players[0].hp
      if (taken > 0) landed++
      worstHit = Math.max(worstHit, taken)
    }
    expect(landed, 'the mirrored boss never landed a blow, so this measures nothing').toBeGreaterThan(0)
    expect(worstHit, `the mirrored boss hit for ${worstHit}, past its hardest form's ${worstForm}`)
      .toBeLessThanOrEqual(worstForm)
  })

  it('stacks them up to its cap while the fight runs, if they are left alive', () => {
    // The point of the cap: leaving them alive is a CHOICE with a cost. The
    // stack grows and the incoming damage grows with it.
    const cap = maxMinions(ZARYTH)
    expect(cap, 'a boss that fields only one proves nothing here').toBeGreaterThan(1)
    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    runTicks(LONGEST_SUMMON_TICKS * (cap + 2), npcs, players)

    expect(minionsIn(npcs)).toHaveLength(cap)
    expect(boss.minionIds).toHaveLength(cap)
    expect(new Set(minionsIn(npcs).map((m) => m.id)).size, 'two of them share an id').toBe(cap)
  })

  it('stops at the cap however long the fight runs', () => {
    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    runTicks(LONGEST_SUMMON_TICKS * (maxMinions(ZARYTH) + 6), npcs, players)
    expect(minionsIn(npcs)).toHaveLength(maxMinions(ZARYTH))
    expect(boss.summonCountdown, 'a full stack must not be counting down to another').toBeNull()
  })

  it('sends a mixed group, not four copies of one sentinel', () => {
    // A style-keyed spec cycles. Reading it without a spawn count is what made
    // only the first-listed sentinel ever reach the field, leaving two authored
    // models unreachable.
    const styles = [0, 1, 2, 3].map((n) => minionMonsterId(ZARYTH, n))
    expect(new Set(styles.slice(0, 3)).size).toBe(3)
    expect(styles[3], 'the cycle should wrap').toBe(styles[0])

    const { npcs } = bossAt(ZARYTH, 10, 10)
    runTicks(LONGEST_SUMMON_TICKS * (maxMinions(ZARYTH) + 2), npcs, [makePlayer('1', 10, 11)])
    expect(new Set(minionsIn(npcs).map((m) => m.monsterId)).size).toBeGreaterThan(1)
  })

  it('summons nothing at all while it is out of combat', () => {
    // A boss standing alone in its lair must not quietly build a stack for the
    // next player through the door.
    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    runTicks(LONGEST_SUMMON_TICKS * 3, npcs, [])
    expect(boss.state).not.toBe('combat')
    expect(minionsIn(npcs)).toHaveLength(0)
    expect(boss.summonCountdown).toBeNull()
  })

  it('hits harder with a full stack than with one', () => {
    const one = bossAt(ZARYTH, 10, 10)
    const onePlayers = [makePlayer('1', 10, 11)]
    let tick = runTicks(LONGEST_SUMMON_TICKS + 2, one.npcs, onePlayers)
    expect(minionsIn(one.npcs)).toHaveLength(1)
    const fromOne = total(damageOver(40, one.npcs, onePlayers, tick, { boss: false, minion: true }))

    const many = bossAt(ZARYTH, 10, 10)
    const manyPlayers = [makePlayer('1', 10, 11)]
    tick = runTicks(LONGEST_SUMMON_TICKS * (maxMinions(ZARYTH) + 2), many.npcs, manyPlayers)
    expect(minionsIn(many.npcs)).toHaveLength(maxMinions(ZARYTH))
    const fromMany = total(damageOver(40, many.npcs, manyPlayers, tick, { boss: false, minion: true }))

    expect(fromMany, 'a stack of sentinels hit no harder than one').toBeGreaterThan(fromOne)
  })

  it('animates a sentinel the player has turned to fight', () => {
    // The clock a shared-clock npc counts down on is its OWN. Its sessions' own
    // timers are pinned to 0-or-full and never pass through the wind-up lead, so
    // reading one here leaves the monster swinging with no clip at all — which
    // is silent, and only shows up as a monster that stands still while it hits
    // you. Zaryth hid it: its pinned value happens to equal its own lead.
    const { npcs } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    let tick = runTicks(LONGEST_SUMMON_TICKS + 2, npcs, players)
    const [minion] = minionsIn(npcs)
    turnOn(players[0], minion.id)
    tick = runTicks(6, npcs, players, tick)
    expect(players[0].combat?.npcId).toBe(minion.id)
    expect(monsterWindupLeadTicks(minion.monsterId))
      .not.toBe(Math.max(2, monsterAttackSpeed(minion.monsterId)) - 1)

    let swung = false
    for (let i = 0; i < 12; i++) {
      tick = runTicks(1, npcs, players, tick)
      if (minion.anim.startsWith('attack')) swung = true
    }
    expect(swung, 'the sentinel dealt its damage without ever playing a swing').toBe(true)
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
    expect(boss.minionIds).toHaveLength(0)
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
    expect(boss.minionIds).toHaveLength(0)
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
    expect((players[0].combat?.state as { adds?: unknown[] }).adds).toHaveLength(0)
  })

  it('forgets its countdown when the fight ends, so the next one starts afresh', () => {
    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    const players = [makePlayer('1', 10, 11)]
    runTicks(5, npcs, players)
    expect(boss.summonCountdown).toBeGreaterThan(0)

    boss.state = 'idle'
    stepMinions(ctx(99, npcs, []), { npcChanged: [], npcRemoved: [] } as never)
    expect(boss.summonCountdown).toBeNull()
    expect(boss.minionIds).toHaveLength(0)
  })
})
