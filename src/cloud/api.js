// Thin fetch wrapper over the Cloudflare Pages Functions API.
// Token + selected character ID live in localStorage so they survive reloads.

const TOKEN_KEY = 'pocketrpg_cloud_token'
const CHARACTER_KEY = 'pocketrpg_cloud_character_id'
const CHARACTER_NAME_KEY = 'pocketrpg_cloud_character_name'
// Tracks which character's data currently occupies IndexedDB on this device.
// Used to detect "I switched characters but IDB still holds the old one" and
// wipe before loading, so characters never bleed into each other.
const LOCAL_CHARACTER_KEY = 'pocketrpg_local_character_id'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export function getCharacterId() {
  const v = localStorage.getItem(CHARACTER_KEY)
  return v ? parseInt(v, 10) : null
}

export function setCharacter(id, username) {
  if (id) {
    localStorage.setItem(CHARACTER_KEY, String(id))
    if (username) localStorage.setItem(CHARACTER_NAME_KEY, username)
  } else {
    localStorage.removeItem(CHARACTER_KEY)
    localStorage.removeItem(CHARACTER_NAME_KEY)
  }
}

export function getCharacterName() {
  return localStorage.getItem(CHARACTER_NAME_KEY)
}

export function getLocalCharacterId() {
  const v = localStorage.getItem(LOCAL_CHARACTER_KEY)
  return v ? parseInt(v, 10) : null
}

export function setLocalCharacterId(id) {
  if (id) localStorage.setItem(LOCAL_CHARACTER_KEY, String(id))
  else localStorage.removeItem(LOCAL_CHARACTER_KEY)
}

export function clearAuth() {
  setToken(null)
  setCharacter(null)
}

// Pull a `#token=...` fragment dropped by the OAuth callback redirect into
// localStorage and clean the URL bar.
export function captureTokenFromHash() {
  if (!window.location.hash) return false
  const match = window.location.hash.match(/[#&]token=([^&]+)/)
  if (!match) return false
  setToken(decodeURIComponent(match[1]))
  history.replaceState(null, '', window.location.pathname + window.location.search)
  return true
}

async function request(path, options = {}) {
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
    throw err
  }
  return body
}

export const api = {
  me: () => request('/api/auth/me'),
  listCharacters: () => request('/api/characters'),
  createCharacter: (username) => request('/api/characters', {
    method: 'POST',
    body: JSON.stringify({ username }),
  }),
  getSave: () => request('/api/save'),
  putSave: (save_data, hash) => request('/api/save', {
    method: 'PUT',
    body: JSON.stringify({ save_data, hash }),
  }),
}

export function startGitHubLogin() {
  window.location.href = '/api/auth/github'
}

export function startGoogleLogin() {
  window.location.href = '/api/auth/google'
}
