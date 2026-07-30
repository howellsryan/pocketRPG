// A boss now keeps its quarry across a disengage (npc.ts reselectAttacker) and
// chases them the full pursuit leash (bossPursuit.test.ts). None of that means
// anything if it can never land a blow once it catches up: swings are resolved
// inside a player's own combat session, and a disengaged player has none —
// without resumeBossAggro the boss would jog alongside its target forever,
// visibly hunting, hitting nothing.
import { describe, expect, it } from 'vitest'
import { tickNpc, npcsFromZone, reselectAttacker, type NpcState } from '../server/npc'
import { tickPlayer, type TickContext, type TickPlayer } from '../server/tick'
import { emptyInventory } from '../server/mining'
import { findPathAdjacent } from '../server/pathfind'

const COLLISION = Array.from({ length: 32 }, () => '.'.repeat(32))
const GRONDAR = 'warlord_grondar'
const BULL = 'pasture_bull'

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

describe('a pursuing boss can land a hit once it catches up', () => {
  it('opens a fresh combat session and hits the player it chased down', () => {
    const { npcs, npc } = npcAt(GRONDAR, 5, 20)
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
    // The resumed session is ACTIVE, not passive — the boss caught its quarry,
    // this is the real fight, not the "walked away" disengage.
    expect(player.combat?.passive).not.toBe(true)
  })

  it('never resumes on its own for an ordinary monster the player walked away from', () => {
    // The disengage rule (combat-flow.test.ts) holds for anything that isn't
    // boss family: a bull that happens to catch up to a player standing still
    // must not restart the fight unasked.
    const { npcs, npc } = npcAt(BULL, 5, 6)
    npc.state = 'combat'
    npc.attackerId = '1'
    npc.lastCombatTick = 0
    const player = makePlayer({ x: 5, z: 5 })

    for (let t = 1; t <= 20; t++) tick(npcs, player, t)

    expect(player.combat).toBeNull()
  })
})
