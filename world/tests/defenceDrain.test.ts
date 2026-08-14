// A world boss is fought by several players off one health bar, so the defence
// their specials grind off it is shared state exactly as that health bar is.
// Left on the session that landed it, a Dragon Warhammer smash lowered the boss
// for one player and for nobody else in the fight — the same bug co-op closed
// with MUTABLE_MONSTER_FIELDS (src/engine/coopBossEngine.js).
import { describe, expect, it, vi, afterEach } from 'vitest'
import { tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { captureDefenceDrain, npcsFromZone, pinDefenceDrainToSession, tickNpc, type NpcState } from '../server/npc'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'
import monstersData from '../../src/data/monsters.json'

const COLLISION = Array.from({ length: 32 }, () => '.'.repeat(32))
const BOSS = 'warlord_grondar'
const BASE_DEFENCE = (monstersData as Record<string, { stats: { defence: number } }>)[BOSS].stats.defence

afterEach(() => vi.restoreAllMocks())

function makePlayer(charId: string, x: number, z: number, weapon: string): TickPlayer {
  return {
    charId, name: `T${charId}`, x, z, path: [], anim: 'idle',
    stats: {
      attack: { xp: 13034431, level: 99 }, strength: { xp: 13034431, level: 99 },
      defence: { xp: 13034431, level: 99 }, ranged: { xp: 0, level: 1 },
      magic: { xp: 0, level: 1 }, hitpoints: { xp: 13034431, level: 99 },
    },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null,
    pendingInteract: { kind: 'npc', id: 'boss_1', action: 'attack' },
    hp: 99, maxHp: 99, equipment: { weapon: { itemId: weapon, quantity: 1 } }, gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'aggressive', spell: null,
    specialEnergy: 100, lastSpecSent: 100, lastSpecQueuedSent: false, pendingSpecial: false,
    prayerPoints: 1, maxPrayerPoints: 1, prayerDrainAccumulator: 0,
    activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null,
    activePotions: {}, following: null, followTargetTile: null,
  } as unknown as TickPlayer
}

function bossZone(): { npcs: Map<string, NpcState>; npc: NpcState } {
  const npcs = npcsFromZone([{ id: 'boss_1', monsterId: BOSS, x: 10, z: 10, wander: { x: 0, z: 0, w: 32, h: 32 } }])
  const npc = npcs.get('boss_1')!
  // A health pool no test fight can chew through, so the drain is never lost to
  // a kill mid-assertion.
  npc.maxHp = 100000
  npc.hp = 100000
  return { npcs, npc }
}

function ctx(tick: number, npcs: Map<string, NpcState>): TickContext {
  return {
    tick, rocks: new Map(), npcs, collision: COLLISION,
    pathAdjacent: (from, to) => findPathAdjacent(COLLISION, from, to),
  } as TickContext
}

/** Walks a player into the fight and fires one special, with every roll landing. */
function specOnce(player: TickPlayer, npcs: Map<string, NpcState>, from: number): number {
  vi.spyOn(Math, 'random').mockReturnValue(0.0001)
  let tick = from
  while (!player.combat && tick < from + 20) tickPlayer(player, ctx(++tick, npcs))
  const state = player.combat!.state as { specialAttackQueued: boolean; playerAttackTimer: number }
  state.specialAttackQueued = true
  state.playerAttackTimer = 0
  tickPlayer(player, ctx(++tick, npcs))
  return tick
}

const sessionDefence = (player: TickPlayer): number =>
  (player.combat!.state as { monster: { stats: { defence: number } } }).monster.stats.defence

describe('a defence drain belongs to the world npc, not to the session that landed it', () => {
  it('reaches a second player who never swung the hammer', () => {
    const { npcs, npc } = bossZone()
    const hammer = makePlayer('1', 10, 11, 'dragon_warhammer')
    const tick = specOnce(hammer, npcs, 0)
    const drained = BASE_DEFENCE - Math.floor(BASE_DEFENCE * 0.3)
    expect(sessionDefence(hammer)).toBe(drained)
    expect(npc.defenceDrain?.defence).toBe(drained)

    const mate = makePlayer('2', 9, 10, 'grondar_godsword')
    specOnce(mate, npcs, tick)
    expect(sessionDefence(mate)).toBe(drained)
  })

  it("carries a Grondar Godsword's warstrike across the room the same way", () => {
    const { npcs, npc } = bossZone()
    const sword = makePlayer('1', 10, 11, 'grondar_godsword')
    const tick = specOnce(sword, npcs, 0)
    const drainedBonus = (sword.combat!.state as { monster: { defenceBonus: Record<string, number> } }).monster.defenceBonus
    expect(npc.defenceDrain?.bonus?.crush).toBeGreaterThan(0)

    const mate = makePlayer('2', 9, 10, 'dragon_warhammer')
    specOnce(mate, npcs, tick)
    const mateBonus = (mate.combat!.state as { monster: { defenceBonus: Record<string, number> } }).monster.defenceBonus
    expect(mateBonus.crush).toBe(drainedBonus.crush)
  })

  it('re-pinning a total the session already carries never subtracts it twice', () => {
    const { npcs, npc } = bossZone()
    const sword = makePlayer('1', 10, 11, 'grondar_godsword')
    specOnce(sword, npcs, 0)
    const after = { ...(sword.combat!.state as { monster: { defenceBonus: Record<string, number> } }).monster.defenceBonus }
    for (let i = 0; i < 10; i++) pinDefenceDrainToSession((sword.combat!.state as { monster: never }).monster, npc)
    expect((sword.combat!.state as { monster: { defenceBonus: Record<string, number> } }).monster.defenceBonus).toEqual(after)
  })

  it('stores nothing for a fight that drained nothing', () => {
    const { npcs, npc } = bossZone()
    const plain = makePlayer('1', 10, 11, 'dragon_scimitar')
    let tick = 0
    while (!plain.combat && tick < 20) tickPlayer(plain, ctx(++tick, npcs))
    for (let t = 0; t < 10; t++) tickPlayer(plain, ctx(++tick, npcs))
    expect(npc.defenceDrain).toBeNull()
    expect(captureDefenceDrain(npc, (plain.combat!.state as { monster: never }).monster)).toBeNull()
  })

  it('is shed when the boss heals out of combat — a fresh body is a fresh Defence', () => {
    const { npcs, npc } = bossZone()
    const hammer = makePlayer('1', 10, 11, 'dragon_warhammer')
    const tick = specOnce(hammer, npcs, 0)
    expect(npc.defenceDrain?.defence).toBeLessThan(BASE_DEFENCE)

    // The player leaves: the npc holds its quarry, then gives up and heals.
    hammer.combat = null
    npc.attackerId = null
    npc.lastCombatTick = tick
    for (let t = tick; t < tick + 40; t++) tickNpc(npc, ctx(t, npcs), { events: [], npcChanged: [], npcRemoved: [] } as never)
    expect(npc.defenceDrain).toBeNull()

    const next = makePlayer('2', 10, 11, 'dragon_warhammer')
    npc.state = 'idle'
    npc.hp = 100000
    specOnce(next, npcs, tick + 60)
    expect(sessionDefence(next)).toBe(BASE_DEFENCE - Math.floor(BASE_DEFENCE * 0.3))
  })
})
