// Server side of co-operative boss fights (§14). The server owns the whole
// fight here — every swing, all XP, all supply consumption and the loot roll —
// so unlike the idle loop nothing about a co-op session is client-trusted.
//
// A character's save is locked (characters.active_coop_session_id) for the
// duration, in the same lock class as the PvP active match and the world
// session: the server mutates inventory tick by tick, so nothing else may write
// the save underneath it.
//
// The tick loop itself does NOT live here — it runs in the CoopBossRoom Durable
// Object (world/server/CoopBossRoom.ts). This module is the D1 side: joining,
// leaving, the save write-back, kill settlement, and the crash-recovery sweep.
// The room imports it exactly as the world DO imports save.js.

import monstersData from '../../../src/data/monsters.json' assert { type: 'json' }
import itemsData from '../../../src/data/items.json' assert { type: 'json' }
import prayersData from '../../../src/data/prayers.json' assert { type: 'json' }
import spellsData from '../../../src/data/spells.json' assert { type: 'json' }
import { MAX_XP } from '../../../src/utils/constants.js'
import {
  COOP_BOSS_IDS,
  COOP_MAX_MEMBERS,
  addCoopMember,
  createCoopBossState,
  createCoopMember,
  emptySlayerCredit,
  memberCount,
  removeCoopMember,
} from '../../../src/engine/coopBossEngine.js'
import { bossEntryFailure, loadBossKillCounts } from './bossEntry.js'
import { isHardModeEnabled } from './hardMode.js'
import { monsterMaxHitRange } from '../../../src/engine/monsterMaxHit.js'
import { rollMonsterRewardsById } from './monsterRewards.js'
import { rollRaidRewardsById } from './raidRewards.js'
import { settleActionCompletion } from './actionCompletion.js'
import { loadCharacterWithSave, writeSave } from './save.js'
import { isValidEntry } from '../collectionLog.js'
import { GameApiError } from './errors.js'
import { callCoopRoom, coopRoomsAvailable } from './coopRoom.js'
import { auditLog } from './audit.js'

export const COOP_ENGINE_DEPS = { itemsData, monstersData, prayersData, spellsData }
export { COOP_BOSS_IDS }
/** A member nobody has heard from for this long is gone: their lock is released
 * and they are written back out of the fight. Keyed per MEMBER, not per session
 * — a session stays alive as long as anyone is in it, so a session-wide timer
 * would leave a crashed player's save locked for as long as the others keep
 * fighting. Mirrors WORLD_SESSION_TTL_MS. */
export const COOP_SESSION_STALE_MS = 90 * 1000
const JOIN_ATTEMPTS = 4
/** Applied intents and the state blobs of ended sessions are pure exhaust once
 * the fight is over; without a retention pass they grow without bound. */
export const COOP_RETENTION_MS = 24 * 60 * 60 * 1000
/** Placeholder the join path parks in active_coop_session_id between claiming
 * the character and knowing which room they landed in. Exported because the
 * raid-party join (coopRaid.js) claims the character through the same lock. */
export const COOP_LOCK_PENDING = -1
const LOCK_PENDING = COOP_LOCK_PENDING

export function isCoopBoss(bossId) {
  return typeof bossId === 'string' && COOP_BOSS_IDS.has(bossId) && monstersData?.[bossId]?.boss === true
}

export function coopBossSummary(bossId) {
  const monster = monstersData?.[bossId]
  if (!monster) return null
  return {
    bossId,
    name: monster.name,
    combatLevel: monster.combatLevel,
    hitpoints: monster.hitpoints,
    // Resolved, not the raw field: a boss that rotates style authors its max
    // hit per form and has none of its own, so the raw read reported null.
    maxHit: monsterMaxHitRange(monster).max,
    questRequirement: monster.questRequirement ?? null,
    slayerRequirement: monster.slayerRequirement ?? null,
    maxMembers: COOP_MAX_MEMBERS,
  }
}

/** Strict session id from a route param. parseInt happily accepted "12abc" and
 * negative ids; a room key has to be exactly a positive integer. */
export function parseCoopSessionId(raw) {
  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function parseSessionState(row) {
  try {
    return JSON.parse(row.state_json)
  } catch {
    return null
  }
}

export async function readSession(env, sessionId) {
  return env.DB.prepare(
    `SELECT id, boss_id, raid_id, phase, host_character_id, status, member_count, current_tick,
            state_json, last_tick_at, created_at, ended_at, kill_seq, hard_mode
       FROM coop_boss_sessions WHERE id = ?`,
  ).bind(sessionId).first()
}

export async function readMembership(env, sessionId, characterId) {
  return env.DB.prepare(
    'SELECT session_id, character_id, joined_at, left_at, last_seen_at FROM coop_session_members WHERE session_id = ? AND character_id = ?',
  ).bind(sessionId, characterId).first()
}

export async function activeSessionIdFor(env, characterId) {
  const row = await env.DB.prepare('SELECT active_coop_session_id FROM characters WHERE id = ?').bind(characterId).first()
  const id = row?.active_coop_session_id ?? null
  return id === LOCK_PENDING ? null : id
}

/** Marks a member as still present. The save lock reads this, so it has to be
 * bumped by every path that proves the player is still in the fight. */
export async function touchCoopMember(env, sessionId, characterId, now = Date.now()) {
  await env.DB.prepare(
    'UPDATE coop_session_members SET last_seen_at = ? WHERE session_id = ? AND character_id = ? AND left_at IS NULL',
  ).bind(now, sessionId, characterId).run()
}

/**
 * Save-lock predicate for /api/save and every other server path that writes the
 * save, mirroring isWorldSessionLive.
 *
 * Keyed on the MEMBER's own heartbeat: a session refreshed by seven other
 * players must not keep an eighth player — whose tab crashed — locked out of
 * their own save. COALESCE keeps sessions created before migration 0032 (no
 * per-member heartbeat yet) locked on the session clock rather than instantly
 * unlocked.
 */
export async function isCoopSessionLive(env, characterId, now = Date.now()) {
  if (!env?.DB || !Number.isFinite(Number(characterId))) return false
  const row = await env.DB.prepare(
    `SELECT COALESCE(m.last_seen_at, s.last_tick_at) AS seen_at
       FROM characters c
       JOIN coop_boss_sessions s ON s.id = c.active_coop_session_id
       JOIN coop_session_members m ON m.session_id = s.id AND m.character_id = c.id AND m.left_at IS NULL
      WHERE c.id = ? AND s.status = 'active'`,
  ).bind(Number(characterId)).first()
  if (!row) return false
  return now - (Number(row.seen_at) || 0) < COOP_SESSION_STALE_MS
}

/**
 * Refuses an action while a co-op fight owns this character. Every server path
 * that writes the save has to call this: the room is mutating that save's inventory and XP tick by tick,
 * and the write-back replaces the pack wholesale, so a concurrent write is
 * either lost or — worse — rolled back into a duplicate.
 */
export async function assertNotInCoopSession(env, characterId, now = Date.now()) {
  if (!(await isCoopSessionLive(env, characterId, now))) return null
  return new Response(
    JSON.stringify({ error: 'character_in_coop_session', code: 'CHARACTER_IN_COOP_SESSION' }),
    { status: 409, headers: { 'Content-Type': 'application/json' } },
  )
}

/**
 * The character's live save revision.
 *
 * Joining WRITES the save (the session snapshot below), so the client's idea of
 * the revision goes stale the moment it asks to join. Handing the new one back
 * is what stops its next autosave being rejected as a stale write — which the
 * player sees as a save failure caused by walking into a boss fight.
 */
export async function currentSaveRevision(env, characterId) {
  const row = await env.DB.prepare('SELECT save_revision FROM saves WHERE character_id = ?').bind(characterId).first()
  return Number(row?.save_revision) || 0
}

export async function ownerIdFor(env, characterId) {
  const row = await env.DB.prepare('SELECT owner_id FROM characters WHERE id = ?').bind(characterId).first()
  return row?.owner_id ?? null
}

/**
 * Releases sessions whose room is gone — a Durable Object evicted with nobody
 * left to wake it, or a session stranded by a deploy. Members are written back
 * before the lock is released, so a dropped connection costs the fight, never
 * the XP earned in it.
 *
 * Live sessions eject their own stale members inside the room, which sees each
 * member's heartbeat directly; this is only the crash path behind that.
 */
export async function sweepStaleCoopSessions(env, now = Date.now()) {
  const cutoff = now - COOP_SESSION_STALE_MS
  const stale = await env.DB.prepare(
    "SELECT id, boss_id, state_json FROM coop_boss_sessions WHERE status = 'active' AND last_tick_at < ?",
  ).bind(cutoff).all()
  const rows = stale.results || []
  if (rows.length === 0) return 0

  for (const row of rows) {
    const state = parseSessionState(row)
    for (const member of Object.values(state?.members || {})) {
      try {
        const identityId = member.ownerId ?? await ownerIdFor(env, member.characterId)
        if (identityId == null) continue
        await writeBackMember(env, { characterId: member.characterId, identityId, member, sessionId: row.id })
      } catch (err) {
        console.error('[PocketRPG][coop] sweep write-back failed', {
          sessionId: row.id, characterId: member?.characterId, message: err?.message || err,
        })
      }
    }
  }

  const ids = rows.map((r) => r.id)
  const placeholders = ids.map(() => '?').join(',')
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE coop_boss_sessions SET status = 'abandoned', ended_at = ? WHERE id IN (${placeholders})`,
    ).bind(now, ...ids),
    env.DB.prepare(
      `UPDATE characters SET active_coop_session_id = NULL WHERE active_coop_session_id IN (${placeholders})`,
    ).bind(...ids),
    env.DB.prepare(
      `UPDATE coop_session_members SET left_at = ? WHERE session_id IN (${placeholders}) AND left_at IS NULL`,
    ).bind(now, ...ids),
  ])
  return ids.length
}

/** How often a picker request pays for retention. Every call writes whether or
 * not there is anything to drop, and the picker is opened on every boss tap, so
 * running it unconditionally billed a scan-and-write to a read. Mirrors
 * SAVE_SWEEP_PROBABILITY. */
const COOP_PRUNE_PROBABILITY = 0.05

export function shouldPruneCoopExhaust(rng = Math.random) {
  return rng() < COOP_PRUNE_PROBABILITY
}

/** Drops the exhaust of finished fights: the state blob of sessions that ended
 * long enough ago that nobody is going to inspect them, and their settlement
 * ledger rows. */
export async function pruneCoopExhaust(env, now = Date.now()) {
  const cutoff = now - COOP_RETENTION_MS
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE coop_boss_sessions SET state_json = '{}'
        WHERE status != 'active' AND ended_at IS NOT NULL AND ended_at < ? AND state_json != '{}'`,
    ).bind(cutoff),
    // The settlement ledger only has to outlive its room — once the session is
    // ended nothing can replay a kill against it, and one row per boss kill
    // adds up fast at a 6-second respawn.
    env.DB.prepare(
      `DELETE FROM coop_kill_settlements WHERE session_id IN (
         SELECT id FROM coop_boss_sessions WHERE status != 'active' AND ended_at IS NOT NULL AND ended_at < ?)`,
    ).bind(cutoff),
  ])
}

/**
 * Open rooms for the picker. Reads the denormalised HP columns rather than
 * state_json — the blob carries every member's full inventory, so pulling it
 * per room to render two numbers is tens of MB on a busy boss.
 */
export async function listOpenSessions(env, bossId, now = Date.now()) {
  const rows = await env.DB.prepare(
    `SELECT id, boss_id, member_count, current_tick, boss_hp, boss_max_hp, hard_mode
       FROM coop_boss_sessions
      WHERE boss_id = ? AND raid_id IS NULL AND status = 'active' AND last_tick_at >= ?
      ORDER BY member_count DESC, id ASC`,
  ).bind(bossId, now - COOP_SESSION_STALE_MS).all()
  return (rows.results || []).map(toOpenSession)
}

/** Every boss's open rooms in ONE query. The picker asks about all 25 co-op
 * bosses at once, so per-boss queries made it an N+1 against the hottest table.
 * Carries each room's roster (the join path's listOpenSessions deliberately
 * does not — it runs inside the retry loop and only needs free slots). */
export async function listAllOpenSessions(env, bossIds, now = Date.now()) {
  const ids = [...bossIds]
  const byBoss = new Map(ids.map((id) => [id, []]))
  if (ids.length === 0) return byBoss
  const placeholders = ids.map(() => '?').join(',')
  const rows = await env.DB.prepare(
    `SELECT id, boss_id, member_count, current_tick, boss_hp, boss_max_hp, hard_mode
       FROM coop_boss_sessions
      WHERE boss_id IN (${placeholders}) AND raid_id IS NULL AND status = 'active' AND last_tick_at >= ?
      ORDER BY member_count DESC, id ASC`,
  ).bind(...ids, now - COOP_SESSION_STALE_MS).all()
  const sessions = (rows.results || []).map(toOpenSession)
  const roster = await listSessionMembers(env, sessions.map((s) => s.sessionId), now)
  for (const session of sessions) {
    session.members = roster.get(session.sessionId) || []
    byBoss.get(session.bossId)?.push(session)
  }
  return byBoss
}

/**
 * Who is in each room, for the session browser. Filtered by the same member
 * heartbeat the sweep uses, so a crashed player stops being advertised as
 * present at the moment their lock is released rather than lingering in the
 * list. `last_seen_at` predates the heartbeat on old rows, hence the coalesce.
 */
export async function listSessionMembers(env, sessionIds, now = Date.now()) {
  const ids = [...new Set(sessionIds)]
  const bySession = new Map(ids.map((id) => [id, []]))
  if (ids.length === 0) return bySession
  const placeholders = ids.map(() => '?').join(',')
  const rows = await env.DB.prepare(
    `SELECT m.session_id, c.id AS character_id, c.username, c.combat_level
       FROM coop_session_members m
       JOIN characters c ON c.id = m.character_id
      WHERE m.session_id IN (${placeholders})
        AND m.left_at IS NULL
        AND COALESCE(m.last_seen_at, m.joined_at) >= ?
      ORDER BY m.joined_at ASC, m.character_id ASC`,
  ).bind(...ids, now - COOP_SESSION_STALE_MS).all()
  for (const row of rows.results || []) {
    bySession.get(row.session_id)?.push({
      characterId: row.character_id,
      username: row.username,
      combatLevel: row.combat_level ?? null,
    })
  }
  return bySession
}

function toOpenSession(row) {
  return {
    sessionId: row.id,
    bossId: row.boss_id,
    hardMode: row.hard_mode === 1,
    memberCount: row.member_count,
    maxMembers: COOP_MAX_MEMBERS,
    bossHP: row.boss_hp ?? null,
    bossMaxHP: row.boss_max_hp ?? null,
    tick: row.current_tick,
    full: row.member_count >= COOP_MAX_MEMBERS,
  }
}

/**
 * The full boss gate, server-side. The client runs the same check to grey the
 * button out, but the server grants this boss's drop table (§14) — so the
 * Slayer level and the kill-count prerequisites have to be enforced here too,
 * not just the quest. A crafted POST otherwise walked straight into a boss the
 * player had not unlocked and collected its uniques.
 *
 * `bossKillCounts` comes from the kill_counts table, never the save (see
 * bossEntry.js) — reading it from the blob is what locked players out of a
 * kill-count-gated boss they had every kill for.
 */
export function coopBossRequirementFailure(bossId, saveObject, bossKillCounts = {}) {
  if (!monstersData?.[bossId]) {
    return { code: 'INVALID_COOP_BOSS', message: 'Boss is not available co-operatively' }
  }
  const gate = bossEntryFailure(bossId, saveObject, bossKillCounts)
  if (!gate) return null
  return { code: 'BOSS_REQUIREMENTS_NOT_MET', message: gate.reason }
}

/**
 * Joins a character into the fullest open instance of a boss, creating one when
 * every instance is full (or none exists). Snapshots the character's save into
 * the session and takes the save lock.
 */
export async function joinCoopSession(env, { characterId, identityId, bossId, username, sessionId: requestedSessionId = null }, now = Date.now()) {
  if (!isCoopBoss(bossId)) throw new GameApiError('INVALID_COOP_BOSS', 'Boss is not available co-operatively', 400)

  const existing = await activeSessionIdFor(env, characterId)
  if (existing) {
    const row = await readSession(env, existing)
    if (row?.status === 'active') {
      // Rejoining the fight they are already in is fine. A DIFFERENT boss is
      // not: the old room still holds this character's pack and save revision,
      // so silently repointing them would strand that fight's XP behind a
      // diverged write-back. Make them leave it first.
      if (row.boss_id !== bossId) {
        throw new GameApiError(
          'CHARACTER_IN_COOP_SESSION',
          'You are already in another group boss fight — leave it first',
          409,
        )
      }
      await touchCoopMember(env, existing, characterId, now)
      return { sessionId: existing, rejoined: true, saveRevision: await currentSaveRevision(env, characterId) }
    }
    await env.DB.prepare('UPDATE characters SET active_coop_session_id = NULL WHERE id = ?').bind(characterId).run()
  }

  const { saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, identityId)
  const gate = coopBossRequirementFailure(bossId, saveObject, await loadBossKillCounts(env, characterId))
  if (gate) throw new GameApiError(gate.code, gate.message, 403)

  const monster = monstersData[bossId]
  // The joiner's own switch decides which ROOM they are looking for, never the
  // difficulty of a room they tapped: a room's difficulty is fixed when it is
  // opened, because everyone in it shares one health bar.
  const wantsHardMode = await isHardModeEnabled(env, characterId, 'monsters', bossId)

  // The session snapshot becomes the authority on this character's inventory
  // and equipment until they leave, so bump the revision now: any save the
  // idle client had in flight is stale from this point on. The revision the
  // write lands on is stamped onto the member — every write-back checks it, so
  // a save that changed underneath the fight is refused rather than rolled back
  // (a snapshot replayed over a changed save IS an item duplication).
  const written = await writeSave(env, characterId, saveObject, saveRevision)
  const member = createCoopMember({ characterId, username, savePayload: saveObject, itemsData, now })
  member.saveRevision = written.saveRevision
  member.ownerId = identityId

  // Claim the character BEFORE putting them in a room. The other order leaves a
  // member inside a fight they hold no lock for whenever the lock is contended
  // — ticked by the server, burning their snapshot supplies, with no session id
  // on the client to leave with, recoverable only by the sweep.
  const lock = await env.DB.prepare(
    'UPDATE characters SET active_coop_session_id = ? WHERE id = ? AND active_coop_session_id IS NULL',
  ).bind(LOCK_PENDING, characterId).run()
  if (!lock.meta.changes) throw new GameApiError('CHARACTER_IN_COOP_SESSION', 'Already in a boss fight', 409)

  let sessionId = null
  // Rooms this attempt has already been turned away from. member_count in D1 is
  // a mirror the room writes, so the picker can hand back a room that is
  // actually full; without this the retry loop would keep choosing it.
  const exhausted = new Set()
  const useRoom = coopRoomsAvailable(env)
  try {
    // Claiming a slot races other joiners: the optimistic UPDATE fails if the
    // session ticked or filled up in between, so re-pick and try again.
    for (let attempt = 0; attempt < JOIN_ATTEMPTS && sessionId === null; attempt++) {
      const open = await listOpenSessions(env, bossId, now)
      // A player who tapped a specific group in the browser gets that group or
      // an honest refusal — quietly rerouting them into a different room is the
      // one thing the browser promises not to do. The list is already filtered
      // to this boss, so a foreign session id simply is not found.
      const target = requestedSessionId
        ? open.find((s) => s.sessionId === requestedSessionId && !exhausted.has(s.sessionId))
        : open.find((s) => !s.full && !exhausted.has(s.sessionId) && s.hardMode === wantsHardMode)
      if (requestedSessionId && (!target || target.full)) {
        throw new GameApiError('COOP_SESSION_UNAVAILABLE', 'That group is full or has finished — pick another', 409)
      }

      if (!target) {
        const fresh = addCoopMember(createCoopBossState(bossId, monstersData, now, { hardMode: wantsHardMode }), member)
        const res = await env.DB.prepare(
          `INSERT INTO coop_boss_sessions (boss_id, status, member_count, created_at, current_tick, state_json, last_tick_at, boss_hp, boss_max_hp, kill_seq, hard_mode)
           VALUES (?, 'active', 1, ?, 0, ?, ?, ?, ?, 0, ?)`,
        ).bind(bossId, now, JSON.stringify(fresh), now, fresh.boss.currentHP, fresh.boss.maxHP, wantsHardMode ? 1 : 0).run()
        sessionId = res.meta.last_row_id
        break
      }

      // The room owns membership for a session that is already running: it
      // holds the fight in memory and overwrites state_json on every
      // checkpoint, so a member added only in D1 is erased within a tick or two
      // and never exists as far as the fight is concerned.
      if (useRoom) {
        const { status, body } = await callCoopRoom(env, target.sessionId, 'join', { characterId, member })
        if (status === 200 && body?.ok) sessionId = target.sessionId
        else exhausted.add(target.sessionId)
        continue
      }

      // No room binding (a Pages deploy ahead of the Worker). Degraded path:
      // write the member into the session blob and let the room pick them up
      // when it cold-loads.
      const row = await readSession(env, target.sessionId)
      const state = row ? parseSessionState(row) : null
      if (!state || row.status !== 'active' || memberCount(state) >= COOP_MAX_MEMBERS) continue

      const nextState = addCoopMember(state, member)
      const res = await env.DB.prepare(
        `UPDATE coop_boss_sessions SET state_json = ?, member_count = ?
          WHERE id = ? AND status = 'active' AND current_tick = ? AND member_count < ?`,
      ).bind(JSON.stringify(nextState), memberCount(nextState), row.id, row.current_tick, COOP_MAX_MEMBERS).run()
      if (res.meta.changes) sessionId = row.id
    }
    if (sessionId === null) throw new GameApiError('COOP_JOIN_CONTENDED', 'Could not join the fight — try again', 409)
  } catch (err) {
    await env.DB.prepare(
      'UPDATE characters SET active_coop_session_id = NULL WHERE id = ? AND active_coop_session_id = ?',
    ).bind(characterId, LOCK_PENDING).run()
    throw err
  }

  await env.DB.prepare(
    'UPDATE characters SET active_coop_session_id = ? WHERE id = ? AND active_coop_session_id = ?',
  ).bind(sessionId, characterId, LOCK_PENDING).run()

  await env.DB.prepare(
    `INSERT INTO coop_session_members (session_id, character_id, joined_at, left_at, last_seen_at)
     VALUES (?, ?, ?, NULL, ?)
     ON CONFLICT(session_id, character_id) DO UPDATE SET joined_at = excluded.joined_at, left_at = NULL, last_seen_at = excluded.last_seen_at`,
  ).bind(sessionId, characterId, now, now).run()

  await auditLog(env, 'coop.session.join', { sessionId, characterId, bossId }, { swallow: true })
  return { sessionId, rejoined: false, saveRevision: written.saveRevision }
}

/** Adds one member's accrued XP to a save, respecting the 200m cap. */
export function applyXpGainedToSave(saveObject, xpGained) {
  if (!saveObject.stats || typeof saveObject.stats !== 'object') saveObject.stats = {}
  const applied = {}
  for (const [skill, amount] of Object.entries(xpGained || {})) {
    const gain = Math.max(0, Math.floor(Number(amount) || 0))
    if (gain <= 0) continue
    const current = saveObject.stats[skill]
    const currentXp = typeof current === 'object' ? Math.max(0, Number(current?.xp) || 0) : 0
    const nextXp = Math.min(MAX_XP, currentXp + gain)
    saveObject.stats[skill] = typeof current === 'object' ? { ...current, xp: nextXp } : { xp: nextXp }
    applied[skill] = nextXp - currentXp
  }
  return applied
}

/**
 * Folds a member's banked slayer progress into a save.
 *
 * The task itself is state and is written outright; points and completion
 * counts are DELTAS and are added, so the caller must clear the credit after a
 * successful write or a second write-back pays them twice.
 */
export function applySlayerCreditToSave(saveObject, member) {
  // A session that predates slayer support carries no task field at all —
  // writing `null` over the player's real task would cancel it.
  if (!Object.prototype.hasOwnProperty.call(member || {}, 'slayerTask')) return saveObject
  const settings = { ...(saveObject.settings && typeof saveObject.settings === 'object' ? saveObject.settings : {}) }
  settings.slayerTask = member.slayerTask || null

  const credit = member.slayerCredit
  if (credit?.tasksCompleted > 0 || credit?.pointsEarned > 0) {
    settings.slayerPoints = Math.max(0, Math.floor(Number(settings.slayerPoints) || 0))
      + Math.max(0, Math.floor(Number(credit.pointsEarned) || 0))
    settings.slayerTasksCompleted = Math.max(
      Math.max(0, Math.floor(Number(settings.slayerTasksCompleted) || 0)),
      Math.max(0, Math.floor(Number(member.slayerTasksCompleted) || 0)),
    )
    const completions = { ...(settings.slayerMasterTaskCompletions && typeof settings.slayerMasterTaskCompletions === 'object' ? settings.slayerMasterTaskCompletions : {}) }
    for (const [masterId, count] of Object.entries(credit.masterCompletions || {})) {
      completions[masterId] = (Math.floor(Number(completions[masterId]) || 0)) + Math.max(0, Math.floor(Number(count) || 0))
    }
    settings.slayerMasterTaskCompletions = completions
  }
  saveObject.settings = settings
  return saveObject
}

/**
 * Folds a mid-fight quick-prayer edit back into the save.
 *
 * The room owns the save for the length of the fight, so the client's own
 * critical push is refused by the co-op lock and dropped — the edit reaches the
 * player's account only by riding the write-back. Absent field means a session
 * that predates the feature: leave the player's configured prayers alone rather
 * than writing an empty list over them.
 */
export function applyQuickPrayersToSave(saveObject, member) {
  if (!Object.prototype.hasOwnProperty.call(member || {}, 'quickPrayers')) return saveObject
  if (!Array.isArray(member.quickPrayers)) return saveObject
  const settings = { ...(saveObject.settings && typeof saveObject.settings === 'object' ? saveObject.settings : {}) }
  settings.quickPrayers = member.quickPrayers.filter((id) => typeof id === 'string')
  saveObject.settings = settings
  return saveObject
}

/** Writes a member's session state (supplies, HP, XP, slayer progress) back
 * onto their save. */
export function applyMemberToSave(saveObject, member) {
  const next = { ...saveObject }
  next.inventory = Array.isArray(member.inventory) ? member.inventory.map((s) => (s ? { ...s } : null)) : []
  next.equipment = Object.fromEntries(
    Object.entries(member.equipment || {}).map(([slot, item]) => [slot, item ? { ...item } : null]),
  )
  applyXpGainedToSave(next, member.xpGained)
  applySlayerCreditToSave(next, member)
  applyQuickPrayersToSave(next, member)
  // Dying in a group has to cost exactly what dying to the same boss alone
  // costs. The solo screen restores HP to full on death; writing the member's
  // literal 0 back would leave a corpse regenerating at +1/60s, so a group
  // death was strictly harsher than a solo one.
  const maxHP = Math.max(1, Math.floor(Number(member.maxHP) || 1))
  const restedHP = member.status === 'dead' ? maxHP : Math.max(0, member.hp)
  if (next.player && typeof next.player === 'object') {
    next.player = { ...next.player, currentHP: restedHP }
  } else {
    next.player = { currentHP: restedHP }
  }
  return next
}

/**
 * The tripwire behind every save write-back.
 *
 * The room's copy of this character's pack is authoritative only for as long as
 * nothing else has written the save. If something did, the write-back is
 * REFUSED outright rather than reconciled: replaying the snapshot restores
 * items sold in the meantime, and writing the XP alone refunds every supply
 * consumed in the fight. Both directions duplicate, so the safe answer is to
 * write nothing and let the audit trail show it.
 *
 * Every save-writing endpoint calls assertNotInCoopSession, so in normal play
 * this never trips — it is the backstop for a missed lock, not a routine path.
 */
export function isMemberSaveOwned(member, saveRevision) {
  const stamped = Number(member?.saveRevision)
  return Number.isFinite(stamped) && stamped === Number(saveRevision)
}

/**
 * Persists one member's fight results and releases their save lock. Loot for a
 * kill is granted separately (settleCoopKill) so a member leaving mid-fight can
 * never be handed drops.
 */
export async function writeBackMember(env, { characterId, identityId, member, sessionId }) {
  const releaseLock = () => env.DB.prepare(
    'UPDATE characters SET active_coop_session_id = NULL WHERE id = ? AND active_coop_session_id = ?',
  ).bind(characterId, sessionId).run()

  const { saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, identityId)
  if (!isMemberSaveOwned(member, saveRevision)) {
    await auditLog(env, 'coop.writeback.diverged', {
      sessionId, characterId, expected: member?.saveRevision ?? null, found: saveRevision,
    }, { swallow: true })
    await releaseLock()
    return { ok: false, reason: 'diverged' }
  }

  const next = applyMemberToSave(saveObject, member)
  const write = await writeSave(env, characterId, next, saveRevision, { baselineFrom: saveObject })
  member.saveRevision = write.saveRevision
  member.xpGained = {}
  // Banked slayer points/completions are deltas — clearing them is what stops a
  // second write-back paying the same completed task again.
  member.slayerCredit = emptySlayerCredit()
  await releaseLock()
  return { ok: true, ...write }
}

/** Closes the membership row after the ROOM has done the write-back. Split out
 * because the room owns the save write while it lives — this is only the D1
 * bookkeeping that follows it. */
export async function closeCoopMembership(env, sessionId, characterId, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE coop_session_members SET left_at = ?, last_seen_at = ? WHERE session_id = ? AND character_id = ? AND left_at IS NULL',
    ).bind(now, now, sessionId, characterId),
    env.DB.prepare(
      'UPDATE characters SET active_coop_session_id = NULL WHERE id = ? AND active_coop_session_id = ?',
    ).bind(characterId, sessionId),
  ])
}

export async function leaveCoopSession(env, { characterId, identityId, sessionId }, now = Date.now()) {
  const row = await readSession(env, sessionId)
  if (!row) throw new GameApiError('COOP_SESSION_NOT_FOUND', 'Session not found', 404)
  const state = parseSessionState(row)
  const member = state?.members?.[String(characterId)]

  if (member) {
    await writeBackMember(env, { characterId, identityId, member, sessionId })
    const nextState = removeCoopMember(state, characterId)
    const remaining = memberCount(nextState)
    // CAS on current_tick, the same guard the room's own writes use: a tick
    // that read this session before the leave must not resurrect the departed
    // member, or their already-banked XP is granted a second time.
    const sessionUpdate = remaining > 0
      ? env.DB.prepare(
        'UPDATE coop_boss_sessions SET state_json = ?, member_count = ? WHERE id = ? AND current_tick = ?',
      ).bind(JSON.stringify(nextState), remaining, sessionId, row.current_tick)
      : env.DB.prepare(
        `UPDATE coop_boss_sessions SET state_json = ?, member_count = ?, status = 'completed', ended_at = ?
          WHERE id = ? AND current_tick = ?`,
      ).bind(JSON.stringify(nextState), remaining, now, sessionId, row.current_tick)
    const [updateRes] = await env.DB.batch([
      sessionUpdate,
      env.DB.prepare(
        'UPDATE coop_session_members SET left_at = ?, last_seen_at = ? WHERE session_id = ? AND character_id = ? AND left_at IS NULL',
      ).bind(now, now, sessionId, characterId),
    ])
    // The room ticked underneath us. The membership row is already closed and
    // the lock released, so the room drops them on the next heartbeat check —
    // the write-back has happened exactly once either way.
    if (!updateRes.meta.changes) {
      await auditLog(env, 'coop.session.leave.contended', { sessionId, characterId }, { swallow: true })
    }
  } else {
    await env.DB.prepare(
      'UPDATE characters SET active_coop_session_id = NULL WHERE id = ? AND active_coop_session_id = ?',
    ).bind(characterId, sessionId).run()
  }

  await auditLog(env, 'coop.session.leave', { sessionId, characterId, bossId: row.boss_id }, { swallow: true })
  return { ok: true }
}

/**
 * Everyone the kill owes a loot roll to.
 *
 * The engine works this out (`lootEligibleCharacterIds` — §4's 10%-of-max-HP
 * gate) and ships the list on the kill record. The fallback to
 * `ownerCharacterId` is deploy skew insurance: a Worker still running the
 * single-winner build sends no list, and settling nothing at all would be a
 * dry kill for the whole room.
 */
function lootWinnerIds(state, kill) {
  const listed = Array.isArray(kill?.lootCharacterIds) ? kill.lootCharacterIds : null
  const ids = listed ?? (kill?.ownerCharacterId != null ? [kill.ownerCharacterId] : [])
  const seen = new Set()
  const out = []
  for (const raw of ids) {
    const id = Number(raw)
    if (!Number.isFinite(id) || seen.has(id) || !state?.members?.[String(id)]) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Grants a kill's loot, server-side, to every member who passed the damage
 * threshold: each one rolls the boss's drop table independently, and each roll
 * is settled onto that character's own save with the collection-log slots and
 * kill count /api/actions/monster/complete would give a solo kill.
 *
 * `killSeq` makes it exactly-once. The room is single-threaded, but it can be
 * evicted mid-settlement and replay the tick on restart, so the idempotency key
 * has to live in D1 (coop_kill_settlements) rather than in the room's memory —
 * and since one kill now pays several players, the key is per CHARACTER
 * (migration 0032), not per kill.
 *
 * The per-member settlements are independent on purpose: one winner's save
 * having diverged, or their write throwing, must not cost the other seven the
 * drop they earned.
 */
export async function settleCoopKill(env, { session, state, kill, killSeq }, now = Date.now()) {
  const winners = lootWinnerIds(state, kill)
  if (winners.length === 0) return { settlements: [], granted: [], ownerCharacterId: null }
  const source = killRewardSource(session, kill)

  const settlements = []
  for (const characterId of winners) {
    try {
      settlements.push(await settleKillShare(env, { session, state, kill, killSeq, characterId, source }, now))
    } catch (err) {
      console.error('[PocketRPG][coop] loot share failed', {
        sessionId: session.id, characterId, killSeq, message: err?.message || err,
      })
      settlements.push({ characterId, granted: [], failed: true })
    }
  }

  await auditLog(env, source.sourceType === 'raids' ? 'coop.raid.complete' : 'coop.boss.kill', {
    sessionId: session.id,
    killSeq: Math.max(0, Math.floor(Number(killSeq) || 0)),
    bossId: session.boss_id,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    ownerCharacterId: kill?.ownerCharacterId ?? null,
    lootDamageRequired: kill?.lootDamageRequired ?? null,
    winners: settlements.map((s) => ({ characterId: s.characterId, granted: s.granted?.length ?? 0 })),
    contributors: (kill.contributors || []).map((c) => ({ characterId: c.characterId, damage: c.damage })),
  }, { swallow: true })

  // Top-level fields mirror the top-damage member's share. Callers written
  // against the single-winner shape (and the room's own killSettled event) keep
  // reading what they always read; `settlements` is the full picture.
  const primary = settlements.find((s) => Number(s.characterId) === Number(kill?.ownerCharacterId)) || settlements[0]
  return { settlements, ...primary, ownerCharacterId: primary.characterId }
}

/**
 * What table this settlement rolls, and what the collection log and kill count
 * are filed under.
 *
 * A boss room settles the boss it is fighting. A raid party settles the RAID —
 * once, on the final boss — out of raids.json, exactly as the solo raid does
 * through /api/actions/raid/complete. The engine puts `sourceType` on the kill
 * record; a record without one is a boss kill from a room that predates raids.
 */
export function killRewardSource(session, kill) {
  const raidId = typeof kill?.raidId === 'string' ? kill.raidId : (session?.raid_id ?? null)
  if (kill?.sourceType === 'raids' && raidId) return { sourceType: 'raids', sourceId: raidId }
  return { sourceType: 'monsters', sourceId: session?.boss_id }
}

/** One member's share of one kill. Claims their sequence, rolls their own
 * table, writes their own save. */
async function settleKillShare(env, { session, state, kill, killSeq, characterId, source }, now) {
  const member = state.members?.[String(characterId)]
  const empty = { characterId, granted: [] }
  if (!member) return empty

  const seq = Math.max(0, Math.floor(Number(killSeq) || 0))
  // OR IGNORE rather than `ON CONFLICT(session_id, kill_seq, character_id)`:
  // migrations are pasted into the D1 console by hand, so there is a real window
  // where this code runs against 0031's `(session_id, kill_seq)` key — and
  // SQLite rejects a conflict target that matches no index at RUNTIME, which
  // turned every co-op kill in that window into a granted-nothing kill. OR
  // IGNORE names no target, so it is correct on the new key and merely degrades
  // to first-winner-only on the old one.
  const { sourceType, sourceId } = source || killRewardSource(session, kill)
  const claim = await env.DB.prepare(
    `INSERT OR IGNORE INTO coop_kill_settlements (session_id, kill_seq, character_id, boss_id, settled_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(session.id, seq, characterId, sourceId, now).run()
  if (!claim.meta.changes) {
    // Already settled — a replayed tick after the room restarted. Hand back
    // what the first settlement granted rather than rolling the table again.
    const prior = await env.DB.prepare(
      'SELECT granted_json FROM coop_kill_settlements WHERE session_id = ? AND kill_seq = ? AND character_id = ?',
    ).bind(session.id, seq, characterId).first()
    let granted = []
    try { granted = JSON.parse(prior?.granted_json || '[]') } catch { granted = [] }
    return { characterId, granted, replayed: true }
  }

  // The claim above is what makes the grant exactly-once, but it is taken
  // BEFORE any of the work — so every path that gives up after it has to hand
  // the sequence back. Leaving the row behind marks the kill settled with
  // granted_json NULL: the drop is voided permanently, the replay path returns
  // an empty list, and the player is shown a dry kill that never rolled.
  const releaseClaim = () => env.DB.prepare(
    'DELETE FROM coop_kill_settlements WHERE session_id = ? AND kill_seq = ? AND character_id = ? AND granted_json IS NULL',
  ).bind(session.id, seq, characterId).run().catch(() => {})

  const identityId = member.ownerId ?? await ownerIdFor(env, characterId)
  if (!identityId) {
    await releaseClaim()
    return empty
  }

  let saveObject
  let saveRevision
  try {
    ({ saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, identityId))
  } catch (err) {
    await releaseClaim()
    throw err
  }
  // Same tripwire as writeBackMember: the winner is still fighting, so their
  // live supplies and XP have to land in the same write as the loot. If the
  // save moved underneath the fight, grant nothing rather than write a snapshot
  // over it.
  if (!isMemberSaveOwned(member, saveRevision)) {
    await auditLog(env, 'coop.writeback.diverged', {
      sessionId: session.id, characterId, expected: member?.saveRevision ?? null, found: saveRevision, at: 'kill',
    }, { swallow: true })
    await releaseClaim()
    return { ...empty, diverged: true }
  }

  // Each winner rolls their table on-task when this kill counted toward their
  // OWN slayer task, so task-only drops behave exactly as they do solo. A raid
  // has no on-task drops of its own — it rolls the raid's reward table.
  const onTask = Array.isArray(kill?.onTaskCharacterIds) && kill.onTaskCharacterIds.some((id) => Number(id) === Number(characterId))
  // The ROOM's difficulty, never the member's switch — one health bar, one set
  // of rates, whatever any individual has toggled since. state_json is what the
  // room is fighting so it leads; the column says the same for a caller holding
  // only the row.
  const hardMode = state?.hardMode === true || session?.hard_mode === 1
  const rewards = sourceType === 'raids'
    ? rollRaidRewardsById(sourceId, Math.random, hardMode)
    : rollMonsterRewardsById(sourceId, Math.random, onTask, hardMode)
  const withSession = applyMemberToSave(saveObject, member)
  let settled
  let write
  try {
    settled = settleActionCompletion(withSession, { sourceType, sourceId, rewards })
    write = await writeSave(env, characterId, withSession, saveRevision, { baselineFrom: saveObject })
  } catch (err) {
    await releaseClaim()
    throw err
  }

  // The winner keeps fighting, and their session inventory is what gets written
  // back when they eventually leave — so drops that landed in the pack have to
  // rejoin the session here, or leaving would overwrite them away. XP is banked
  // by the write above, so clear it rather than granting it twice.
  member.inventory = Array.isArray(withSession.inventory) ? withSession.inventory.map((s) => (s ? { ...s } : null)) : []
  member.xpGained = {}
  member.slayerCredit = emptySlayerCredit()
  member.saveRevision = write.saveRevision

  const grantedItemIds = [...new Set((settled.granted || []).map((g) => g?.itemId).filter(Boolean))]
  const logged = grantedItemIds.filter((itemId) => isValidEntry(sourceType, sourceId, itemId))
  if (logged.length > 0) {
    await env.DB.batch(
      logged.map((itemId) =>
        env.DB.prepare(
          `INSERT INTO collection_log (character_id, item_id, source_type, source_id, obtained_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(character_id, item_id, source_type, source_id) DO NOTHING`,
        ).bind(characterId, itemId, sourceType, sourceId, now),
      ),
    )
  }

  const kcRow = await env.DB.prepare(
    `INSERT INTO kill_counts (character_id, source_type, source_id, kill_count, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(character_id, source_type, source_id)
     DO UPDATE SET kill_count = kill_count + 1, updated_at = excluded.updated_at
     RETURNING kill_count`,
  ).bind(characterId, sourceType, sourceId, now).first()

  await env.DB.prepare(
    'UPDATE coop_kill_settlements SET granted_json = ? WHERE session_id = ? AND kill_seq = ? AND character_id = ?',
  ).bind(JSON.stringify(settled.granted || []), session.id, seq, characterId).run()

  return {
    characterId,
    granted: settled.granted || [],
    collectionLogEntries: logged.map((itemId) => ({ itemId, sourceType, sourceId })),
    killCount: Math.max(0, Math.floor(Number(kcRow?.kill_count) || 0)),
  }
}
