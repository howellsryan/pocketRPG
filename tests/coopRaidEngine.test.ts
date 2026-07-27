import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  addCoopMember,
  coopLootBasisHP,
  coopLootDamageRequired,
  createCoopMember,
  createCoopRaidState,
  lootEligibleCharacterIds,
  processCoopTick,
  removeCoopMember,
} from '../src/engine/coopBossEngine.js'
import {
  COOP_RAID_ADVANCE_TICKS,
  COOP_RAID_IDS,
  isCoopHost,
  isCoopRaidId,
  nextHostCharacterId,
  raidBossOrder,
  raidProgress,
  raidTotalHitpoints,
} from '../src/engine/coopRaidEngine.js'
import { lobbyMember, projectStateForMember } from '../functions/_lib/game/coopProjection.js'
import { killRewardSource } from '../functions/_lib/game/coopBoss.js'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'
import raidsData from '../src/data/raids.json'
import prayersData from '../src/data/prayers.json'
import spellsData from '../src/data/spells.json'

const RAID = 'cryptbound_champions'
const deps = { itemsData, monstersData, prayersData, spellsData }

function savePayload(overrides: Record<string, unknown> = {}) {
  return {
    stats: {
      attack: { xp: 13_034_431 },
      strength: { xp: 13_034_431 },
      defence: { xp: 13_034_431 },
      hitpoints: { xp: 13_034_431 },
      ranged: { xp: 13_034_431 },
      magic: { xp: 13_034_431 },
      prayer: { xp: 13_034_431 },
    },
    equipment: { weapon: { itemId: 'krylth_spear', quantity: 1 } },
    inventory: [{ itemId: 'shark', quantity: 5 }, null, null],
    settings: { combatStance: 'aggressive' },
    ...overrides,
  }
}

function party(ids: number[], hostId = ids[0]) {
  let state: any = createCoopRaidState(RAID, monstersData, { hostCharacterId: hostId, now: 1_000 })!
  for (const [i, id] of ids.entries()) {
    state = addCoopMember(
      state,
      createCoopMember({
        characterId: id,
        username: `player${id}`,
        savePayload: savePayload(),
        itemsData,
        now: 1_000 + i,
      }),
    )
  }
  return state
}

function tick(state: any, intents: any[] = []) {
  return processCoopTick(state, intents, deps, Date.now())
}

function startIntent(characterId: number) {
  return { tick_number: 1, characterId, characterSeq: 1, action: { type: 'start_raid' } }
}

/** Empties the boss in front of the party, so the next tick resolves the death
 * without having to land real hits through its defence. The co-op engine reads
 * the kill off the shared HP record, which is exactly what this sets. */
function killBoss(state: any) {
  state.boss.currentHP = 0
  return state
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('coopRaidEngine — raid catalogue', () => {
  it('offers each raid exactly once despite the legacy_id aliases', () => {
    // raids.json keys every raid twice; a party list built from Object.keys
    // would advertise the same run as two different raids.
    expect(COOP_RAID_IDS).toEqual(['vaults_of_xyren', 'crimson_night_theatre', 'cryptbound_champions', 'tomb_of_arasmus'])
    expect(isCoopRaidId('barrows_brothers')).toBe(false)
    expect(isCoopRaidId(RAID)).toBe(true)
  })

  it('totals every boss in the run, not just the last one', () => {
    const total = raidTotalHitpoints(RAID, monstersData)
    const biggest = Math.max(...raidBossOrder(RAID).map((id) => monstersData[id].hitpoints))
    expect(total).toBeGreaterThan(biggest)
  })
})

describe('coopRaidEngine — the lobby', () => {
  it('starts in a lobby with the opener as host', () => {
    const state = party([7, 8])
    expect(state.phase).toBe('lobby')
    expect(state.hostCharacterId).toBe(7)
    expect(isCoopHost(state, 7)).toBe(true)
    expect(isCoopHost(state, 8)).toBe(false)
  })

  it('runs no combat while the party waits', () => {
    const before = party([7])
    const hpBefore = before.boss.currentHP
    const { stateNext, events } = tick(before)
    expect(stateNext.boss.currentHP).toBe(hpBefore)
    expect(stateNext.members['7'].hp).toBe(before.members['7'].hp)
    expect(events.some((e: any) => e.type === 'playerHit' || e.type === 'monsterHit')).toBe(false)
  })

  it('lets the party eat and gear up while it waits', () => {
    const state = party([7])
    state.members['7'].hp = 10
    const { stateNext } = tick(state, [
      { tick_number: 1, characterId: 7, characterSeq: 1, action: { type: 'eat', inventorySlot: 0 } },
    ])
    expect(stateNext.members['7'].hp).toBeGreaterThan(10)
  })

  it('walks consumable cooldowns down so one bite does not block the whole lobby', () => {
    let state = party([7])
    state.members['7'].hp = 10
    state = tick(state, [
      { tick_number: 1, characterId: 7, characterSeq: 1, action: { type: 'eat', inventorySlot: 0 } },
    ]).stateNext
    const after = state.members['7'].combat.eatCooldown
    state = tick(state).stateNext
    expect(state.members['7'].combat.eatCooldown).toBe(after - 1)
  })

  it('only the host can start the raid', () => {
    const state = party([7, 8])
    const { stateNext, events } = tick(state, [startIntent(8)])
    expect(stateNext.phase).toBe('lobby')
    expect(events.find((e: any) => e.type === 'actionRefused')?.reason).toBe('not_host')
  })

  it('the host starting puts the first boss on the field', () => {
    const state = party([7, 8])
    const { stateNext, events } = tick(state, [startIntent(7)])
    expect(stateNext.phase).toBe('active')
    expect(stateNext.bossId).toBe(raidBossOrder(RAID)[0])
    expect(stateNext.raid.currentBossIndex).toBe(0)
    expect(events.some((e: any) => e.type === 'raidStarted')).toBe(true)
  })

  it('refuses a start once the run is already going', () => {
    const started = tick(party([7]), [startIntent(7)]).stateNext
    const { events } = tick(started, [startIntent(7)])
    expect(events.find((e: any) => e.type === 'actionRefused')?.reason).toBe('raid_in_progress')
  })

  it('promotes the earliest-joined member when the host leaves', () => {
    const state = party([7, 8, 9])
    expect(nextHostCharacterId(state, 7)).toBe(8)
    const without = removeCoopMember(state, 7)
    expect(without.hostCharacterId).toBe(8)
  })

  it('leaves the host alone when somebody else leaves', () => {
    const without = removeCoopMember(party([7, 8]), 8)
    expect(without.hostCharacterId).toBe(7)
  })
})

describe('coopRaidEngine — the run', () => {
  it('pays nothing for an intermediate boss and waits before the next one', () => {
    let state = tick(party([7]), [startIntent(7)]).stateNext
    state = killBoss(state)
    const { stateNext, kill, events } = tick(state)
    expect(kill).toBeNull()
    expect(events.some((e: any) => e.type === 'raidBossDefeated')).toBe(true)
    expect(stateNext.boss.respawnCountdown).toBe(COOP_RAID_ADVANCE_TICKS)
    expect(stateNext.raid.currentBossIndex).toBe(0)
  })

  it('advances to the next boss when the wait runs out', () => {
    let state = tick(party([7]), [startIntent(7)]).stateNext
    state = tick(killBoss(state)).stateNext
    for (let i = 0; i < COOP_RAID_ADVANCE_TICKS; i++) state = tick(state).stateNext
    expect(state.raid.currentBossIndex).toBe(1)
    expect(state.bossId).toBe(raidBossOrder(RAID)[1])
    expect(state.boss.currentHP).toBe(state.boss.maxHP)
  })

  it('carries a member damage across bosses — the gate measures the whole raid', () => {
    let state = tick(party([7]), [startIntent(7)]).stateNext
    state.members['7'].damage = 400
    state = tick(killBoss(state)).stateNext
    for (let i = 0; i < COOP_RAID_ADVANCE_TICKS; i++) state = tick(state).stateNext
    expect(state.raid.currentBossIndex).toBe(1)
    expect(state.members['7'].damage).toBe(400)
  })

  it('measures the loot gate against the whole run, not the boss in front of you', () => {
    const state = tick(party([7]), [startIntent(7)]).stateNext
    expect(coopLootBasisHP(state)).toBe(raidTotalHitpoints(RAID, monstersData))
    expect(coopLootBasisHP(state)).toBeGreaterThan(state.boss.maxHP)
  })

  it('reports the position in the run for the fight HUD', () => {
    const state = tick(party([7]), [startIntent(7)]).stateNext
    const progress = raidProgress(state, monstersData)!
    expect(progress.position).toBe(1)
    expect(progress.total).toBe(raidBossOrder(RAID).length)
    expect(progress.isFinalBoss).toBe(false)
    expect(progress.nextBossName).toBe(monstersData[raidBossOrder(RAID)[1]].name)
  })
})

describe('coopRaidEngine — settling the run', () => {
  /** Fast-forwards a started party to its final boss, one advance at a time. */
  function toFinalBoss(state: any) {
    const bosses = raidBossOrder(RAID)
    let current = state
    for (let i = 0; i < bosses.length - 1; i++) {
      current = tick(killBoss(current)).stateNext
      for (let t = 0; t < COOP_RAID_ADVANCE_TICKS; t++) current = tick(current).stateNext
    }
    return current
  }

  it('settles once, as a raid, when the last boss falls', () => {
    let state = tick(party([7, 8]), [startIntent(7)]).stateNext
    state = toFinalBoss(state)
    expect(state.raid.currentBossIndex).toBe(raidBossOrder(RAID).length - 1)

    state.members['7'].damage = coopLootDamageRequired(coopLootBasisHP(state))
    state.members['8'].damage = 1
    const { stateNext, kill, events } = tick(killBoss(state))

    expect(kill).not.toBeNull()
    expect(kill!.sourceType).toBe('raids')
    expect(kill!.raidId).toBe(RAID)
    // Only the member past 10% of the RUN's hitpoints is paid.
    expect(kill!.lootCharacterIds).toEqual([7])
    expect(events.some((e: any) => e.type === 'raidComplete')).toBe(true)
    expect(stateNext.phase).toBe('lobby')
    expect(stateNext.raid.completions).toBe(1)
  })

  it('rolls the raid table, not the final boss table', () => {
    const source = killRewardSource({ id: 1, boss_id: 'gorath_the_infested', raid_id: RAID }, {
      sourceType: 'raids',
      raidId: RAID,
    })
    expect(source).toEqual({ sourceType: 'raids', sourceId: RAID })
    expect(Object.keys(raidsData[RAID].rewards)).toContain('always')
  })

  it('a boss room still settles as a monster kill', () => {
    expect(killRewardSource({ id: 1, boss_id: 'corporeal_horror', raid_id: null }, { bossId: 'corporeal_horror' }))
      .toEqual({ sourceType: 'monsters', sourceId: 'corporeal_horror' })
  })

  it('resets the run and clears damage when the party goes back to the lobby', () => {
    let state = tick(party([7]), [startIntent(7)]).stateNext
    state = toFinalBoss(state)
    state.members['7'].damage = 999
    const { stateNext } = tick(killBoss(state))
    expect(stateNext.phase).toBe('lobby')
    expect(stateNext.raid.currentBossIndex).toBe(0)
    expect(stateNext.bossId).toBe(raidBossOrder(RAID)[0])
    expect(stateNext.boss.currentHP).toBe(stateNext.boss.maxHP)
    expect(stateNext.members['7'].damage).toBe(0)
  })

  it('a wipe ends the run instead of leaving the party stuck on a live boss', () => {
    const state = tick(party([7, 8]), [startIntent(7)]).stateNext
    state.members['7'].hp = 0
    state.members['7'].status = 'dead'
    state.members['8'].hp = 0
    state.members['8'].status = 'dead'
    const { stateNext, events, kill } = tick(state)
    expect(kill).toBeNull()
    expect(events.some((e: any) => e.type === 'raidWiped')).toBe(true)
    expect(stateNext.phase).toBe('lobby')
    // Dead stays dead: a wipe must cost what dying solo costs, and reviving here
    // would also hide the death from the client that reverts one-life mode.
    expect(stateNext.members['7'].status).toBe('dead')
  })

  it('a dead member who earned their share is still paid', () => {
    let state = tick(party([7, 8]), [startIntent(7)]).stateNext
    state = toFinalBoss(state)
    state.members['7'].damage = coopLootDamageRequired(coopLootBasisHP(state))
    state.members['7'].status = 'dead'
    state.members['7'].hp = 0
    expect(lootEligibleCharacterIds(state)).toContain(7)
  })
})

describe('coopRaidEngine — what the lobby is allowed to show', () => {
  it('shows a party member their kit in the lobby', () => {
    const state = party([7, 8])
    const projected = projectStateForMember(state, 7)!
    expect(projected.phase).toBe('lobby')
    expect(projected.hostCharacterId).toBe(7)
    expect(projected.members['8'].equipment.weapon.itemId).toBe('krylth_spear')
    expect(projected.members['8'].inventory[0].itemId).toBe('shark')
    expect(projected.members['8'].levels.attack).toBe(99)
  })

  it('stops showing it the moment the raid starts', () => {
    const started = tick(party([7, 8]), [startIntent(7)]).stateNext
    const projected = projectStateForMember(started, 7)!
    expect(projected.phase).toBe('active')
    expect(projected.members['8'].equipment).toBeUndefined()
    expect(projected.members['8'].inventory).toBeUndefined()
    // Own record is always whole.
    expect(projected.members['7'].inventory[0].itemId).toBe('shark')
  })

  it('never exposes a lobby member quest list or slayer task', () => {
    const projected = lobbyMember(party([7]).members['7'])
    expect(projected.completedQuests).toBeUndefined()
    expect(projected.slayerTask).toBeUndefined()
  })
})
