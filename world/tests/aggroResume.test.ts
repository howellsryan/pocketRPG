// Any npc keeps its quarry across a disengage now (npc.ts reselectAttacker),
// trash and dragons included, not just bosses — chasing them the full pursuit
// leash (bossPursuit.test.ts covers the boss-specific extended leash). None of
// that means anything if the pursuer can never land a blow once it catches up:
// swings are resolved inside a player's own combat session, and a disengaged
// player has none — without resumeAggro every pursuer would jog alongside its
// target forever, visibly hunting, hitting nothing.
import { describe, expect, it } from 'vitest'
import { tickNpc, npcsFromZone, reselectAttacker, type NpcState } from '../server/npc'
import { tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'

const COLLISION = Array.from({ length: 32 }, () => '.'.repeat(32))
const GRONDAR = 'warlord_grondar'
const BULL = 'pasture_bull'
const DRAGON = 'green_dragon'

function makePlayer(overrides: Partial<TickPlayer> = {}): TickPlayer {
  return {
    charId: '1', name: 'WorldTester', x: 5, z: 5, path: [], anim: 'idle',
    stats: {
      attack: { xp: 100000, level: 40 }, strength: { xp: 100000, level: 40 },
      defence: { xp: 100000, level: 40 }, ranged: { xp: 0, level: 1 },
      magic: { xp: 0, level: 1 }, hitpoints: { xp: 1200000, level: 90 },
    },
    inventory: emptyInventory(), pendingXp: {}, minted: {}, mining: null, crafting: null, pendingInteract: null,
    hp: 500, maxHp: 500, equipment: {}, gear: {}, combat: null,
    running: false, runEnergy: 100, lastRunSent: 100, stance: 'accurate', spell: null,
    specialEnergy: 100, lastSpecSent: 100, lastSpecQueuedSent: false, pendingSpecial: false,
    prayerPoints: 1, maxPrayerPoints: 1, prayerDrainAccumulator: 0,
    activeProtectionPrayer: null, activeCombatPrayer: null, lastPrayerSent: null,
    activePotions: {}, following: null, followTargetTile: null,
    ...overrides,
  } as TickPlayer
}

function npcAt(monsterId: string, x: number, z: number) {
  const npcs = npcsFromZone([{ id: 'n1', monsterId, x, z, wander: { x, z, w: 1, h: 1 } }])
  return { npcs, npc: npcs.get('n1')! }
}

/** One DO-shaped tick: retarget (with the player standing still, engaged with
 * nothing — the state a disengage leaves behind), every npc, then the player. */
function tick(npcs: Map<string, NpcState>, player: TickPlayer, atTick: number): ReturnType<typeof tickPlayer> {
  const players = new Map([[player.charId, { x: player.x, z: player.z }]])
  const c: TickContext = {
    tick: atTick, rocks: new Map(), npcs, collision: COLLISION, players,
    pathAdjacent: (from, to) => findPathAdjacent(COLLISION, from, to),
  }
  reselectAttacker(npcs.get('n1')!, [], COLLISION, players, npcs)
  for (const npc of [...npcs.values()]) tickNpc(npc, c, { npcChanged: [], npcRemoved: [] } as never)
  return tickPlayer(player, c)
}

describe.each([
  // Distance kept within each monster's own pursuit leash (npc.ts:
  // pursueLeashTiles — 24 for a boss, 10 for everything else) so the chase
  // actually closes the gap instead of breaking off short of the player.
  ['a boss', GRONDAR, 15],
  ['ordinary trash', BULL, 8],
  ['a dragon', DRAGON, 8],
])('a pursuing npc can land a hit once it catches up (%s)', (_label, monsterId, distance) => {
  it('opens a fresh combat session and hits the player it chased down', () => {
    const { npcs, npc } = npcAt(monsterId, 5, 5 + distance)
    npc.state = 'combat'
    npc.attackerId = '1'
    npc.lastCombatTick = 0
    const player = makePlayer({ x: 5, z: 5 })

    let hitLanded = false
    for (let t = 1; t <= 60 && !hitLanded; t++) {
      const result = tick(npcs, player, t)
      if (result.hits.some((h) => h.targetId === player.charId)) hitLanded = true
    }

    expect(hitLanded).toBe(true)
    // The resumed session is ACTIVE, not passive — the pursuer caught its
    // quarry, this is the real fight, not the "walked away" disengage.
    expect(player.combat?.passive).not.toBe(true)
  })
})

describe('resuming does not reopen unprovoked fights', () => {
  it('never starts a fight for an npc that never claimed this player (idle proximity)', () => {
    // No attackerId set — this is what actually gates resumeAggro, not monster
    // type. An idle bull standing next to a player must not start anything.
    const { npcs, npc } = npcAt(BULL, 5, 6)
    npc.state = 'idle'
    const player = makePlayer({ x: 5, z: 5 })

    for (let t = 1; t <= 10; t++) tick(npcs, player, t)

    expect(player.combat).toBeNull()
    expect(npc.attackerId).toBeNull()
  })

  it('never resumes for a claim held by a DIFFERENT player', () => {
    const { npcs, npc } = npcAt(BULL, 5, 5)
    npc.state = 'combat'
    npc.attackerId = 'someone-else'
    npc.lastCombatTick = 0
    const player = makePlayer({ x: 5, z: 6 })

    for (let t = 1; t <= 10; t++) tick(npcs, player, t)

    expect(player.combat).toBeNull()
  })
})
