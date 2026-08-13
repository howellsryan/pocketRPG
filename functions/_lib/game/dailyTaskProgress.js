// Server-side daily-task progress.
//
// Progress used to live only in the idle client's memory: D1 held 0 until the
// client announced a completion. That works while one tab is the only thing
// killing anything — and breaks the moment a kill happens somewhere the idle
// client cannot see it. The open world runs in its own tab against a Durable
// Object, so a green dragon killed out there could never reach a daily task.
//
// So progress is applied HERE, from game events, against the character's own
// issued rows — the caller never names a progress number, it names what
// happened and this matches it with the same matcher the client uses. Reaching
// the target credits through the same atomic claim /complete uses (§14: the
// credit grant is server-authoritative and idempotent either way).

import { auditLog } from './audit.js'
import { matchTaskProgress, taskById } from '../../../src/engine/dailyTasks.js'
import { ensureDailyTasks, utcDayKey } from './dailyTasks.js'

/** Beyond this a request is not a play session, it is someone hammering the
 * endpoint — the matcher is O(events × 5 tasks) and runs per request. */
const MAX_EVENTS = 200

const EVENT_KINDS = new Set([
  'monster_kill', 'boss_kill', 'raid_complete', 'skill_produce', 'skill_gather',
  'skill_xp', 'clue_complete', 'minigame_complete', 'quest_complete',
  'slayer_task_complete', 'hunter_hunt',
])

/** Keeps only well-formed events, with counts/XP bounded — these arrive from a
 * client on one path and from the world DO on another, and neither is allowed
 * to describe a kill count of 10^9. */
export function normaliseDailyEvents(events) {
  if (!Array.isArray(events)) return []
  const out = []
  for (const evt of events.slice(0, MAX_EVENTS)) {
    if (!evt || typeof evt !== 'object') continue
    if (!EVENT_KINDS.has(evt.kind)) continue
    const clean = { kind: evt.kind }
    for (const field of ['monsterId', 'raidId', 'skill', 'itemId', 'tier', 'minigameId', 'actionId']) {
      if (typeof evt[field] === 'string' && evt[field]) clean[field] = evt[field]
    }
    if (evt.count !== undefined) {
      const count = Math.floor(Number(evt.count) || 0)
      if (count <= 0) continue
      clean.count = Math.min(count, 100000)
    }
    if (evt.xp !== undefined) {
      const xp = Math.floor(Number(evt.xp) || 0)
      if (xp <= 0) continue
      clean.xp = Math.min(xp, 200000000)
    }
    out.push(clean)
  }
  return out
}

/**
 * Flips one issued task from uncredited to credited and pays its credit.
 *
 * `credited = 0` in the WHERE clause is the idempotency point: a replay (or a
 * second writer reaching the target at the same moment) claims nothing and is
 * told so, rather than paying twice.
 */
export async function claimDailyTaskCredit(env, { characterId, identityId, dateKey, slot, taskId, now = Date.now() }) {
  const claimed = await env.DB.prepare(`
    UPDATE character_daily_tasks
       SET progress = target, completed_at = ?1, credited = 1
     WHERE character_id = ?2 AND task_date = ?3 AND slot = ?4
       AND task_id = ?5 AND credited = 0
    RETURNING task_id, tier
  `).bind(now, characterId, dateKey, slot, taskId).first()
  if (!claimed) return { creditsGranted: 0, credits: null }

  const grant = identityId
    ? await env.DB.prepare(
      'UPDATE characters SET credits = credits + 1 WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NULL RETURNING credits',
    ).bind(characterId, identityId).first()
    : await env.DB.prepare(
      'UPDATE characters SET credits = credits + 1 WHERE id = ?1 AND deleted_at IS NULL RETURNING credits',
    ).bind(characterId).first()

  await auditLog(env, 'daily_task.completed', {
    characterId,
    identityId: identityId ?? null,
    taskId,
    tier: claimed.tier,
    credits_remaining: grant?.credits ?? 0,
  }, { swallow: true })

  return { creditsGranted: 1, credits: grant?.credits ?? null }
}

function rowShape(row) {
  return {
    slot: row.slot,
    taskId: row.task_id,
    tier: row.tier,
    target: row.target,
    progress: row.progress,
    completed: !!row.completed_at,
  }
}

/**
 * Applies game events to a character's issued daily tasks.
 *
 * Increments are computed per row and applied as `progress + inc` in SQL so a
 * concurrent writer (the world flushing while the idle tab syncs) composes
 * instead of clobbering. Returns every issued task in its post-write state, so
 * a caller can hand the client an authoritative list rather than a delta it has
 * to reconcile.
 */
export async function applyDailyTaskEvents(env, { characterId, identityId = null, events, dateKey = utcDayKey(), now = Date.now() }) {
  const list = normaliseDailyEvents(events)
  const rows = await ensureDailyTasks(env, characterId, dateKey)
  if (list.length === 0) {
    return { date: dateKey, tasks: rows.map(rowShape), creditsGranted: 0, credits: null }
  }

  const applied = []
  for (const row of rows) {
    if (row.credited) continue
    const def = taskById(row.task_id)
    if (!def) continue
    let inc = 0
    for (const evt of list) inc += matchTaskProgress(def, evt)
    if (inc <= 0) continue
    const target = Math.max(1, Math.floor(Number(row.target) || 1))
    const progress = Math.max(0, Math.floor(Number(row.progress) || 0))
    applied.push({ row, inc, target, next: Math.min(target, progress + inc) })
  }
  if (applied.length === 0) {
    return { date: dateKey, tasks: rows.map(rowShape), creditsGranted: 0, credits: null }
  }

  await env.DB.batch(applied.map(({ row, inc, target }) => env.DB.prepare(`
    UPDATE character_daily_tasks
       SET progress = MIN(?1, progress + ?2)
     WHERE character_id = ?3 AND task_date = ?4 AND slot = ?5 AND credited = 0
  `).bind(target, inc, characterId, dateKey, row.slot)))

  let creditsGranted = 0
  let credits = null
  for (const { row, next, target } of applied) {
    if (next < target) continue
    const claim = await claimDailyTaskCredit(env, {
      characterId, identityId, dateKey, slot: row.slot, taskId: row.task_id, now,
    })
    creditsGranted += claim.creditsGranted
    if (claim.credits !== null) credits = claim.credits
  }

  const refreshed = await env.DB.prepare(
    `SELECT slot, task_id, tier, target, progress, completed_at, credited
       FROM character_daily_tasks
      WHERE character_id = ? AND task_date = ?
      ORDER BY slot`,
  ).bind(characterId, dateKey).all()

  return { date: dateKey, tasks: (refreshed.results || []).map(rowShape), creditsGranted, credits }
}
