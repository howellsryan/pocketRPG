// Server side of co-operative boss fights (§14). The server owns the whole
// fight here — every swing, all XP, all supply consumption and the loot roll —
// so unlike the idle loop nothing about a co-op session is client-trusted.
//
// A character's save is locked (characters.active_coop_session_id) for the
// duration, in the same lock class as the PvP active match and the world
// session: the server mutates inventory tick by tick, so the idle client must
// not write over the top of it.

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
  memberCount,
  removeCoopMember,
} from '../../../src/engine/coopBossEngine.js'
import { rollMonsterRewardsById } from './monsterRewards.js'
import { settleActionCompletion } from './actionCompletion.js'
import { loadCharacterWithSave, writeSave } from './save.js'
import { isValidEntry } from '../collectionLog.js'
import { GameApiError } from './errors.js'
import { auditLog } from './audit.js'

export const COOP_ENGINE_DEPS = { itemsData, monstersData, prayersData, spellsData }
export { COOP_BOSS_IDS }
/** A session nobody has ticked for this long is dead and gets swept, releasing
 * its members' save locks. */
export const COOP_SESSION_STALE_MS = 90 * 1000
const JOIN_ATTEMPTS = 4

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
    maxHit: monster.maxHit,
    questRequirement: monster.questRequirement ?? null,
    maxMembers: COOP_MAX_MEMBERS,
  }
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
    `SELECT id, boss_id, status, member_count, current_tick, state_json, last_tick_at, created_at, ended_at
       FROM coop_boss_sessions WHERE id = ?`,
  ).bind(sessionId).first()
}

export async function readMembership(env, sessionId, characterId) {
  return env.DB.prepare(
    'SELECT session_id, character_id, joined_at, left_at FROM coop_session_members WHERE session_id = ? AND character_id = ?',
  ).bind(sessionId, characterId).first()
}

export async function activeSessionIdFor(env, characterId) {
  const row = await env.DB.prepare('SELECT active_coop_session_id FROM characters WHERE id = ?').bind(characterId).first()
  return row?.active_coop_session_id ?? null
}

/** Save-lock predicate for /api/save, mirroring isWorldSessionLive. */
export async function isCoopSessionLive(env, characterId, now = Date.now()) {
  const row = await env.DB.prepare(
    `SELECT s.last_tick_at FROM characters c
       JOIN coop_boss_sessions s ON s.id = c.active_coop_session_id
      WHERE c.id = ? AND s.status = 'active'`,
  ).bind(characterId).first()
  if (!row) return false
  return now - (Number(row.last_tick_at) || 0) < COOP_SESSION_STALE_MS
}

/** Releases members of sessions nobody has ticked for a while. Without this a
 * client that closes its tab mid-fight would leave its save locked forever. */
export async function sweepStaleCoopSessions(env, now = Date.now()) {
  const cutoff = now - COOP_SESSION_STALE_MS
  const stale = await env.DB.prepare(
    "SELECT id FROM coop_boss_sessions WHERE status = 'active' AND last_tick_at < ?",
  ).bind(cutoff).all()
  const ids = (stale.results || []).map((r) => r.id)
  if (ids.length === 0) return 0
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

export async function listOpenSessions(env, bossId, now = Date.now()) {
  const rows = await env.DB.prepare(
    `SELECT id, member_count, current_tick, state_json, last_tick_at
       FROM coop_boss_sessions
      WHERE boss_id = ? AND status = 'active' AND last_tick_at >= ?
      ORDER BY member_count DESC, id ASC`,
  ).bind(bossId, now - COOP_SESSION_STALE_MS).all()
  return (rows.results || []).map((row) => {
    const state = parseSessionState(row)
    return {
      sessionId: row.id,
      memberCount: row.member_count,
      maxMembers: COOP_MAX_MEMBERS,
      bossHP: state?.boss?.currentHP ?? null,
      bossMaxHP: state?.boss?.maxHP ?? null,
      tick: row.current_tick,
      full: row.member_count >= COOP_MAX_MEMBERS,
    }
  })
}

function questCompleted(saveObject, questId) {
  if (!questId) return true
  const completed = saveObject?.completedQuests
  if (Array.isArray(completed)) return completed.includes(questId)
  if (completed && typeof completed === 'object') return !!completed[questId]
  return false
}

/**
 * Joins a character into the fullest open instance of a boss, creating one when
 * every instance is full (or none exists). Snapshots the character's save into
 * the session and takes the save lock.
 */
export async function joinCoopSession(env, { characterId, identityId, bossId, username }, now = Date.now()) {
  if (!isCoopBoss(bossId)) throw new GameApiError('INVALID_COOP_BOSS', 'Boss is not available co-operatively', 400)

  const existing = await activeSessionIdFor(env, characterId)
  if (existing) {
    const row = await readSession(env, existing)
    if (row?.status === 'active') return { sessionId: existing, rejoined: true }
    await env.DB.prepare('UPDATE characters SET active_coop_session_id = NULL WHERE id = ?').bind(characterId).run()
  }

  const { saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, identityId)
  const monster = monstersData[bossId]
  if (!questCompleted(saveObject, monster?.questRequirement)) {
    throw new GameApiError('QUEST_REQUIRED', 'Quest requirement not met', 403)
  }

  const member = createCoopMember({ characterId, username, savePayload: saveObject, itemsData, now })

  // The session snapshot becomes the authority on this character's inventory
  // and equipment until they leave, so bump the revision now: any save the
  // idle client had in flight is stale from this point on.
  await writeSave(env, characterId, saveObject, saveRevision)

  // Claiming a slot races other joiners: the optimistic UPDATE fails if the
  // session ticked or filled up in between, so re-pick and try again. Bounded,
  // and never re-runs the writeSave above — its revision is already spent.
  let sessionId = null
  for (let attempt = 0; attempt < JOIN_ATTEMPTS && sessionId === null; attempt++) {
    const open = await listOpenSessions(env, bossId, now)
    const target = open.find((s) => !s.full)

    if (!target) {
      const fresh = addCoopMember(createCoopBossState(bossId, monstersData, now), member)
      const res = await env.DB.prepare(
        `INSERT INTO coop_boss_sessions (boss_id, status, member_count, created_at, current_tick, state_json, last_tick_at)
         VALUES (?, 'active', 1, ?, 0, ?, ?)`,
      ).bind(bossId, now, JSON.stringify(fresh), now).run()
      sessionId = res.meta.last_row_id
      break
    }

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

  const lock = await env.DB.prepare(
    'UPDATE characters SET active_coop_session_id = ? WHERE id = ? AND active_coop_session_id IS NULL',
  ).bind(sessionId, characterId).run()
  if (!lock.meta.changes) throw new GameApiError('CHARACTER_IN_COOP_SESSION', 'Already in a boss fight', 409)

  await env.DB.prepare(
    `INSERT INTO coop_session_members (session_id, character_id, joined_at, left_at)
     VALUES (?, ?, ?, NULL)
     ON CONFLICT(session_id, character_id) DO UPDATE SET joined_at = excluded.joined_at, left_at = NULL`,
  ).bind(sessionId, characterId, now).run()

  await auditLog(env, 'coop.session.join', { sessionId, characterId, bossId }, { swallow: true })
  return { sessionId, rejoined: false }
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

/** Writes a member's session state (supplies, HP, XP) back onto their save. */
export function applyMemberToSave(saveObject, member) {
  const next = { ...saveObject }
  next.inventory = Array.isArray(member.inventory) ? member.inventory.map((s) => (s ? { ...s } : null)) : []
  next.equipment = Object.fromEntries(
    Object.entries(member.equipment || {}).map(([slot, item]) => [slot, item ? { ...item } : null]),
  )
  applyXpGainedToSave(next, member.xpGained)
  if (next.player && typeof next.player === 'object') {
    next.player = { ...next.player, currentHP: Math.max(0, member.hp) }
  } else {
    next.player = { currentHP: Math.max(0, member.hp) }
  }
  return next
}

/**
 * Persists one member's fight results and releases their save lock. Loot for a
 * kill is granted separately (settleCoopKill) so a member leaving mid-fight can
 * never be handed drops.
 */
export async function writeBackMember(env, { characterId, identityId, member, sessionId }) {
  const { saveObject, saveRevision } = await loadCharacterWithSave(env, characterId, identityId)
  const next = applyMemberToSave(saveObject, member)
  const write = await writeSave(env, characterId, next, saveRevision)
  await env.DB.prepare(
    'UPDATE characters SET active_coop_session_id = NULL WHERE id = ? AND active_coop_session_id = ?',
  ).bind(characterId, sessionId).run()
  return write
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
    const sessionUpdate = remaining > 0
      ? env.DB.prepare('UPDATE coop_boss_sessions SET state_json = ?, member_count = ? WHERE id = ?')
        .bind(JSON.stringify(nextState), remaining, sessionId)
      : env.DB.prepare(
        "UPDATE coop_boss_sessions SET state_json = ?, member_count = ?, status = 'completed', ended_at = ? WHERE id = ?",
      ).bind(JSON.stringify(nextState), remaining, now, sessionId)
    await env.DB.batch([
      sessionUpdate,
      env.DB.prepare(
        'UPDATE coop_session_members SET left_at = ? WHERE session_id = ? AND character_id = ? AND left_at IS NULL',
      ).bind(now, sessionId, characterId),
    ])
  } else {
    await env.DB.prepare(
      'UPDATE characters SET active_coop_session_id = NULL WHERE id = ? AND active_coop_session_id = ?',
    ).bind(characterId, sessionId).run()
  }

  await auditLog(env, 'coop.session.leave', { sessionId, characterId, bossId: row.boss_id }, { swallow: true })
  return { ok: true }
}

/**
 * Grants a kill's loot to the top-damage member, server-side: rolls the boss's
 * drop table, settles it onto that character's save, and records the
 * collection-log slots, kill count and audit row — the same authoritative
 * side-effects /api/actions/monster/complete performs for a solo kill.
 */
export async function settleCoopKill(env, { session, state, kill }, now = Date.now()) {
  const ownerId = kill?.ownerCharacterId
  if (!ownerId) return { granted: [], ownerCharacterId: null }
  const member = state.members?.[String(ownerId)]
  if (!member) return { granted: [], ownerCharacterId: null }

  const ownerRow = await env.DB.prepare('SELECT owner_id FROM characters WHERE id = ?').bind(ownerId).first()
  if (!ownerRow) return { granted: [], ownerCharacterId: null }

  const rewards = rollMonsterRewardsById(session.boss_id, Math.random, false)
  const { saveObject, saveRevision } = await loadCharacterWithSave(env, ownerId, ownerRow.owner_id)
  // The owner is still fighting, so their live session supplies/XP must land in
  // the same write as the loot — otherwise whichever write lands second wins and
  // silently discards the other.
  const withSession = applyMemberToSave(saveObject, member)
  const settled = settleActionCompletion(withSession, { sourceType: 'monsters', sourceId: session.boss_id, rewards })
  await writeSave(env, ownerId, withSession, saveRevision)

  // The winner keeps fighting, and their session inventory is what gets written
  // back when they eventually leave — so drops that landed in the pack have to
  // rejoin the session here, or leaving would overwrite them away. XP is banked
  // by the write above, so clear it rather than granting it twice.
  member.inventory = Array.isArray(withSession.inventory) ? withSession.inventory.map((s) => (s ? { ...s } : null)) : []
  member.xpGained = {}

  const grantedItemIds = [...new Set((settled.granted || []).map((g) => g?.itemId).filter(Boolean))]
  const logged = grantedItemIds.filter((itemId) => isValidEntry('monsters', session.boss_id, itemId))
  if (logged.length > 0) {
    await env.DB.batch(
      logged.map((itemId) =>
        env.DB.prepare(
          `INSERT INTO collection_log (character_id, item_id, source_type, source_id, obtained_at)
           VALUES (?, ?, 'monsters', ?, ?)
           ON CONFLICT(character_id, item_id, source_type, source_id) DO NOTHING`,
        ).bind(ownerId, itemId, session.boss_id, now),
      ),
    )
  }

  const kcRow = await env.DB.prepare(
    `INSERT INTO kill_counts (character_id, source_type, source_id, kill_count, updated_at)
     VALUES (?, 'monsters', ?, 1, ?)
     ON CONFLICT(character_id, source_type, source_id)
     DO UPDATE SET kill_count = kill_count + 1, updated_at = excluded.updated_at
     RETURNING kill_count`,
  ).bind(ownerId, session.boss_id, now).first()

  await auditLog(env, 'coop.boss.kill', {
    sessionId: session.id,
    bossId: session.boss_id,
    ownerCharacterId: ownerId,
    granted: settled.granted?.length ?? 0,
    collectionLog: logged,
    contributors: (kill.contributors || []).map((c) => ({ characterId: c.characterId, damage: c.damage })),
  }, { swallow: true })

  return {
    ownerCharacterId: ownerId,
    granted: settled.granted || [],
    collectionLogEntries: logged.map((itemId) => ({ itemId, sourceType: 'monsters', sourceId: session.boss_id })),
    killCount: Math.max(0, Math.floor(Number(kcRow?.kill_count) || 0)),
  }
}
