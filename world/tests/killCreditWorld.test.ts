// Who a world kill counts for.
//
// It used to be one player: whoever dealt the most damage took the ground loot,
// and the kill count, slayer progress and daily tasks went with it. A second
// player could fight a dragon to the last hitpoint and leave with nothing on
// record. Co-op has always paid its loot on a 10% damage share, so the world now
// runs the same gate over the same shared funnel (src/engine/killCredit.js) —
// and it decides all four, not just the loot.
import { describe, expect, it, vi } from 'vitest'
import { npcsFromZone, recordDamage, type NpcState } from '../server/npc'
import { tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'
import { killCreditDamageRequired } from '../../src/engine/killCredit.js'
import monstersData from '../../src/data/monsters.json'

const COLLISION = Array.from({ length: 24 }, () => '.'.repeat(24))
// An ordinary monster, not a boss: this is about the grind, not a lair.
const MONSTER = 'green_dragon'
const MAX_HP = (monstersData as Record<string, { hitpoints: number }>)[MONSTER].hitpoints
// A slayer-gated monster, which is where the task-only drops live.
const TASK_MONSTER = 'nether_demon'
const TASK_MAX_HP = (monstersData as Record<string, { hitpoints: number }>)[TASK_MONSTER].hitpoints
const TASK_ONLY_IDS = new Set(['imbued_crown', 'imbued_brain'])

function makePlayer(charId: string, x: number, z: number): TickPlayer {
  return {
    charId, name: `p${charId}`, x, z, path: [], anim: 'idle',
    stats: {
      attack: { xp: 1000000, level: 80 }, strength: { xp: 1000000, level: 80 },
      defence: { xp: 1000000, level: 80 }, ranged: { xp: 0, level: 1 },
      magic: { xp: 0, level: 1 }, hitpoints: { xp: 1200000, level: 90 },
    },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null,
    hp: 90, maxHp: 90, combat: null, pendingInteract: null,
    equipment: {}, pendingEvents: [], specialEnergy: 100, prayerPoints: 0, maxPrayerPoints: 0,
  } as unknown as TickPlayer
}

function ctx(tick: number, npcs: Map<string, NpcState>, players: TickPlayer[]): TickContext {
  return {
    tick, rocks: new Map(), npcs, collision: COLLISION,
    players: new Map(players.map((p) => [p.charId, { x: p.x, z: p.z }])),
    pathAdjacent: (from, to) => findPathAdjacent(COLLISION, from, to),
  } as TickContext
}

/** Stands `killer` on the monster and lets them land the fatal blow, after the
 * given damage has already been booked against it by other players. */
function killWith(damageByChar: Record<string, number>, killerDamage: number, monsterId = MONSTER) {
  const npcs = npcsFromZone([{ id: 'm1', monsterId, x: 10, z: 10, wander: { x: 0, z: 0, w: 24, h: 24 } }])
  const npc = npcs.get('m1')!
  const killer = makePlayer('killer', 10, 11)
  for (const [charId, dmg] of Object.entries(damageByChar)) recordDamage(npc, charId, dmg, 1)
  if (killerDamage > 0) recordDamage(npc, 'killer', killerDamage, 2)

  killer.pendingInteract = { kind: 'npc', id: 'm1', action: 'attack' } as never
  for (let t = 3; t < 400; t++) {
    if (npc.state !== 'dead') npc.hp = 1
    killer.hp = killer.maxHp
    const result = tickPlayer(killer, ctx(t, npcs, [killer]))
    const kill = result.kills.find((k) => k.monsterId === monsterId)
    if (kill) return kill
  }
  throw new Error('the monster never died')
}

describe('a world kill credits everyone who earned it', () => {
  it('credits a second player who cleared the line but took no loot', () => {
    const line = killCreditDamageRequired(MAX_HP)
    const kill = killWith({ helper: line }, MAX_HP)

    // The pile is one physical object on one tile, so it still has one owner.
    expect(kill.owner).toBe('killer')
    // Credit is not: both fought it, both earned it.
    expect(kill.credited).toContain('helper')
    expect(kill.credited).toContain('killer')
  })

  it('credits nobody who fell short of the line, however long they were there', () => {
    const line = killCreditDamageRequired(MAX_HP)
    const kill = killWith({ tourist: line - 1 }, MAX_HP)

    expect(kill.credited).not.toContain('tourist')
    expect(kill.credited).toEqual(['killer'])
  })

  it('orders the credited list by damage, so the loot owner leads it', () => {
    const line = killCreditDamageRequired(MAX_HP)
    const kill = killWith({ helper: line * 2 }, line)

    expect(kill.credited[0]).toBe('helper')
    expect(kill.owner).toBe('helper')
  })

  // A solo player holds 100% of the damage, so the gate is invisible to them —
  // the overwhelmingly common case must not change.
  it('leaves a solo killer credited exactly as before', () => {
    const kill = killWith({}, MAX_HP)
    expect(kill.owner).toBe('killer')
    expect(kill.credited).toEqual(['killer'])
  })
})

// The engine rolls the death event's loot under the KILLER's slayer task and
// Grindman flag, so that pile belongs to the killer. Spawned under the
// top-damage player it paid them someone else's rates, and left the top-damage
// player unable to roll their own — rollLootForCredited skips the pile's owner.
describe('who the engine\'s own roll belongs to', () => {
  it('names the killer separately from the announced owner', () => {
    const line = killCreditDamageRequired(MAX_HP)
    const kill = killWith({ helper: line * 4 }, line)

    expect(kill.owner).toBe('helper')
    expect(kill.killer).toBe('killer')
  })

  it('gives that roll to a killer who earned it', () => {
    const kill = killWith({}, MAX_HP)
    expect(kill.killer).toBe('killer')
    expect(kill.loot.map((l) => l.itemId)).toContain('dragon_bones')
  })

  // Last-hitting a monster somebody else brought down is not a kill you earned.
  // A 150 HP monster puts the line at 15, which is past this player's max hit,
  // so the one blow they land cannot carry them over it.
  it('gives a last-hit sniper below the line nothing at all', () => {
    const kill = killWith({ grinder: TASK_MAX_HP }, 0, TASK_MONSTER)

    expect(kill.credited).toEqual(['grinder'])
    expect(kill.loot).toEqual([])
  })
})

// The engine only rolls a taskOnly drop when it is handed the player's task.
// The world passed null, so the killer was the one player who could never roll
// the drops their own slayer task exists to unlock — while a helper past the
// 10% line could, because their roll reads their own task (killLoot.ts).
describe('the killer fights on their own slayer task', () => {
  function rolledOnTask(task: { monsterId: string } | null): boolean {
    const npcs = npcsFromZone([{ id: 'm1', monsterId: TASK_MONSTER, x: 10, z: 10, wander: { x: 0, z: 0, w: 24, h: 24 } }])
    const npc = npcs.get('m1')!
    const killer = makePlayer('killer', 10, 11)
    ;(killer as unknown as { slayer: unknown }).slayer = { task }
    // The killer only gets a pile at all once they are past the credit line, so
    // let them earn it before hurrying the kill along.
    const line = killCreditDamageRequired(TASK_MAX_HP)
    let seen = false
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0)
    killer.pendingInteract = { kind: 'npc', id: 'm1', action: 'attack' } as never
    for (let t = 3; t < 400 && !seen; t++) {
      if (npc.state !== 'dead' && (npc.damageByChar.get('killer')?.dmg ?? 0) >= line) npc.hp = 1
      killer.hp = killer.maxHp
      const result = tickPlayer(killer, ctx(t, npcs, [killer]))
      const kill = result.kills.find((k) => k.monsterId === TASK_MONSTER)
      if (kill) {
        // Math.random pinned to 0 clears every chance gate, so a taskOnly drop
        // appears if and only if the engine was told the player is on task.
        seen = kill.loot.some((l) => TASK_ONLY_IDS.has(l.itemId))
        spy.mockRestore()
        return seen
      }
    }
    spy.mockRestore()
    throw new Error('the monster never died')
  }

  it('rolls its task-only drops for a killer who is on the task', () => {
    expect(rolledOnTask({ monsterId: TASK_MONSTER })).toBe(true)
  })

  it('rolls none of them for a killer who is not', () => {
    expect(rolledOnTask({ monsterId: 'blue_dragon' })).toBe(false)
    expect(rolledOnTask(null)).toBe(false)
  })
})
