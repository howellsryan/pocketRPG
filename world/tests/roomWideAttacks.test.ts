// A roomWideAttacks boss (Zaryth) swings at everybody present, not just the one
// player its retaliation follows. The world's combat model is one engine session
// per player against a shared npc, so this needs the same two pieces the co-op
// room needed: a clock owned by the NPC, and every engaged session allowed to
// apply the swing to its own player.
import { describe, expect, it } from 'vitest'
import { ensureForm, tickNpc, npcsFromZone, type NpcState } from '../server/npc'
import { tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { monsterWindupLeadTicks, startCombat, stepCombat } from '../server/combat'
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
    for (let tick = 1; tick <= 12; tick++) {
      tickNpc(boss, ctx(tick, npcs, []), { npcChanged: [], npcRemoved: [] } as never)
      seen.push(!!boss.sharedSwing)
    }
    // attackSpeed 6 → a swing every sixth tick, even with nobody claimed.
    expect(seen).toEqual([false, false, false, false, false, true, false, false, false, false, false, true])
  })

  it('rotates its form once for the room, and swings with the form it is in', () => {
    // A multi-form boss's style decides its clip, its reach and what it hits
    // for. Rolled inside the sessions, eight players fought eight differently
    // formed bosses off one health bar; read off the top-level attackStyle,
    // Zaryth was permanently ranged out here and the melee and magic clips its
    // rig ships never played at all.
    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    const monster = (monstersData as never as Record<string, { multiForm?: boolean; forms?: Record<string, unknown> }>)[ZARYTH]
    expect(monster.multiForm, 'this boss does not rotate').toBe(true)

    const players = [makePlayer('1', 10, 11), makePlayer('2', 9, 10)]
    const seen = new Set<string>()
    const anims = new Set<string>()
    for (let tick = 1; tick <= 60; tick++) {
      const c = ctx(tick, npcs, players)
      for (const npc of npcs.values()) tickNpc(npc, c, { npcChanged: [], npcRemoved: [] } as never)
      for (const p of players) { p.hp = p.maxHp; tickPlayer(p, c) }
      if (boss.currentForm) seen.add(boss.currentForm)
      if (boss.anim.startsWith('attack')) anims.add(boss.anim)
      // One form for the room: both sessions swing with whatever the npc is in.
      for (const p of players) {
        const form = (p.combat?.state as { monster?: { currentForm?: string } })?.monster?.currentForm
        if (form) expect(form, `player ${p.charId} is fighting a different form`).toBe(boss.currentForm)
      }
    }
    expect(seen.size, 'it never left its starting form').toBeGreaterThan(1)
    expect(Object.keys(monster.forms ?? {})).toEqual(expect.arrayContaining([...seen]))
    // And the clip follows the form, rather than the starting style forever.
    expect(anims.size, `only ever played ${[...anims]}`).toBeGreaterThan(1)
  })

  it('keeps animating its swing when one of the players it reaches is out of range', () => {
    // Every engaged player's session signals the npc, and each call clears the
    // anim before re-setting it — so gating the signal on that one player's
    // reach let whichever session happened to run LAST wipe the clip for the
    // whole room. One player stepping out of range and the boss swung silently
    // at everybody still standing in front of it.
    // A player outside BOTH reaches drops the fight, so the case needs the one
    // asymmetry that keeps someone engaged and untouchable: a bow outranging
    // the form the boss is in. Pinned to melee, Zaryth reaches a single tile.
    const { npcs, boss } = bossAt(ZARYTH, 10, 10)
    const melee = makePlayer('1', 10, 11)
    const archer = makePlayer('2', 10, 14)
    archer.stats.ranged = { xp: 100000, level: 40 }
    // Arrows included: running dry ends the fight, and a disengaged session
    // never reaches the signal at all.
    archer.equipment = {
      weapon: { itemId: 'shortbow', quantity: 1 },
      ammo: { itemId: 'bronze_arrow', quantity: 5000 },
    } as never
    startCombat(melee, boss)
    startCombat(archer, boss)
    for (const p of [melee, archer]) (p.combat as { passive?: boolean }).passive = false

    boss.state = 'combat'
    boss.attackerId = melee.charId
    boss.currentForm = 'melee'
    // Parked exactly on the lead tick, which is the one tick the signal fires.
    boss.attackTimer = monsterWindupLeadTicks(ZARYTH)
    const c = ctx(5, npcs, [melee, archer])
    const result = { events: [], hits: [], kills: [], npcChanged: [], npcRemoved: [], xp: [] } as never

    stepCombat(melee, c, result)
    expect(boss.anim, 'the adjacent player never led the swing').toBe('attack')
    stepCombat(archer, c, result)
    expect(archer.combat, 'the archer disengaged, so this proves nothing').toBeTruthy()
    expect(boss.anim, 'the archer\'s session wiped the swing clip for the room').toBe('attack')
  })

  it('opens on the same form cadence the solo fight rolls', () => {
    // The opening threshold was a hardcoded 3, so a boss with an authored
    // formSwitchMin/Max held its first form for a different number of swings
    // out here than it does everywhere else the player has learned it.
    // Warden of Arasmus authors 3..3, so its opening threshold can only be 3;
    // Nylocas authors 3..5, so a 3 that never moves is the bug.
    const fixed = { id: 'n', monsterId: 'warden_of_arasmus' } as unknown as NpcState
    ensureForm(fixed)
    expect(fixed.formSwitchThreshold).toBe(3)

    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) {
      const npc = { id: 'n', monsterId: 'nylocas_vasilias' } as unknown as NpcState
      ensureForm(npc)
      seen.add(npc.formSwitchThreshold!)
    }
    expect([...seen].sort(), 'the opening threshold is not rolled from the authored range')
      .toEqual([3, 4, 5])
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
