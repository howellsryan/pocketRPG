// D1 side of raid parties (§14). The fight itself is a co-op session — same
// room, same tick loop, same save lock — so everything here is about the part
// raids do differently: a lobby you can only enter before the run starts, and
// a host who starts it.
//
// Loot is settled by coopBoss.js's settleCoopKill, which reads `sourceType`
// off the kill record and rolls raids.json instead of the monster table. The
// grant, the collection log and the kill count are server-side exactly as they
// are for /api/actions/raid/complete.

import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }
import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import raidsData from '../../../src/data/raids.json' assert { type: 'json' }
import {
  COOP_MAX_MEMBERS,
  addCoopMember,
  createCoopMember,
  createCoopRaidState,
  memberCount,
} from '../../../src/engine/coopBossEngine.js'
import { COOP_RAID_IDS, coopRaidData, coopRaidSummary, isCoopRaidId } from '../../../src/engine/coopRaidEngine.js'
import { checkRaidRequirementsPure } from '../../../src/engine/combatRequirements.js'
import { completedQuestIds } from './bossEntry.js'
import { isHardModeEnabled } from './hardMode.js'
import { loadCharacterWithSave, writeSave } from './save.js'
import { GameApiError } from './errors.js'
import { callCoopRoom } from './coopRoom.js'
import { auditLog } from './audit.js'
import {
  COOP_LOCK_PENDING,
  COOP_SESSION_STALE_MS,
  activeSessionIdFor,
  currentSaveRevision,
  listSessionMembers,
  parseSessionState,
  readSession,
  touchCoopMember,
} from './coopBoss.js'

export { COOP_RAID_IDS, isCoopRaidId }

export function coopRaidCatalogue() {
  return COOP_RAID_IDS.map((raidId) => coopRaidSummary(raidId, monstersData)).filter(Boolean)
}

/**
 * The raid gate, server-side. The server grants this raid's reward table, so a
 * client-only gate is no gate — the same reasoning as
 * coopBossRequirementFailure. Runs through checkRaidRequirementsPure so a party
 * and a solo run can never disagree about who is allowed in.
 */
export function coopRaidRequirementFailure(raidId, saveObject) {
  const raid = raidsData?.[raidId]
  if (!raid || !isCoopRaidId(raidId)) return { code: 'INVALID_COOP_RAID', message: 'That raid cannot be run as a party' }
  const gate = checkRaidRequirementsPure(raid, { completedQuests: completedQuestIds(saveObject) })
  if (!gate.locked) return null
  return { code: 'RAID_REQUIREMENTS_NOT_MET', message: gate.reason }
}

function toOpenParty(row) {
  return {
    sessionId: row.id,
    raidId: row.raid_id,
    memberCount: row.member_count,
    maxMembers: COOP_MAX_MEMBERS,
    hostCharacterId: row.host_character_id ?? null,
    hardMode: row.hard_mode === 1,
    phase: row.phase || 'active',
    full: row.member_count >= COOP_MAX_MEMBERS,
  }
}

/**
 * Every party still taking members, across every raid, with its roster.
 *
 * Lobby phase ONLY. A raid is a run with a beginning — letting someone drop in
 * on the last boss is exactly what the lobby exists to prevent — so a party
 * that has started is not advertised as joinable.
 */
export async function listOpenRaidParties(env, now = Date.now()) {
  const byRaid = new Map(COOP_RAID_IDS.map((id) => [id, []]))
  const placeholders = COOP_RAID_IDS.map(() => '?').join(',')
  if (!placeholders) return byRaid
  const rows = await env.DB.prepare(
    `SELECT id, raid_id, member_count, host_character_id, phase, hard_mode
       FROM coop_boss_sessions
      WHERE raid_id IN (${placeholders}) AND status = 'active' AND phase = 'lobby' AND last_tick_at >= ?
      ORDER BY member_count DESC, id ASC`,
  ).bind(...COOP_RAID_IDS, now - COOP_SESSION_STALE_MS).all()
  const parties = (rows.results || []).map(toOpenParty)
  const roster = await listSessionMembers(env, parties.map((p) => p.sessionId), now)
  for (const party of parties) {
    party.members = roster.get(party.sessionId) || []
    byRaid.get(party.raidId)?.push(party)
  }
  return byRaid
}

/**
 * Opens a party (sessionId null) or joins a named one.
 *
 * Never picks a party for the player: the two entry points are "start a party"
 * and "join that one", and quietly rerouting a join is the one thing a lobby
 * list promises not to do. That is also why there is no retry loop here — a
 * party that filled up between the render and the tap is an honest refusal.
 */
export async function joinCoopRaidParty(env, { characterId, identityId, raidId, username, sessionId = null }, now = Date.now()) {
  if (!isCoopRaidId(raidId) || !coopRaidData(raidId)) {
    throw new GameApiError('INVALID_COOP_RAID', 'That raid cannot be run as a party', 400)
  }
  const existing = await activeSessionIdFor(env, characterId)
  if (existing) {
    const row = await readSession(env, existing)
    if (row?.status === 'active') {
      // Rejoining the party they are already in is fine; anything else is not.
      // The old room still holds this character's pack and save revision, so
      // repointing them would strand that run's XP behind a diverged
      // write-back.
      if (row.raid_id !== raidId || (sessionId !== null && Number(sessionId) !== Number(existing))) {
        throw new GameApiError(
          'CHARACTER_IN_COOP_SESSION',
          'You are already in another group fight — leave it first',
          409,
        )
      }
      await touchCoopMember(env, existing, characterId, now)
      return { sessionId: existing, rejoined: true, saveRevision: await currentSaveRevision(env, characterId) }
    }
    await env.DB.prepare('UPDATE characters SET active_coop_session_id = NULL WHERE id = ?').bind(characterId).run()
  }

  const { saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, identityId)
  const gate = coopRaidRequirementFailure(raidId, saveObject)
  if (gate) throw new GameApiError(gate.code, gate.message, 403)

  // The snapshot becomes the authority on this character's pack until they
  // leave, so the revision moves now — and the member carries it, so a save
  // that changed underneath the run is refused rather than rolled back.
  const written = await writeSave(env, characterId, saveObject, saveRevision)
  const member = createCoopMember({ characterId, username, savePayload: saveObject, itemsData, now })
  member.saveRevision = written.saveRevision
  member.ownerId = identityId

  // Claim the character BEFORE putting them in a party, for the same reason the
  // boss join does: the other order leaves a member inside a room they hold no
  // lock for.
  const lock = await env.DB.prepare(
    'UPDATE characters SET active_coop_session_id = ? WHERE id = ? AND active_coop_session_id IS NULL',
  ).bind(COOP_LOCK_PENDING, characterId).run()
  if (!lock.meta.changes) throw new GameApiError('CHARACTER_IN_COOP_SESSION', 'Already in a group fight', 409)

  let joinedSessionId = null
  try {
    joinedSessionId = sessionId === null
      // The host's own switch fixes the party's difficulty; a raider joining a
      // lobby adopts what the host set, exactly as a boss room works.
      ? await openRaidParty(env, { raidId, member, characterId, now, hardMode: await isHardModeEnabled(env, characterId, 'raids', raidId) })
      : await joinExistingParty(env, { raidId, member, characterId, sessionId })
  } catch (err) {
    await env.DB.prepare(
      'UPDATE characters SET active_coop_session_id = NULL WHERE id = ? AND active_coop_session_id = ?',
    ).bind(characterId, COOP_LOCK_PENDING).run()
    throw err
  }

  await env.DB.prepare(
    'UPDATE characters SET active_coop_session_id = ? WHERE id = ? AND active_coop_session_id = ?',
  ).bind(joinedSessionId, characterId, COOP_LOCK_PENDING).run()

  await env.DB.prepare(
    `INSERT INTO coop_session_members (session_id, character_id, joined_at, left_at, last_seen_at)
     VALUES (?, ?, ?, NULL, ?)
     ON CONFLICT(session_id, character_id) DO UPDATE SET joined_at = excluded.joined_at, left_at = NULL, last_seen_at = excluded.last_seen_at`,
  ).bind(joinedSessionId, characterId, now, now).run()

  await auditLog(env, 'coop.raid.join', {
    sessionId: joinedSessionId, characterId, raidId, host: sessionId === null,
  }, { swallow: true })
  return { sessionId: joinedSessionId, rejoined: false, saveRevision: written.saveRevision }
}

async function openRaidParty(env, { raidId, member, characterId, now, hardMode = false }) {
  const state = createCoopRaidState(raidId, monstersData, { hostCharacterId: characterId, now, hardMode })
  if (!state) throw new GameApiError('INVALID_COOP_RAID', 'That raid cannot be run as a party', 400)
  const seeded = addCoopMember(state, member)
  const res = await env.DB.prepare(
    `INSERT INTO coop_boss_sessions
       (boss_id, raid_id, phase, host_character_id, status, member_count, created_at, current_tick,
        state_json, last_tick_at, boss_hp, boss_max_hp, kill_seq, hard_mode)
     VALUES (?, ?, 'lobby', ?, 'active', 1, ?, 0, ?, ?, ?, ?, 0, ?)`,
  ).bind(
    seeded.bossId, raidId, characterId, now, JSON.stringify(seeded), now,
    seeded.boss.currentHP, seeded.boss.maxHP, hardMode ? 1 : 0,
  ).run()
  return res.meta.last_row_id
}

/**
 * Joins a party that already exists.
 *
 * Goes through the ROOM, never through D1 alone: a warm room holds the party in
 * memory and overwrites state_json on its next checkpoint, so a member written
 * only into the row is erased within a tick or two. The room is also what
 * enforces the lobby — it knows whether the host has pressed Start, and the row
 * may be a checkpoint behind.
 */
async function joinExistingParty(env, { raidId, member, characterId, sessionId }) {
  const row = await readSession(env, sessionId)
  if (!row || row.status !== 'active' || row.raid_id !== raidId) {
    throw new GameApiError('COOP_SESSION_UNAVAILABLE', 'That party has finished — pick another', 409)
  }
  if (row.member_count >= COOP_MAX_MEMBERS) {
    throw new GameApiError('COOP_SESSION_UNAVAILABLE', 'That party is full — pick another', 409)
  }

  const { status, body } = await callCoopRoom(env, sessionId, 'join', { characterId, member })
  if (status === 200 && body?.ok) return sessionId
  if (body?.error === 'raid_in_progress') {
    throw new GameApiError('RAID_ALREADY_STARTED', 'That party has already set off — you can only join before the raid starts', 409)
  }
  if (body?.error === 'session_full') {
    throw new GameApiError('COOP_SESSION_UNAVAILABLE', 'That party is full — pick another', 409)
  }
  throw new GameApiError('COOP_SESSION_UNAVAILABLE', 'That party is no longer taking raiders', 409)
}

/** The party a character is currently held by, for the lobby list's "Rejoin". */
export async function activeRaidPartyFor(env, characterId) {
  const sessionId = await activeSessionIdFor(env, characterId)
  if (!sessionId) return null
  const row = await readSession(env, sessionId)
  if (!row || row.status !== 'active' || !row.raid_id) return null
  const state = parseSessionState(row)
  return {
    sessionId,
    raidId: row.raid_id,
    phase: row.phase || 'active',
    memberCount: memberCount(state || {}),
  }
}
