import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  addCoopMember,
  createCoopMember,
  createCoopRaidState,
  processCoopTick,
} from '../src/engine/coopBossEngine.js'
import { raidTotalHitpoints } from '../src/engine/coopRaidEngine.js'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'
import prayersData from '../src/data/prayers.json'
import spellsData from '../src/data/spells.json'
import { validateCoopAction } from '../functions/_lib/game/coopIntent.js'

const RAID = 'sunspire_colosseum'
const deps = { itemsData, monstersData, prayersData, spellsData }

function savePayload() {
  return {
    stats: Object.fromEntries(['attack','strength','defence','hitpoints','ranged','magic','prayer'].map(k => [k, { xp: 13_034_431 }])),
    equipment: { weapon: { itemId: 'krylth_spear', quantity: 1 } },
    inventory: [{ itemId: 'shark', quantity: 20 }, null, null],
    settings: { combatStance: 'aggressive' },
  }
}

function member(id: number, now = 1_000) {
  const m: any = createCoopMember({ characterId: id, username: `p${id}`, savePayload: savePayload(), itemsData, now })
  m.sunspireObtainedIds = []
  m.ready = true
  return m
}

function party(ids = [7], host = ids[0]) {
  let state: any = createCoopRaidState(RAID, monstersData, { hostCharacterId: host, now: 1_000, hardMode: true })!
  for (const [i, id] of ids.entries()) state = addCoopMember(state, member(id, 1_000 + i))
  for (const m of Object.values(state.members) as any[]) m.ready = true
  return state
}

function intent(characterId: number, action: any) {
  return { tick_number: 1, characterId, characterSeq: 1, action }
}

function tick(state: any, intents: any[] = []) {
  return processCoopTick(state, intents, deps, 2_000)
}

function start(state: any, host = 7) {
  return tick(state, [intent(host, { type: 'start_raid' })]).stateNext
}

function forceWaveClear(state: any) {
  state.boss.currentHP = 0
  if (state.boss.encounter) state.boss.encounter.primaryDefeated = true
  state.boss.adds = []
  return tick(state)
}

afterEach(() => vi.restoreAllMocks())

describe('Sunspire co-op shared wave state', () => {
  it('starts as a wave raid and ignores ordinary hard mode', () => {
    const state: any = start(party())
    expect(state.phase).toBe('active')
    expect(state.hardMode).toBe(false)
    expect(state.raid.currentWaveIndex).toBe(0)
    expect(state.raid.waves).toHaveLength(12)
    expect(state.boss.encounter?.finite).toBe(true)
    expect(state.boss.adds.length).toBeGreaterThan(1)
    expect(new Set(state.boss.adds.map((a: any) => a.instanceId)).size).toBe(state.boss.adds.length)
  })

  it('does not advance when the primary is dead but an encounter enemy survives', () => {
    const state: any = start(party())
    state.boss.currentHP = 0
    state.boss.encounter.primaryDefeated = true
    expect(state.boss.adds.length).toBeGreaterThan(0)
    // Isolate encounter completion from the companions' legitimate incoming
    // damage: this assertion is about target survival, not survivability.
    state.members['7'].hp = 9999
    state.members['7'].maxHP = 9999
    for (const add of state.boss.adds) add.attackTimer = 99
    const out = tick(state)
    expect(out.stateNext.phase).toBe('active')
    expect(out.stateNext.raid.currentWaveIndex).toBe(0)
    expect(out.kill).toBeNull()
  })

  it('moves the whole party to one shared decision state after the final enemy dies', () => {
    const state: any = start(party([7, 8]))
    state.members['7'].damage = 10_000
    state.members['8'].damage = 10_000
    const out = forceWaveClear(state)
    expect(out.kill).toBeNull()
    expect(out.stateNext.phase).toBe('decision')
    expect(out.stateNext.raid.currentWaveIndex).toBe(0)
    expect(out.stateNext.raid.modifierOffers).toHaveLength(3)
    expect(out.stateNext.members['7'].sunspireChest.length).toBeGreaterThan(0)
    expect(out.stateNext.members['8'].sunspireChest.length).toBeGreaterThan(0)
  })

  it('only the host can choose one of the shared modifier offers and advance everyone', () => {
    let state: any = start(party([7, 8]))
    state.members['7'].damage = 10_000
    state.members['8'].damage = 10_000
    state = forceWaveClear(state).stateNext
    const chosen = state.raid.modifierOffers[0]

    const refused = tick(state, [intent(8, { type: 'sunspire_choose_modifier', modifierId: chosen })])
    expect(refused.stateNext.phase).toBe('decision')
    expect(refused.events.some((e: any) => e.type === 'actionRefused' && e.reason === 'not_host')).toBe(true)

    const advanced = tick(refused.stateNext, [intent(7, { type: 'sunspire_choose_modifier', modifierId: chosen })])
    expect(advanced.stateNext.phase).toBe('active')
    expect(advanced.stateNext.raid.currentWaveIndex).toBe(1)
    expect(advanced.stateNext.raid.modifierState[chosen]).toBe(1)
    expect(advanced.stateNext.members['7'].sunspireChest.length).toBeGreaterThan(0)
  })

  it('creates one server settlement record for a party cash-out and returns the party to its lobby', () => {
    let state: any = start(party([7, 8]))
    state.members['7'].damage = 10_000
    state.members['8'].damage = 10_000
    state = forceWaveClear(state).stateNext
    const chest7 = state.members['7'].sunspireChest
    const chest8 = state.members['8'].sunspireChest

    const out = tick(state, [intent(7, { type: 'sunspire_claim' })])
    expect(out.kill?.sunspireClaim).toBe(true)
    expect(out.kill?.sunspireFullClear).toBe(false)
    expect(out.kill?.sunspireRewardsByCharacter['7']).toEqual(chest7)
    expect(out.kill?.sunspireRewardsByCharacter['8']).toEqual(chest8)
    expect(out.stateNext.phase).toBe('lobby')
  })

  it('forfeits every unclaimed member chest on a wipe', () => {
    let state: any = start(party([7]))
    state.members['7'].damage = 10_000
    state = forceWaveClear(state).stateNext
    expect(state.members['7'].sunspireChest.length).toBeGreaterThan(0)

    const chosen = state.raid.modifierOffers[0]
    state = tick(state, [intent(7, { type: 'sunspire_choose_modifier', modifierId: chosen })]).stateNext
    state.members['7'].status = 'dead'
    state.members['7'].hp = 0
    const wiped = tick(state).stateNext
    expect(wiped.phase).toBe('lobby')
    expect(wiped.members['7'].sunspireChest).toEqual([])
  })

  it('uses the full authored health of all initial enemies and reinforcements for contribution accounting', () => {
    const state: any = party()
    expect(state.raid.maxHP).toBe(raidTotalHitpoints(RAID, monstersData))
    expect(state.raid.maxHP).toBeGreaterThan(monstersData.aurelios_the_unbroken.hitpoints)
  })

  it('validates bounded combat reactions at the API edge', () => {
    expect(validateCoopAction({ type: 'combat_reaction', reaction: { attackId: 'afterburn', type: 'guard' } })).toEqual({
      action: { type: 'combat_reaction', reaction: { attackId: 'afterburn', type: 'guard' } },
    })
    expect(validateCoopAction({ type: 'combat_reaction', reaction: { attackId: 'x', type: 'parry', slot: 'inventory' } })).toEqual({
      error: 'invalid_reaction',
    })
  })

  it('applies a reacted Sunspire hazard to the telegraphed member on the server', () => {
    let state: any = start(party([7]))
    state.members['7'].hp = 100
    state.members['7'].maxHP = 100
    state.members['7'].combat.playerAttackTimer = 99
    state.members['7'].combat.monsterAttackTimer = 99
    for (const add of state.boss.adds) add.attackTimer = 99
    state.boss.sunspireHazards = {
      tick: 0,
      afterburnNext: null,
      sunburstNext: null,
      totemNext: null,
      cinderfallEvery: 0,
      cinderfallCount: 0,
      pending: [{
        hazardId: 'afterburn',
        label: 'Afterburn',
        responseType: 'guard',
        baseDamage: 20,
        protectionStyle: null,
        openedAtTick: 0,
        resolveAtTick: 1,
        reaction: null,
        resolved: false,
      }],
      definitions: {},
    }
    const out = tick(state, [intent(7, { type: 'combat_reaction', reaction: { attackId: 'afterburn', type: 'guard' } })])
    const hazard = out.events.find((e: any) => e.type === 'sunspireHazard' && e.characterId === 7)
    expect(hazard?.success).toBe(true)
    expect(hazard?.damage).toBe(5)
    expect(out.stateNext.members['7'].hp).toBe(95)
  })

})
