// Client wrapper for /api/pvp/* endpoints. Same auth+character header
// pattern as cloud/api.js — relies on getToken() and getCharacterId() so
// nothing here cares about the underlying transport.
//
// Phase 1 only ships the lobby (waiting + invitations). Match endpoints
// arrive in Phase 3 and will live in this same file.

import { getToken, getCharacterId, clearAuth } from './api.js'

async function pvpRequest(path, options = {}) {
  const headers = new Headers(options.headers || {})
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const characterId = getCharacterId()
  if (characterId && !headers.has('X-Character-Id')) {
    headers.set('X-Character-Id', String(characterId))
  }

  const res = await fetch(path, { ...options, headers })
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

export const pvpApi = {
  // Waiting room
  joinWaiting: () => pvpRequest('/api/pvp/waiting', { method: 'POST', body: '{}' }),
  leaveWaiting: () => pvpRequest('/api/pvp/waiting', { method: 'DELETE' }),
  listWaiting: () => pvpRequest('/api/pvp/waiting'),

  // Invitations
  listInvitations: () => pvpRequest('/api/pvp/invitations'),
  sendInvitation: (toCharacter) => pvpRequest('/api/pvp/invitations', {
    method: 'POST',
    body: JSON.stringify({ to_character: toCharacter }),
  }),
  acceptInvitation: (id) => pvpRequest(`/api/pvp/invitations/${id}/accept`, { method: 'POST', body: '{}' }),
  declineInvitation: (id) => pvpRequest(`/api/pvp/invitations/${id}/decline`, { method: 'POST', body: '{}' }),
  cancelInvitation: (id) => pvpRequest(`/api/pvp/invitations/${id}`, { method: 'DELETE' }),
}
