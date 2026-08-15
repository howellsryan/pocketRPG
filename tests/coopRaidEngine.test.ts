import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  addCoopMember,
  COOP_RESPAWN_TICKS,
  coopKillOutcome,
  coopLootBasisHP,
  coopLootDamageRequired,
  createCoopBossState,
  createCoopMember,
  createCoopRaidState,
  creditSlayerKill,
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
  raidPartyReady,
  raidProgress,
  raidReadyCount,
  raidTotalHitpoints,
} from '../src/engine/coopRaidEngine.js'
import { lobbyMember, projectStateForMember } from '../functions/_lib/game/coopProjection.js'
import { killRewardSource } from '../functions/_lib/game/coopBoss.js'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'
import raidsData from '../src/data/raids.json'
import { RAID_TASK_META } from '../src/engine/slayerMasters.js'
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

/** A party in its lobby. Readied by default, since that is now the precondition
 * for starting at all — pass `{ ready: false }` to test the gate itself. */
function party(ids: number[], hostId = ids[0], { ready = true } = {}) {
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
  if (ready) for (const member of Object.values(state.members) as any[]) member.ready = true
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

  it('counts every phase of a phased boss, not the bar it opens on', () => {
    // Verzik hands out three health bars (2000 / 3250 / 2500). Counting only the
    // first charges the loot gate for a quarter of the fight she actually is.
    const raidId = 'crimson_night_theatre'
    const openingBars = raidBossOrder(raidId).reduce((sum, id) => sum + monstersData[id].hitpoints, 0)
    const verzik = monstersData.verzik_vitur
    const laterPhases = verzik.forms.phase2.phaseHP + verzik.forms.phase3.phaseHP
    expect(raidTotalHitpoints(raidId, monstersData)).toBe(openingBars + laterPhases)
  })

  it('counts a double-kill boss twice — the party removes its health twice', () => {
    const raidId = 'vaults_of_xyren'
    const openingBars = raidBossOrder(raidId).reduce((sum, id) => sum + monstersData[id].hitpoints, 0)
    expect(monstersData.the_great_olm.requiresDoubleKill).toBe(true)
    expect(raidTotalHitpoints(raidId, monstersData)).toBe(openingBars + monstersData.the_great_olm.hitpoints)
  })
})

describe('coopRaidEngine — readiness in the lobby', () => {
  const readyIntent = (characterId: number, value: boolean) =>
    ({ tick_number: 1, characterId, characterSeq: 1, action: { type: 'set_ready', value } })

  it('lets a member say they are ready, and take it back', () => {
    let state = tick(party([7, 8], 7, { ready: false }), [readyIntent(8, true)]).stateNext
    expect(state.members['8'].ready).toBe(true)
    state = tick(state, [readyIntent(8, false)]).stateNext
    expect(state.members['8'].ready).toBe(false)
  })

  it('counts readiness for the host without counting the host', () => {
    // Pressing Start is the host's answer, so counting them would leave the
    // button reading "1/2 ready" at the moment the host is all that is left.
    const state = tick(party([7, 8, 9], 7, { ready: false }), [readyIntent(8, true)]).stateNext
    expect(raidReadyCount(state)).toEqual({ ready: 1, total: 2 })
    expect(raidPartyReady(state)).toBe(false)
  })

  it('refuses to start while anyone is still getting set', () => {
    // The party sets off together: nobody is left mid-restock by a host who
    // pressed Start while they were still in the bank.
    const { stateNext, events } = tick(party([7, 8, 9], 7, { ready: false }), [startIntent(7)])
    expect(stateNext.phase).toBe('lobby')
    expect(events.find((e: any) => e.type === 'actionRefused')).toMatchObject({
      reason: 'party_not_ready', ready: 0, total: 2, characterId: 7,
    })
  })

  it('starts once the last of them says so', () => {
    let state = party([7, 8], 7, { ready: false })
    state = tick(state, [startIntent(7)]).stateNext
    expect(state.phase).toBe('lobby')
    state = tick(state, [readyIntent(8, true)]).stateNext
    state = tick(state, [startIntent(7)]).stateNext
    expect(state.phase).toBe('active')
  })

  it('lets a host with nobody to wait for set off alone', () => {
    const state = tick(party([7], 7, { ready: false }), [startIntent(7)]).stateNext
    expect(state.phase).toBe('active')
  })

  it('is not held up by a member who died on the last run', () => {
    // A wipe returns the party to its lobby with its casualties still in it,
    // they are never revived, and the intent path refuses actions from a dead
    // member — so counting them would strand the party behind somebody who
    // cannot answer.
    const state = party([7, 8], 7, { ready: false })
    state.members['8'].status = 'dead'
    state.members['8'].hp = 0
    expect(raidReadyCount(state)).toEqual({ ready: 0, total: 0 })
    expect(raidPartyReady(state)).toBe(true)
    expect(tick(state, [startIntent(7)]).stateNext.phase).toBe('active')
  })

  it('clears readiness when the run starts and again when the party comes back', () => {
    let state = tick(party([7, 8], 7, { ready: false }), [readyIntent(8, true)]).stateNext
    state = tick(state, [startIntent(7)]).stateNext
    expect(state.members['8'].ready).toBe(false)

    state.members['8'].ready = true
    // Wiping the party is the fastest way back to the lobby.
    for (const member of Object.values(state.members) as any[]) { member.status = 'dead'; member.hp = 0 }
    state = tick(state).stateNext
    expect(state.phase).toBe('lobby')
    expect(state.members['8'].ready).toBe(false)
  })

  it('shows the rest of the party who is ready', () => {
    const state = tick(party([7, 8], 7, { ready: false }), [readyIntent(8, true)]).stateNext
    const seenBy7: any = projectStateForMember(state, '7')
    expect(seenBy7.members['8'].ready).toBe(true)
    expect(lobbyMember(state.members['8']).ready).toBe(true)
  })

  it('ignores a stale ready tap once the party has set off', () => {
    let state = tick(party([7, 8]), [startIntent(7)]).stateNext
    state = tick(state, [readyIntent(8, true)]).stateNext
    expect(state.members['8'].ready).toBe(false)
  })
})

describe('coopRaidEngine — a double-kill boss in the room', () => {
  it('survives its first death and dies on the second', () => {
    // The health raidTotalHitpoints counts twice has to be health that exists.
    // doubleKillCount lives on the combat state, and a member's session is built
    // from scratch every tick — kept off the shared boss record, Olm regenerates
    // to full forever and the raid can never be finished.
    let state: any = createCoopBossState('the_great_olm', monstersData, 1_000)
    state = addCoopMember(
      state,
      createCoopMember({ characterId: 7, username: 'player7', savePayload: savePayload(), itemsData, now: 1_000 }),
    )

    let regenerated = false
    let kill: any = null
    for (let i = 0; i < 400 && !kill; i++) {
      // On the edge, so the next landed hit resolves a death without having to
      // grind the boss down through its defence.
      state.boss.currentHP = 1
      state.members['7'].hp = state.members['7'].maxHP
      const result = tick(state)
      state = result.stateNext
      if (result.events.some((e: any) => e.type === 'bossPhaseReset')) {
        regenerated = true
        expect(result.kill).toBeNull()
        expect(state.boss.currentHP).toBe(monstersData.the_great_olm.hitpoints)
        expect(state.boss.doubleKillCount).toBe(1)
      }
      kill = result.kill
    }

    expect(regenerated).toBe(true)
    expect(kill).not.toBeNull()
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

  it('waits the same 5 seconds between raid bosses as between boss respawns', () => {
    expect(COOP_RAID_ADVANCE_TICKS).toBe(COOP_RESPAWN_TICKS)
    // The HUD counts the wait down in ceil(ticks * 0.6) seconds, and it reads "5s".
    expect(Math.ceil(COOP_RAID_ADVANCE_TICKS * 0.6)).toBe(5)
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

  it('owes every earner a loot modal on the same tick the party lands back in its lobby', () => {
    // The regression this locks: clearing a raid settles the loot and calls
    // returnPartyToLobby on ONE tick, so the killSettled the room publishes for
    // that tick arrives at a client whose state already says 'lobby'. A loot
    // modal only the fight view renders is set and never seen.
    let state = tick(party([7, 8]), [startIntent(7)]).stateNext
    state = toFinalBoss(state)
    const required = coopLootDamageRequired(coopLootBasisHP(state))
    state.members['7'].damage = required
    state.members['8'].damage = required
    const { stateNext, kill } = tick(killBoss(state))

    expect(stateNext.phase).toBe('lobby')
    expect(kill!.lootCharacterIds).toEqual(expect.arrayContaining([7, 8]))

    // The event the room builds from that kill record, as CoopBossScreen reads it.
    const killSettled = {
      type: 'killSettled',
      settlements: kill!.lootCharacterIds.map((characterId: number) => ({
        characterId, granted: [{ itemId: 'coins', quantity: 50_000 }], killCount: 3, diverged: false, failed: false,
      })),
    }
    for (const characterId of [7, 8]) {
      expect(coopKillOutcome(killSettled, characterId)).toMatchObject({ kind: 'loot', winners: 2 })
    }
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

describe('coopRaidEngine — slayer credit for a raid clear', () => {
  const FINAL = 'verin_the_defiled'
  const raidTask = (remaining = 1) => ({
    monsterId: FINAL, monsterName: 'Cryptbound Champions',
    monstersRemaining: remaining, totalCount: remaining, pointsOnComplete: 25, masterId: 'zul_kaar',
  })

  /** A started party whose members carry the given slayer tasks. */
  function partyOnTask(tasks: Record<number, unknown>) {
    let state: any = createCoopRaidState(RAID, monstersData, { hostCharacterId: 7, now: 1_000 })!
    for (const [i, [id, task]] of Object.entries(tasks).entries()) {
      const payload: any = savePayload()
      payload.settings = { ...payload.settings, slayerTask: task }
      state = addCoopMember(state, createCoopMember({
        characterId: Number(id), username: `player${id}`, savePayload: payload, itemsData, now: 1_000 + i,
      }))
    }
    for (const member of Object.values(state.members) as any[]) member.ready = true
    state = tick(state, [startIntent(7)]).stateNext
    const bosses = raidBossOrder(RAID)
    for (let i = 0; i < bosses.length - 1; i++) {
      state = tick(killBoss(state)).stateNext
      for (let t = 0; t < COOP_RAID_ADVANCE_TICKS; t++) state = tick(state).stateNext
    }
    return state
  }

  it('pays the run its authored flat Slayer XP, not the final boss\'s health bar', () => {
    // A raid clear is a whole run. Read off the final boss instead, the four
    // raid tasks paid between 400 and 8000 where solo has always paid the
    // authored 2500-10000 (getSlayerTaskXpForKill's flatXp).
    const state = partyOnTask({ 7: raidTask(2) })
    state.members['7'].damage = coopLootDamageRequired(coopLootBasisHP(state))
    const { stateNext, events } = tick(killBoss(state))

    const credit = events.find((e: any) => e.type === 'slayerCredit')
    expect(credit, 'a raid clear credited nobody').toBeTruthy()
    expect(stateNext.members['7'].xpGained.slayer).toBe(RAID_TASK_META[FINAL].flatSlayerXp)
    expect(stateNext.members['7'].slayerTask.monstersRemaining).toBe(1)
  })

  // The raid's share is measured against the WHOLE run's health, and damage is
  // never reset between bosses — so carrying five bosses and coasting the sixth
  // still pays, while turning up for the last one does not.
  it('credits every raider past the run\'s 10% line, and nobody under it', () => {
    const state = partyOnTask({ 7: raidTask(2), 8: raidTask(2), 9: raidTask(2), 10: null })
    const line = coopLootDamageRequired(coopLootBasisHP(state))
    state.members['7'].damage = line
    state.members['8'].damage = line
    state.members['9'].damage = line - 1
    state.members['10'].damage = line
    const { stateNext, events } = tick(killBoss(state))

    expect(events.filter((e: any) => e.type === 'slayerCredit').map((e: any) => e.characterId).sort())
      .toEqual([7, 8])
    expect(stateNext.members['8'].xpGained.slayer).toBe(RAID_TASK_META[FINAL].flatSlayerXp)
    // 9 was on the task but short of the line; 10 cleared it with no task.
    expect(stateNext.members['9'].xpGained.slayer).toBeUndefined()
    expect(stateNext.members['10'].xpGained.slayer).toBeUndefined()
  })

  it('credits nothing for the bosses before the last one', () => {
    let state = createCoopRaidState(RAID, monstersData, { hostCharacterId: 7, now: 1_000 })!
    const payload: any = savePayload()
    payload.settings = { ...payload.settings, slayerTask: raidTask(2) }
    state = addCoopMember(state, createCoopMember({
      characterId: 7, username: 'player7', savePayload: payload, itemsData, now: 1_000,
    }))
    for (const member of Object.values(state.members) as any[]) member.ready = true
    state = tick(state, [startIntent(7)]).stateNext

    const { stateNext, events } = tick(killBoss(state))
    expect(events.some((e: any) => e.type === 'raidBossDefeated')).toBe(true)
    expect(events.some((e: any) => e.type === 'slayerCredit')).toBe(false)
    expect(stateNext.members['7'].slayerTask.monstersRemaining).toBe(2)
  })

  it('refuses a raid task credit for a kill of the same boss reached any other way', () => {
    // Defence-in-depth, mirroring solo's raidTaskCreditBlocked: the proxy task
    // is paid by the CLEAR, so a bare kill of the final boss must pay nothing.
    const member: any = {
      status: 'alive', characterId: 7, slayerTask: raidTask(2), xpGained: {}, slayerTasksCompleted: 0,
      damage: 5000,
    }
    const basisHP = 5000
    expect(creditSlayerKill(member, FINAL, monstersData, { basisHP })).toBeNull()
    expect(member.slayerTask.monstersRemaining).toBe(2)
    expect(member.xpGained.slayer).toBeUndefined()

    expect(creditSlayerKill(member, FINAL, monstersData, { fromRaidCompletion: true, basisHP })).toBeTruthy()
    expect(member.slayerTask.monstersRemaining).toBe(1)
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
