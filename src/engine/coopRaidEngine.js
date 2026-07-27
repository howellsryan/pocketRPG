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
  return raid && Array.isArray(raid.bosses) && raid.bosses.length > 0 ? raid : null
}

export function raidBossOrder(raidId) {
  return coopRaidData(raidId)?.bosses ?? []
}

/**
 * Every hitpoint a party has to chew through to finish this raid.
 *
 * Seeded through createCombatState rather than read straight off
 * `monster.hitpoints` because a phased boss starts on its first form's phaseHP,
 * and the loot threshold has to measure the fight players actually have.
 * Computed once when the raid starts and stored on the state, so the HUD can
 * show a member's share of the whole run from the first swing.
 */
export function raidTotalHitpoints(raidId, monstersData) {
  let total = 0
  for (const bossId of raidBossOrder(raidId)) {
    const monster = monstersData?.[bossId]
    if (!monster) continue
    const seed = createCombatState(monster, 'melee', 'accurate', null, monstersData)
    total += Math.max(0, Math.floor(Number(seed?.monster?.currentHP) || 0))
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
    bossCount: raid.bosses.length,
    bossNames: raid.bosses.map((id) => monstersData?.[id]?.name || id),
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

/** Progress line for the fight HUD: "Boss 3/6", and the name of what is next. */
export function raidProgress(state, monstersData) {
  const raid = state?.raid
  if (!raid) return null
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
