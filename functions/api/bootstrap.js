// Everything a signed-in boot needs, in one invocation.
//
// A boot used to issue nine requests — /api/auth/me, /api/characters,
// /api/save, /api/kill-counts, /api/hard-mode, /api/daily-tasks,
// /api/collection-log, /api/idle, /api/activity-progress — six of which re-ran
// the same `characters` ownership SELECT before doing their own work. That is
// six JWT verifies, six Worker invocations and six redundant D1 reads to
// assemble one screen.
//
// This route is read-only aggregation: same `requireAuth`, same ownership
// predicate, no new mutation and no value moved (§14). The one write it can
// cause is the lazy daily-task issuance /api/daily-tasks already performs; the
// credit grant stays where §14 puts it, in /api/daily-tasks/complete.
//
// Every sub-object below is byte-identical to what the endpoint it replaces
// returns, so the client feeds bootstrap and its fallback fan-out through ONE
// set of mappers. Change a shape here and you must change it there.
//
// /api/save and /api/collection-log are deliberately NOT folded in: the save
// blob is large and carries its own revision protocol, and the collection log
// is large and already fire-and-forget behind a client cache.

import { requireAuth, json } from '../_lib/auth.js'
import {
  identityStatement, characterStatement, mapIdentity, mapCharacter,
  STRIPE_LINKS, STRIPE_SKUS,
} from '../_lib/identityPayload.js'
import { utcDayKey, nextResetMs, ensureDailyTasks } from '../_lib/game/dailyTasks.js'
import {
  killCountsStatement, mapKillCounts,
  hardModeTargetsStatement,
  slayerTaskBlocksStatement,
  idleStateStatement, mapIdleState,
  activityProgressStatement, mapActivityProgress,
} from '../_lib/game/characterReads.js'
import { mapHardModeTargets } from '../_lib/game/hardMode.js'
import { mapSlayerTaskBlocks } from '../_lib/game/slayerTaskBlocks.js'

function requestedCharacterId(request) {
  const url = new URL(request.url)
  const idStr = request.headers.get('X-Character-Id') || url.searchParams.get('character_id')
  if (!idStr) return null
  const id = parseInt(idStr, 10)
  return Number.isFinite(id) ? id : null
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const characterId = requestedCharacterId(request)

  // Round trip 1: who is asking, and do they own this character. The character
  // row IS the ownership check — nothing character-scoped is read until it
  // comes back non-null.
  const identityOnly = characterId === null
  const [identityRes, characterRes] = await env.DB.batch(
    identityOnly
      ? [identityStatement(env, auth.identity.id)]
      : [identityStatement(env, auth.identity.id), characterStatement(env, characterId, auth.identity.id)],
  ).then((r) => [r[0], r[1] ?? null])

  const identity = mapIdentity(auth.identity, identityRes?.results?.[0])
  const character = mapCharacter(characterRes?.results?.[0])

  const base = { identity, character, stripe_links: STRIPE_LINKS, stripe_skus: STRIPE_SKUS }

  // No character selected is a legitimate state (the picker calls /api/auth/me
  // in exactly this shape), so it is an identity-only answer rather than a 400.
  if (identityOnly) return json(base)
  // A character id that resolves to nothing the caller owns is the same 404
  // every character-scoped endpoint gives, and no character-scoped table is
  // touched on the way out.
  if (!character) return json({ error: 'Character not found' }, 404)

  // Round trip 2: the four independent per-character reads, batched.
  const [killCountsRes, hardModeRes, slayerBlocksRes, idleRes, activityRes] = await env.DB.batch([
    killCountsStatement(env, characterId),
    hardModeTargetsStatement(env, characterId),
    slayerTaskBlocksStatement(env, characterId),
    idleStateStatement(env, characterId),
    activityProgressStatement(env, characterId),
  ])

  // The client uses (serverNow - lastActiveAt) as the authoritative
  // elapsed-since-active window for offline idle progress, so a player changing
  // their device clock can't inflate idle rewards. Stamped AFTER the read that
  // produced lastActiveAt, never before: a serverNow from earlier than the row
  // it is compared against could widen the window rather than narrow it.
  const serverNow = Date.now()

  // Daily tasks are the one part of this response that can WRITE (lazy
  // issuance), and they were non-fatal before this route existed
  // (`api.getDailyTasks().catch(() => null)`). Kept non-fatal: a flaky
  // issuance must not cost the caller the other five payloads and send the
  // whole boot back to the fan-out.
  const dateKey = utcDayKey()
  let dailyRows = null
  try {
    dailyRows = await ensureDailyTasks(env, characterId, dateKey)
  } catch (err) {
    console.error('[PocketRPG][bootstrap] daily task issuance failed', {
      characterId, message: (err && (err.message || String(err))) || 'unknown',
    })
  }

  return json({
    ...base,
    killCounts: { entries: mapKillCounts(killCountsRes) },
    hardMode: { entries: mapHardModeTargets(hardModeRes) },
    slayerTaskBlocks: { entries: mapSlayerTaskBlocks(slayerBlocksRes) },
    idle: { idle: mapIdleState(idleRes), serverNow },
    activityProgress: { progress: mapActivityProgress(activityRes) },
    dailyTasks: dailyRows && {
      date: dateKey,
      resetInMs: nextResetMs(),
      tasks: dailyRows.map((r) => ({
        slot: r.slot,
        taskId: r.task_id,
        tier: r.tier,
        target: r.target,
        progress: r.progress,
        completed: !!r.completed_at,
      })),
    },
  })
}
