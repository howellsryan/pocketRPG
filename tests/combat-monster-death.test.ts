// Locks the engine half of the kill → loot-modal trigger.
//
// CombatScreen.jsx opens the loot modal inside its `monsterDeath` event
// handler (src/screens/CombatScreen.jsx). If the engine ever stops emitting
// that event, or stops attaching `monster` + `loot` to it, the modal silently
// stops appearing on kill — exactly the regression PR #380 caused indirectly
// via a broken import in the same handler.
//
// We can't unit-test the JSX modal under the project's no-UI-test rule, but
// we can pin the engine contract the modal depends on.

import { describe, expect, it } from 'vitest'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'

const itemsData: any = {
  bronze_dagger: {
    id: 'bronze_dagger', slot: 'weapon', attackStyle: 'stab', attackSpeed: 4,
    attackBonus: { stab: 100, slash: 0, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 100 },
  },
  goblin_mail: { id: 'goblin_mail' },
  bones: { id: 'bones' },
}

function buildLowHpMonster(overrides: any = {}) {
  return {
    id: 'training_dummy',
    name: 'Training Dummy',
    hitpoints: 1,
    combatLevel: 1,
    attackSpeed: 99, // never gets to attack first
    attackStyle: 'crush',
    stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
    attackBonus: 0,
    strengthBonus: 0,
    defenceBonus: { stab: -50, slash: -50, crush: -50, magic: 0, ranged: 0 },
    drops: [
      { itemId: 'bones', chance: 1.0, quantity: 1 }, // always drop
      { itemId: 'goblin_mail', chance: 1.0, quantity: 1 },
    ],
    ...overrides,
  }
}

const maxedStats = {
  attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, currentHP: 99,
}

const equipment: any = { weapon: { itemId: 'bronze_dagger' } }

function tickUntilKill(state: any, maxTicks = 50) {
  let cur = state
  const allEvents: any[] = []
  for (let i = 0; i < maxTicks; i++) {
    const { combatState, events } = processCombatTick(cur, maxedStats, equipment, itemsData)
    allEvents.push(...events)
    cur = combatState
    if (events.some(e => e.type === 'monsterDeath')) break
    if (!cur.active) break
  }
  return { finalState: cur, events: allEvents }
}

describe('processCombatTick — monsterDeath event (loot modal trigger)', () => {
  it('emits a monsterDeath event with monster + loot when the player kills the monster', () => {
    const state = createCombatState(buildLowHpMonster(), 'melee', 'aggressive')
    const { finalState, events } = tickUntilKill(state)

    const deathEvent = events.find(e => e.type === 'monsterDeath')
    expect(deathEvent, 'engine must emit a monsterDeath event on kill').toBeDefined()

    // CombatScreen reads ev.monster.id, ev.monster.name, ev.monster.boss and
    // ev.loot. If any of these go missing, the loot modal breaks.
    expect(deathEvent.monster).toBeDefined()
    expect(deathEvent.monster.id).toBe('training_dummy')
    expect(deathEvent.monster.name).toBe('Training Dummy')
    expect(deathEvent.monster.boss).toBe(false)
    expect(Array.isArray(deathEvent.loot)).toBe(true)

    // Sanity: combat is no longer active and loot is mirrored on state.
    expect(finalState.active).toBe(false)
    expect(Array.isArray(finalState.loot)).toBe(true)
  })

  it('populates loot from the monster drop table on the death event', () => {
    const state = createCombatState(buildLowHpMonster(), 'melee', 'aggressive')
    const { events } = tickUntilKill(state)

    const deathEvent = events.find(e => e.type === 'monsterDeath')
    expect(deathEvent).toBeDefined()
    // Both drops have chance: 1.0 → both must appear.
    const ids = (deathEvent.loot as Array<{ itemId: string }>).map(d => d.itemId).sort()
    expect(ids).toEqual(['bones', 'goblin_mail'])
  })

  it('flags boss kills via monster.boss so the modal can show the boss header', () => {
    const boss = buildLowHpMonster({ id: 'mini_boss', name: 'Mini Boss', boss: true })
    const state = createCombatState(boss, 'melee', 'aggressive')
    const { events } = tickUntilKill(state)

    const deathEvent = events.find(e => e.type === 'monsterDeath')
    expect(deathEvent).toBeDefined()
    expect(deathEvent.monster.boss).toBe(true)
  })

  it('emits monsterDeath with an empty loot array when the drop table is empty', () => {
    const state = createCombatState(buildLowHpMonster({ drops: [] }), 'melee', 'aggressive')
    const { events } = tickUntilKill(state)

    const deathEvent = events.find(e => e.type === 'monsterDeath')
    expect(deathEvent).toBeDefined()
    // The "No loot dropped" branch in CombatScreen relies on this being an
    // empty array, not undefined.
    expect(deathEvent.loot).toEqual([])
  })
})
