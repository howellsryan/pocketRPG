// Thin fetch wrapper over the Cloudflare Pages Functions API.
// Token + selected character ID live in localStorage so they survive reloads.

import { apiUrl } from './apiBase.js'

const TOKEN_KEY = 'pocketrpg_cloud_token'
const CHARACTER_KEY = 'pocketrpg_cloud_character_id'
const CHARACTER_NAME_KEY = 'pocketrpg_cloud_character_name'
// Tracks which character's data currently occupies IndexedDB on this device.
// Used to detect "I switched characters but IDB still holds the old one" and
// wipe before loading, so characters never bleed into each other.
const LOCAL_CHARACTER_KEY = 'pocketrpg_local_character_id'
const ACTIVE_MATCH_EVENT = 'pocketrpg:pvp-active-match'
export const SAVE_REVISION_EVENT = 'pocketrpg:cloud-save-revision'
export const CREDITS_UPDATED_EVENT = 'pocketrpg:credits-updated'

function emitActiveMatchConflict(matchId = null) {
  if (typeof window === 'undefined') return
  const parsed = Number(matchId)
  const safeMatchId = Number.isFinite(parsed) && parsed > 0 ? parsed : null
  window.dispatchEvent(new CustomEvent(ACTIVE_MATCH_EVENT, { detail: { matchId: safeMatchId } }))
}

function emitSaveRevision(revision) {
  if (typeof window === 'undefined') return
  const parsed = Number(revision)
  if (!Number.isFinite(parsed) || parsed < 0) return
  window.dispatchEvent(new CustomEvent(SAVE_REVISION_EVENT, { detail: { saveRevision: parsed } }))
}

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

export function setCharacter(id, username, isIronman = null, isOneLife = null) {
  const asBool = (value) => value === true || value === 1 || value === '1' || value === 'true'
  if (id) {
    localStorage.setItem(CHARACTER_KEY, String(id))
    if (username) localStorage.setItem(CHARACTER_NAME_KEY, username)
    if (isIronman != null) localStorage.setItem('pocketrpg_ironman_mode', String(asBool(isIronman)))
    if (isOneLife != null) localStorage.setItem('pocketrpg_one_life_mode', String(asBool(isOneLife)))
  } else {
    localStorage.removeItem(CHARACTER_KEY)
    localStorage.removeItem(CHARACTER_NAME_KEY)
    localStorage.removeItem('pocketrpg_ironman_mode')
    localStorage.removeItem('pocketrpg_one_life_mode')
  }
}

export function getIronmanMode() {
  const v = localStorage.getItem('pocketrpg_ironman_mode')
  return v === 'true' || v === '1'
}

export function getOneLifeMode() {
  const v = localStorage.getItem('pocketrpg_one_life_mode')
  return v === 'true' || v === '1'
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
    if (res.status === 409 && body?.error === 'character_in_active_match') {
      emitActiveMatchConflict(body?.match_id ?? body?.matchId ?? body?.active_match_id ?? null)
    }
    const err = new Error(body?.error || `Request failed (${res.status})`)
    err.status = res.status
    err.body = body
    throw err
  }
  const responseSaveRevision = Number.isFinite(body?.save_revision)
    ? body.save_revision
    : (Number.isFinite(body?.save?.save_revision) ? body.save.save_revision : null)
  if (responseSaveRevision != null) emitSaveRevision(responseSaveRevision)
  return body
}

export const api = {
  me: () => request('/api/auth/me'),
  listCharacters: () => request('/api/characters'),
  createCharacter: (username, isIronman = false, isOneLife = false) => request('/api/characters', {
    method: 'POST',
    body: JSON.stringify({ username, is_ironman: isIronman, is_one_life: isOneLife }),
  }),
  purchaseItem: (itemId, quantity = 1, unlockedMinigameItems = []) => request('/api/purchase', {
    method: 'POST',
    body: JSON.stringify({ item_id: itemId, quantity, unlocked_minigame_items: unlockedMinigameItems }),
  }),
  skipHour: () => request('/api/skip-hour', {
    method: 'POST',
    body: JSON.stringify({}),
  }),
  slayerSkip: () => request('/api/slayer/skip', {
    method: 'POST',
    body: JSON.stringify({}),
  }),
  getSave: () => request('/api/save'),
  putSave: (save_data, options = {}) => request('/api/save', {
    method: 'PUT',
    body: JSON.stringify({
      save_data,
      save_revision: Number.isFinite(options?.saveRevision) ? options.saveRevision : 0,
    }),
  }),
  getCollectionLog: () => request('/api/collection-log'),
  postCollectionLog: (entries) => request('/api/collection-log', {
    method: 'POST',
    body: JSON.stringify({ entries }),
  }),
  getKillCounts: () => request('/api/kill-counts'),
  getIdle: () => request('/api/idle'),
  putIdle: (activeTask) => request('/api/idle', {
    method: 'PUT',
    body: JSON.stringify({ active_task: activeTask == null ? null : JSON.stringify(activeTask) }),
  }),
  deleteSave: () => request('/api/save', { method: 'DELETE' }),
  deleteAccount: () => request('/api/auth/account', { method: 'DELETE' }),
  deleteIdle: () => request('/api/idle', { method: 'DELETE' }),
  resetOneLife: () => request('/api/characters/reset-one-life', { method: 'POST', body: JSON.stringify({}) }),

  completeRaid: (sourceId, payload = {}) => request('/api/actions/raid/complete', { method: 'POST', body: JSON.stringify({ sourceId, ...payload }) }),
  completeClue: (sourceId, payload = {}) => request('/api/actions/clue/complete', { method: 'POST', body: JSON.stringify({ sourceId, ...payload }) }),
  completeMinigame: (sourceId, payload = {}) => request('/api/actions/minigame/complete', { method: 'POST', body: JSON.stringify({ sourceId, ...payload }) }),
  completeSlayer: (sourceId, payload = {}) => request('/api/actions/slayer/complete', { method: 'POST', body: JSON.stringify({ sourceId, ...payload }) }),
  completeDungeoneering: (sourceId, payload = {}) => request('/api/actions/dungeoneering/complete', { method: 'POST', body: JSON.stringify({ sourceId, ...payload }) }),
  completeMonster: (sourceId, payload = {}) => request('/api/actions/monster/complete', { method: 'POST', body: JSON.stringify({ sourceId, ...payload }) }),

  createStripeSession: (sku, characterId) => request('/api/stripe/create-session', {
    method: 'POST',
    body: JSON.stringify({ sku, character_id: characterId || 0 }),
  }),

  tradingPostList: (offerType, itemId, price, quantity) => request('/api/trading-post/list', {
    method: 'POST',
    body: JSON.stringify({ offer_type: offerType, item_id: itemId, price, quantity }),
  }),
  tradingPostCancel: (offerId) => request('/api/trading-post/cancel', {
    method: 'POST',
    body: JSON.stringify({ offer_id: offerId }),
  }),
  tradingPostInstantSell: (offerId) => request('/api/trading-post/instant-sell', {
    method: 'POST',
    body: JSON.stringify({ offer_id: offerId }),
  }),
  tradingPostCollect: (offerId) => request('/api/trading-post/collect', {
    method: 'POST',
    body: JSON.stringify({ offer_id: offerId }),
  }),
  tradingPostMyOffers: () => request('/api/trading-post/my-offers'),
  tradingPostSearch: (itemIds) => request('/api/trading-post/search', {
    method: 'POST',
    body: JSON.stringify({ item_ids: itemIds }),
  }),
  tradingPostSellImmediate: (itemId, quantity) => request('/api/trading-post/sell-immediate', {
    method: 'POST',
    body: JSON.stringify({ item_id: itemId, quantity }),
  }),
}

// Fire-and-forget idle state write via navigator.sendBeacon. Survives tab
// hide / page unload on mobile where a regular fetch would be cancelled.
// Returns true if the beacon was queued, false otherwise (caller should fall
// back to api.putIdle in that case).
export function sendIdleBeacon(activeTask) {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false
    const token = getToken()
    const characterId = getCharacterId()
    if (!token || !characterId) return false
    const body = JSON.stringify({
      token,
      character_id: characterId,
      active_task: activeTask == null ? null : JSON.stringify(activeTask),
    })
    const blob = new Blob([body], { type: 'application/json' })
    return navigator.sendBeacon(apiUrl('/api/idle'), blob)
  } catch {
    return false
  }
}

// In the native app, app/native.js installs __pocketrpgNativeLogin to drive the
// system-browser + deep-link flow. On web the hook is absent and we redirect.
export function startGitHubLogin() {
  if (typeof window !== 'undefined' && window.__pocketrpgNativeLogin) {
    window.__pocketrpgNativeLogin('github')
    return
  }
  window.location.href = apiUrl('/api/auth/github')
}

export function startGoogleLogin() {
  if (typeof window !== 'undefined' && window.__pocketrpgNativeLogin) {
    window.__pocketrpgNativeLogin('google')
    return
  }
  window.location.href = apiUrl('/api/auth/google')
}

// Google rejects OAuth sign-in inside embedded/in-app browsers with
// "Error 403: disallowed_useragent" ("Use secure browsers" policy). Detect the
// common in-app webviews so the UI can steer users to a real browser, where
// Google sign-in works. GitHub OAuth is unaffected and still works in webviews.
export function isEmbeddedBrowser() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const inApp = /(FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|Twitter|TikTok|musical_ly|BytedanceWebview|Snapchat|LinkedInApp|Pinterest|MicroMessenger|GSA|; wv\))/i
  if (inApp.test(ua)) return true
  // Generic iOS WKWebView: WebKit + Mobile but no Safari / dedicated-browser token.
  if (/iPhone|iPad|iPod/i.test(ua) && !/Safari/i.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS)/i.test(ua)) {
    return true
  }
  return false
}
