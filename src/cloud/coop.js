// Client wrapper for /api/coop/* (co-operative boss fights). Same auth +
// character-header pattern as cloud/pvp.js.

import { getToken, getCharacterId, clearAuth } from './api.js'
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
export function setActiveCoopSession(sessionId) { activeCoopSessionId = sessionId ?? null }
export function getActiveCoopSession() { return activeCoopSessionId }

export const coopApi = {
  listBosses: () => coopRequest('/api/coop/bosses'),
  join: (bossId) => coopRequest('/api/coop/join', { method: 'POST', body: JSON.stringify({ bossId }) }),
  readSession: (sessionId) => coopRequest(`/api/coop/session/${sessionId}`),
  tick: (sessionId) => coopRequest(`/api/coop/session/${sessionId}/tick`, { method: 'POST', body: '{}' }),
  sendAction: (sessionId, action) => coopRequest(`/api/coop/session/${sessionId}/intent`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  }),
  leave: (sessionId) => coopRequest(`/api/coop/session/${sessionId}/leave`, { method: 'POST', body: '{}' }),
}
