// Client half of GET /api/bootstrap — the single request that replaces the
// six a signed-in boot used to make (/api/auth/me, /api/kill-counts,
// /api/hard-mode, /api/daily-tasks, /api/idle, /api/activity-progress).
//
// Two properties this module exists to hold:
//
// 1. Every sub-object the endpoint returns is byte-identical to the endpoint it
//    replaces, so the SAME mappers run over both. That is why `fetchBootstrap`
//    imports `mapKillCountEntries`/`mapHardModeEntries` rather than re-deriving
//    them — bootstrap and the fallback fan-out cannot drift apart.
// 2. Idle state and activity progress are read inside `loadGame`, not here, so
//    they are handed to their modules' single-use primes rather than returned.
//
// Failure is never fatal: a null return means the caller runs the legacy
// fan-out. That path stays wired because a client can reach a deploy that
// predates this route — an edge-cached page against a rolled-back Worker, or a
// native shell whose bundle ships ahead of the server it talks to.

import { api, getToken, getCharacterId } from './api.js'
import { mapKillCountEntries } from './killCounts.js'
import { mapHardModeEntries } from './hardMode.js'
import { primeIdleState } from './idleState.js'
import { primeActivityProgress } from './activityProgress.js'

/**
 * One round trip for the whole boot.
 *
 * Returns `{ me, killCounts, hardModeKeys, dailyTasks }` and primes the idle /
 * activity-progress caches as a side effect, or `null` if the request failed
 * for any reason — including a 404 from a server without this route.
 */
export async function fetchBootstrap() {
  if (!getToken() || !getCharacterId()) return null
  let res
  try {
    res = await api.getBootstrap()
  } catch (err) {
    if (err?.status !== 401) console.warn('[bootstrap] fetch failed', err)
    return null
  }
  // An identity-only answer is legitimate for a caller with no character
  // selected, but this function is only ever called with one — so getting it
  // back means the header didn't resolve, and the character-scoped fields are
  // ABSENT rather than empty. Falling through to the fan-out is the only safe
  // reading: mapping them anyway would hand the caller empty mirrors, and
  // syncHardModeTargets([]) wipes the Hard Mode switch that scales the boss the
  // combat screen auto-starts (§4) while the server keeps paying doubled rates.
  if (!res || !res.identity || !res.character) return null

  // Primed before returning, so a caller that awaits this call has both ready
  // by the time loadGame asks for them. Both assignments are unconditional: a
  // response missing one of these fields must CLEAR that prime, not leave an
  // older one standing for the next reader to pick up.
  primeIdleState(res.idle ? {
    lastActiveAt: res.idle.idle?.lastActiveAt ?? null,
    activeTask: res.idle.idle?.activeTask ?? null,
    serverNow: typeof res.idle.serverNow === 'number' ? res.idle.serverNow : null,
  } : null)
  primeActivityProgress(res.activityProgress?.progress ?? null)

  return {
    me: { identity: res.identity, character: res.character, stripe_links: res.stripe_links, stripe_skus: res.stripe_skus },
    killCounts: mapKillCountEntries(res.killCounts),
    hardModeKeys: mapHardModeEntries(res.hardMode),
    dailyTasks: res.dailyTasks ?? null,
  }
}
