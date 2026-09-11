// Raid parties: the pure raid-shaped logic behind a co-op session.
//
// A raid party is a co-op session (coopBossEngine) with two differences the
// rest of the stack has to respect:
//
//   1. It has a LOBBY. Bosses are drop-in — a co-op boss room takes anyone at
//      any time — but a raid is a run with a beginning, so members are admitted
//      only while `phase === 'lobby'` and the host is the one who starts it.
//   2. Its boss is a SEQUENCE. Killing one advances to the next instead of
//      settling loot; only the last one pays, out of the raid's own reward
//      table (src/data/raids.json), exactly as the solo raid does.
//
// Deliberately imports nothing from coopBossEngine — that module imports this
// one, and the single-file build runs top-to-bottom, so the dependency has to
// stay one-way or a top-level read lands in a temporal dead zone (§12).

import raidsData from '../data/raids.json'
import { createCombatState } from './combat.js'
import { isWaveRaid, raidEncounterHitpoints } from './raidEncounters.js'

/**
 * The wait between a raid boss dying and the next one walking in: 8 ticks, the
 * HUD's 5 seconds — the same beat as COOP_RESPAWN_TICKS, and prep time in the
 * same way (intents still apply, so the party eats, drinks and re-gears in it).
 * Keep the two equal: one number the party can learn covers both waits.
 */
export const COOP_RAID_ADVANCE_TICKS = 8

/**
 * Canonical raid ids. raids.json carries each raid twice — once under its own
 * id and once under `legacy_id` — so keying off Object.keys would offer every
 * raid to players as two different parties fighting the same bosses.
 */
export const COOP_RAID_IDS = Object.keys(raidsData || {}).filter((key) => raidsData[key]?.id === key)

export function isCoopRaidId(raidId) {
  return typeof raidId === 'string' && COOP_RAID_IDS.includes(raidId)
}

/** Resolves an id through the legacy aliases, so a stored `raid_id` written by
 * an older row still finds its raid. */
export function coopRaidData(raidId) {
  const raid = raidsData?.[raidId]
  return raid && ((Array.isArray(raid.bosses) && raid.bosses.length > 0) || isWaveRaid(raid)) ? raid : null
}

export function raidBossOrder(raidId) {
  return coopRaidData(raidId)?.bosses ?? []
}

/**
 * Every hitpoint one boss makes a party chew through — the whole fight, not the
 * health bar it opens on.
 *
 * A phased boss hands out a fresh bar per form (Verzik: 2000, then 3250, then
 * 2500), and a double-kill boss regenerates to full once (Olm: 800 twice). Both
 * are health the party actually has to remove, so both count; reading
 * `monster.hitpoints` or the seeded state alone charges the loot gate for a
 * fraction of the fight it is supposed to measure.
 */
export function bossFightHitpoints(monster, monstersData) {
  const seed = createCombatState(monster, 'melee', 'accurate', null, monstersData)
  let total = Math.max(0, Math.floor(Number(seed?.monster?.currentHP) || 0))
  if (monster.verzikPhased && monster.multiForm && monster.forms) {
    const order = monster.formCycleOrder || Object.keys(monster.forms)
    const startIndex = order.indexOf(monster.initialForm || order[0])
    for (const key of order.slice(Math.max(0, startIndex) + 1)) {
      const phaseHP = monster.forms[key]?.phaseHP ?? monster.hitpoints
      total += Math.max(0, Math.floor(Number(phaseHP) || 0))
    }
  }
  if (monster.requiresDoubleKill) total *= 2
  return total
}

/**
 * Every hitpoint a party has to chew through to finish this raid.
 *
 * Computed once when the raid starts and stored on the state, so the HUD can
 * show a member's share of the whole run from the first swing.
 */
export function raidTotalHitpoints(raidId, monstersData, raidTable = raidsData) {
  const raid = raidTable?.[raidId]
  if (isWaveRaid(raid)) return raidEncounterHitpoints(raid, monstersData)
  let total = 0
  for (const bossId of (Array.isArray(raid?.bosses) ? raid.bosses : raidBossOrder(raidId))) {
    const monster = monstersData?.[bossId]
    if (!monster) continue
    total += bossFightHitpoints(monster, monstersData)
  }
  return total
}

export function coopRaidSummary(raidId, monstersData) {
  const raid = coopRaidData(raidId)
  if (!raid) return null
  return {
    raidId,
    name: raid.name,
    icon: raid.icon ?? null,
    description: raid.description ?? null,
    bossCount: isWaveRaid(raid) ? raid.waves.length : raid.bosses.length,
    bossNames: isWaveRaid(raid)
      ? raid.waves.map((wave) => monstersData?.[wave.primary]?.name || wave.primary)
      : raid.bosses.map((id) => monstersData?.[id]?.name || id),
    encounterKind: isWaveRaid(raid) ? 'waves' : 'bosses',
  }
}

/**
 * Who becomes host when the current one leaves.
 *
 * Earliest join first, so succession is the queue players can already see in
 * the lobby rather than a surprise. A party whose host closed their tab must
 * not be left with a Start button nobody can press.
 */
export function nextHostCharacterId(state, excludeCharacterId = null) {
  const excluded = excludeCharacterId == null ? null : String(excludeCharacterId)
  const candidates = Object.values(state?.members || {})
    .filter((m) => String(m.characterId) !== excluded)
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0) || Number(a.characterId) - Number(b.characterId))
  return candidates.length > 0 ? Number(candidates[0].characterId) : null
}

export function isCoopHost(state, characterId) {
  return state?.hostCharacterId != null && Number(state.hostCharacterId) === Number(characterId)
}

/** A raid party waiting on its host. Members may still be added in this phase
 * and in no other. */
export function isCoopLobby(state) {
  return state?.phase === 'lobby'
}

/**
 * Everyone whose readiness the host is waiting on.
 *
 * The host is excluded: pressing Start IS their answer, so counting them would
 * leave the button reading "3/4 ready" at the moment the host is the only one
 * left to press it. So are the dead — a party comes back from a wipe with its
 * casualties still in it, they are never revived, and the intent path refuses
 * actions from a dead member, so counting them would strand the party behind
 * somebody who cannot answer.
 */
function readinessRoster(state) {
  const hostId = state?.hostCharacterId
  return Object.values(state?.members || {})
    .filter((m) => (hostId == null || Number(m.characterId) !== Number(hostId)) && m.status !== 'dead')
}

/** How much of the party has said it is ready, for the host's Start button. */
export function raidReadyCount(state) {
  const roster = readinessRoster(state)
  return { ready: roster.filter((m) => m.ready).length, total: roster.length }
}

/** Whether the host may set off. The gate, and the same count the lobby shows —
 * a Start button that disagrees with the server is worse than a locked one. */
export function raidPartyReady(state) {
  return readinessRoster(state).every((m) => !!m.ready)
}

/** Progress line for the fight HUD: "Boss 3/6", and the name of what is next. */
export function raidProgress(state, monstersData) {
  const raid = state?.raid
  if (!raid) return null
  if (Array.isArray(raid.waves) && raid.waves.length > 0) {
    const index = Math.max(0, Math.min(raid.waves.length - 1, Number(raid.currentWaveIndex) || 0))
    const next = raid.waves[index + 1] || null
    return {
      kind: 'wave',
      raidId: raid.raidId,
      name: raid.name,
      index,
      position: index + 1,
      total: raid.waves.length,
      currentBossId: raid.waves[index]?.primary ?? null,
      nextBossId: next?.primary ?? null,
      nextBossName: next?.primary ? (monstersData?.[next.primary]?.name || next.primary) : null,
      isFinalBoss: index >= raid.waves.length - 1,
    }
  }
  const bosses = Array.isArray(raid.bosses) ? raid.bosses : []
  const index = Math.max(0, Math.min(bosses.length - 1, Number(raid.currentBossIndex) || 0))
  const nextId = bosses[index + 1] ?? null
  return {
    raidId: raid.raidId,
    name: raid.name,
    index,
    position: index + 1,
    total: bosses.length,
    currentBossId: bosses[index] ?? null,
    nextBossId: nextId,
    nextBossName: nextId ? (monstersData?.[nextId]?.name || nextId) : null,
    isFinalBoss: index >= bosses.length - 1,
  }
}
