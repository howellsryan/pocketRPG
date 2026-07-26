// Client wrapper for /api/coop/* (co-operative boss fights). Same auth +
// character-header pattern as cloud/pvp.js.

import { getToken, getCharacterId, clearAuth, emitSaveRevision } from './api.js'
import { apiUrl } from './apiBase.js'

async function coopRequest(path, options = {}) {
  const headers = new Headers(options.headers || {})
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const characterId = getCharacterId()
  if (characterId && !headers.has('X-Character-Id')) headers.set('X-Character-Id', String(characterId))

  const res = await fetch(apiUrl(path), { ...options, headers })
  if (res.status === 401) {
    clearAuth()
    const err = new Error('Not authenticated')
    err.status = 401
    throw err
  }
  let body = null
  try { body = await res.json() } catch { /* non-JSON */ }
  // Co-op writes the save server-side (the join snapshot, every write-back), so
  // any response carrying a revision re-anchors the save loop. Read on the error
  // path too: a join that fails after its snapshot write still moved it.
  if (Number.isFinite(body?.save_revision)) emitSaveRevision(body.save_revision)
  if (!res.ok) {
    const err = new Error(body?.error || `Request failed (${res.status})`)
    err.status = res.status
    err.body = body
    throw err
  }
  return body
}

// The live session id, mirrored at module scope so App can tell a co-op fight
// is in progress without threading state through every screen. While it is set
// the server owns this character, so client-side progress reporting (the idle
// catch-up modal) must stay out of the way — the same role `pvp.phase ===
// 'in_match'` plays for duels.
let activeCoopSessionId = null
export const COOP_SESSION_EVENT = 'pocketrpg:coop-session'
export function setActiveCoopSession(sessionId) {
  const next = sessionId ?? null
  if (next === activeCoopSessionId) return
  activeCoopSessionId = next
  // Plain module state is invisible to Preact, so a screen reading it during
  // render never re-renders when it changes. The event is what lets App gate on
  // it reactively instead of by luck of the next unrelated render.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(COOP_SESSION_EVENT, { detail: { sessionId: activeCoopSessionId } }))
  }
}
export function getActiveCoopSession() { return activeCoopSessionId }

export const coopApi = {
  listBosses: () => coopRequest('/api/coop/bosses'),
  join: (bossId) => coopRequest('/api/coop/join', { method: 'POST', body: JSON.stringify({ bossId }) }),
  readSession: (sessionId) => coopRequest(`/api/coop/session/${sessionId}`),
  // sinceTick is the last tick this client rendered. The room replays
  // everything after it, so a poll that lands between beats still sees every
  // hit splat, XP drop and kill rather than only the ticks it happened to
  // arrive on.
  tick: (sessionId, sinceTick) => coopRequest(`/api/coop/session/${sessionId}/tick`, {
    method: 'POST',
    body: JSON.stringify(Number.isFinite(sinceTick) ? { sinceTick } : {}),
  }),
  sendAction: (sessionId, action) => coopRequest(`/api/coop/session/${sessionId}/intent`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  }),
  leave: (sessionId) => coopRequest(`/api/coop/session/${sessionId}/leave`, { method: 'POST', body: '{}' }),
}
