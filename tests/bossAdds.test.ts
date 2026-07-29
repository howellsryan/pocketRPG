// The boss-add engine: a boss spawns a second live monster that fights
// alongside it until killed. Everything here runs on a synthetic boss/add pair
// with made-up ids, which is the point — the mechanic is driven entirely by
// `spawnsAdd` + `isAdd` in monsters.json, so a new boss needs data, not code.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCombatState, processCombatTick, setCombatTarget } from '../src/engine/combat.js'
import { isAddAlive, activeTarget, liveAdds, getAddSpec, prepareAdd, rollFirstSpawnDelay, rollRespawnDelay } from '../src/engine/bossAdds.js'
import { splatsFromCombatEvents } from '../src/utils/hitSplats.js'
import monsters from '../src/data/monsters.json'

const monstersData = monsters as Record<string, any>

const maxedStats = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, currentHP: 99 }
const SWORD = {
  id: 'test_sword', slot: 'weapon', attackStyle: 'stab', attackSpeed: 4,
  attackBonus: { stab: 200, slash: 0, crush: 0, magic: 0, ranged: 0 },
  defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
  otherBonus: { meleeStrength: 150 },
}
const itemsData: any = { test_sword: SWORD }

function resistedTarget(overrides: any = {}) {
  return {
    id: 'plain_dummy', name: 'Plain Dummy', hitpoints: 100000, combatLevel: 500,
    attackSpeed: 99, attackStyle: 'crush',
    stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
    attackBonus: 0, strengthBonus: 0,
    defenceBonus: { stab: -200, slash: -200, crush: -200, magic: 0, ranged: 0 },
    drops: [], noSeedDrops: true, noCharmDrops: true,
    ...overrides,
  }
}

afterEach(() => { vi.restoreAllMocks() })

const BOSS_WITH_ADD: any = {
  id: 'add_boss', name: 'Add Boss', hitpoints: 4000, combatLevel: 500,
  attackSpeed: 4, attackStyle: 'crush', maxHit: 30,
  stats: { attack: 400, strength: 400, defence: 1, magic: 1, ranged: 1 },
  attackBonus: 5000, strengthBonus: 200,
  defenceBonus: { stab: -200, slash: -200, crush: -200, magic: -200, ranged: -200 },
  drops: [{ itemId: 'coins', quantity: 5, chance: 1 }],
  noSeedDrops: true, noCharmDrops: true,
  spawnsAdd: { monsterId: 'test_add', firstSpawnAfterAttacks: 1, respawnAfterAttacks: 2 },
}
const ADD_DEF: any = {
  id: 'test_add', name: 'Test Add', hitpoints: 40, combatLevel: 100,
  attackSpeed: 2, attackStyle: 'magic', maxHit: 12, prayerDrainPerHit: 8,
  stats: { attack: 300, strength: 100, defence: 1, magic: 300, ranged: 1 },
  attackBonus: 5000, strengthBonus: 100,
  defenceBonus: { stab: -200, slash: -200, crush: -200, magic: -200, ranged: -200 },
  drops: [], noSeedDrops: true, noCharmDrops: true, isAdd: true,
}
const monstersWithAdd: any = { add_boss: BOSS_WITH_ADD, test_add: ADD_DEF }

function runTicks(state: any, ticks: number, opts: any = {}) {
  const equipment: any = { weapon: { itemId: 'test_sword' } }
  const events: any[] = []
  for (let i = 0; i < ticks; i++) {
    if (opts.targetAdd !== undefined) state = setCombatTarget(state, opts.targetAdd && isAddAlive(state) ? 'add' : 'boss')
    const out = processCombatTick(state, { ...maxedStats, currentHP: 100000 }, equipment, itemsData)
    state = out.combatState
    events.push(...out.events)
    if (!state.active) break
  }
  return { state, events }
}

describe('Dread Core — spawning', () => {
  it('spawns as a live second monster with its own hitpoints', () => {
    const state = createCombatState(BOSS_WITH_ADD, 'melee', 'aggressive', null, monstersWithAdd)
    expect(liveAdds(state)).toHaveLength(0)
    const out = runTicks(state, 30)
    const spawned = out.events.filter((e: any) => e.type === 'addSpawned')
    expect(spawned.length).toBeGreaterThan(0)
    expect(spawned[0].monsterName).toBe('Test Add')
    expect(spawned[0].hitpoints).toBe(40)
  })

  it('does not arm an add for a boss that has no spawnsAdd', () => {
    const plain = createCombatState(resistedTarget(), 'melee', 'aggressive', null, monstersWithAdd)
    expect(plain.addDefinition).toBeNull()
    expect(plain.addSpawnCountdown).toBeNull()
  })
})

describe('Dread Core — both enemies attack', () => {
  it('takes hits from the boss and the add in the same fight', () => {
    const state = createCombatState(BOSS_WITH_ADD, 'melee', 'aggressive', null, monstersWithAdd)
    const { events } = runTicks(state, 60)
    const hits = events.filter((e: any) => e.type === 'monsterHit' || e.type === 'monsterMiss')
    expect(hits.some((e: any) => e.fromAdd === true)).toBe(true)
    expect(hits.some((e: any) => !e.fromAdd)).toBe(true)
  })

  it('burns prayer through the add while the boss keeps swinging', () => {
    let state: any = createCombatState(BOSS_WITH_ADD, 'melee', 'aggressive', null, monstersWithAdd)
    state.prayerPoints = 400
    state.maxPrayerPoints = 400
    const { events, state: after } = runTicks(state, 60)
    expect(events.some((e: any) => e.type === 'prayerDrained')).toBe(true)
    expect(after.prayerPoints).toBeLessThan(400)
  })
})

describe('Dread Core — targeting', () => {
  it('sends the player\'s damage to whichever enemy is selected', () => {
    let state: any = createCombatState(BOSS_WITH_ADD, 'melee', 'aggressive', null, monstersWithAdd)
    state = runTicks(state, 20, { targetAdd: false }).state
    // Spawn happened; now hit the add only and watch its HP, not the boss's.
    if (!isAddAlive(state)) state = runTicks(state, 10, { targetAdd: false }).state
    expect(isAddAlive(state)).toBe(true)
    const bossHPBefore = state.monster.currentHP
    state = setCombatTarget(state, 'add')
    expect(activeTarget(state)).toBe(liveAdds(state)[0])
    const equipment: any = { weapon: { itemId: 'test_sword' } }
    const out = processCombatTick(state, { ...maxedStats, currentHP: 100000 }, equipment, itemsData)
    // The boss can only have lost HP to the player, and the player hit the add.
    expect(out.combatState.monster.currentHP).toBe(bossHPBefore)
  })

  it('falls back to the boss when the add is gone', () => {
    const state = createCombatState(BOSS_WITH_ADD, 'melee', 'aggressive', null, monstersWithAdd)
    const targeted = setCombatTarget(state, 'add')
    expect(targeted.addTargetIndex).toBeNull()
    expect(activeTarget(targeted)).toBe(state.monster)
  })
})

describe('Dread Core — killing it', () => {
  it('despawns without ending the fight, granting loot, or counting a kill', () => {
    let state: any = createCombatState(BOSS_WITH_ADD, 'melee', 'aggressive', null, monstersWithAdd)
    const { state: afterSpawn } = runTicks(state, 20, { targetAdd: false })
    state = afterSpawn
    const { state: afterKill, events } = runTicks(state, 40, { targetAdd: true })
    const defeated = events.filter((e: any) => e.type === 'addDefeated')
    expect(defeated.length).toBeGreaterThan(0)
    expect(events.some((e: any) => e.type === 'monsterDeath')).toBe(false)
    expect(afterKill.active).toBe(true)
    expect(afterKill.loot).toBeNull()
    expect(afterKill.addsDefeated).toBeGreaterThan(0)
  })

  it('sends in a replacement so the add cannot be cleared once and forgotten', () => {
    let state: any = createCombatState(BOSS_WITH_ADD, 'melee', 'aggressive', null, monstersWithAdd)
    const { events } = runTicks(state, 200, { targetAdd: true })
    expect(events.filter((e: any) => e.type === 'addSpawned').length).toBeGreaterThan(1)
  })

  it('takes the add off the field when the boss dies', () => {
    let state: any = createCombatState(BOSS_WITH_ADD, 'melee', 'aggressive', null, monstersWithAdd)
    state = runTicks(state, 20).state
    state.monster.currentHP = 1
    const { state: after, events } = runTicks(state, 20, { targetAdd: false })
    expect(events.some((e: any) => e.type === 'monsterDeath')).toBe(true)
    expect(after.active).toBe(false)
    expect(liveAdds(after)).toHaveLength(0)
  })
})

describe('boss adds are data-driven', () => {
  // The contract a future boss must satisfy to get an add: point spawnsAdd at a
  // real monster (one id, or one per style), flag that monster isAdd. Nothing
  // else — no engine change.
  it('every spawnsAdd points at real monsters flagged as adds', () => {
    for (const [id, m] of Object.entries(monstersData)) {
      const spec = getAddSpec(m)
      if (!spec) continue
      const addIds = spec.monsterIdByStyle ? Object.values(spec.monsterIdByStyle) : [spec.monsterId]
      expect(addIds.length, `${id} names no add`).toBeGreaterThan(0)
      for (const addId of addIds) {
        const add = monstersData[addId as string]
        expect(add, `${id} spawns unknown monster ${addId}`).toBeDefined()
        expect(add.isAdd, `${addId} must be flagged isAdd`).toBe(true)
        expect(add.hitpoints, `${addId} needs hitpoints`).toBeGreaterThan(0)
      }
    }
  })

  it('keeps adds out of drop tables — they exist only to be cleared', () => {
    for (const m of Object.values(monstersData)) {
      if (!m.isAdd) continue
      expect(m.drops, `${m.id} must not drop loot`).toEqual([])
    }
  })

  it('reads the spawn cadence from JSON rather than a constant', () => {
    const spec = getAddSpec({ spawnsAdd: { monsterId: 'x', firstSpawnAfterAttacks: 3, respawnAfterAttacks: [9, 9] } })!
    expect(rollFirstSpawnDelay(spec, () => 0)).toBe(3)
    expect(rollRespawnDelay(spec, () => 0.99)).toBe(9)
    // No spec at all still yields a usable default rather than throwing.
    expect(rollRespawnDelay(getAddSpec({ spawnsAdd: { monsterId: 'x' } })!, () => 0)).toBeGreaterThan(0)
  })

  it('prepares an add at full health with its own attack timer', () => {
    const add = prepareAdd({ id: 'a', name: 'A', hitpoints: 90, attackSpeed: 3 })!
    expect(add.currentHP).toBe(90)
    expect(add.attackTimer).toBe(3)
    expect(prepareAdd(null)).toBeNull()
  })
})

describe('hit splats follow the target', () => {
  // The bug this pins: damage dealt to the add was splatting over the boss's
  // HP bar, so a player attacking the add saw numbers on the wrong monster.
  it('routes damage dealt to the add away from the boss bar', () => {
    const { monster, add, player } = splatsFromCombatEvents([
      { type: 'playerHit', damage: 12, toAdd: true },
      { type: 'playerHit', damage: 30 },
      { type: 'specialHit', hits: [5, 7], toAdd: true },
      { type: 'monsterHit', damage: 9 },
    ])
    expect(add.map((s: any) => s.value)).toEqual([12, 5, 7])
    expect(monster.map((s: any) => s.value)).toEqual([30])
    expect(player.map((s: any) => s.value)).toEqual([9])
  })

  it('always splats a summon on the boss, never the add', () => {
    const { monster, add } = splatsFromCombatEvents([{ type: 'summonHit', damage: 14 }])
    expect(monster).toHaveLength(1)
    expect(add).toHaveLength(0)
  })

  it('tags the engine\'s own events so the routing above has something to read', () => {
    let state: any = createCombatState(BOSS_WITH_ADD, 'melee', 'aggressive', null, monstersWithAdd)
    state = runTicks(state, 30, { targetAdd: false }).state
    expect(isAddAlive(state)).toBe(true)
    // Swing at the add until it dies. Only the hits landed before it dropped
    // belong to it — after that the picker falls back to the boss.
    const { events } = runTicks(state, 40, { targetAdd: true })
    const killedAt = events.findIndex((e: any) => e.type === 'addDefeated')
    expect(killedAt).toBeGreaterThan(-1)
    const hits = events.slice(0, killedAt).filter((e: any) => e.type === 'playerHit')
    expect(hits.length).toBeGreaterThan(0)
    for (const h of hits) expect(h.toAdd).toBe(true)
  })

  it('never tags a hit for the add while the player is attacking the boss', () => {
    let state: any = createCombatState(BOSS_WITH_ADD, 'melee', 'aggressive', null, monstersWithAdd)
    const { events } = runTicks(state, 60, { targetAdd: false })
    const hits = events.filter((e: any) => e.type === 'playerHit')
    expect(hits.length).toBeGreaterThan(0)
    // The add spawns during this run, so this proves the flag tracks the
    // player's target and not merely whether an add exists.
    expect(events.some((e: any) => e.type === 'addSpawned')).toBe(true)
    for (const h of hits) expect(h.toAdd).toBe(false)
  })
})
