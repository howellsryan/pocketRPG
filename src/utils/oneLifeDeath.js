// Shared One-Life death helpers. Used by direct combat death (CombatScreen)
// and by idle/skip death (App, gameState).
//
// The One-Life reset is a SINGLE, ATOMIC, all-or-nothing flow. The server
// endpoint (`/api/characters/reset-one-life`) deletes the save, idle state,
// collection log, AND trading post offers, then recreates a fresh character
// with the same login + name — all inside one D1 batch transaction. There is
// deliberately NO partial fallback: a half-completed reset (e.g. deleting only
// the save) would leave the cloud character and its trading post escrow
// recoverable, letting a dead one-life player keep items. We retry the atomic
// reset until it succeeds and only then wipe the device.
import { api, clearAuth, getToken, setLocalCharacterId } from '../cloud/api.js'
import { closeDB } from '../db/database.js'
import { wipeLocalSave } from '../db/saveload.js'
import { clearCollectionLogCache } from '../cloud/collectionLog.js'

// Treat "this character id no longer exists / is not one-life" as proof the
// atomic server reset already committed — covers a retry after a committed
// request whose response was lost. (After a successful reset the old id is
// gone, so the endpoint answers 404; a non-one-life id answers 400.)
//
// Be precise about the 400: the endpoint returns 400 for BOTH "not one-life"
// AND "Missing X-Character-Id header". The latter is a transient/client error,
// NOT proof the reset ran — accepting it would let wipeLocalState() blow away
// the device while the cloud one-life character (and its trading-post escrow)
// survives, the half-finished reset this flow exists to prevent. So a 400 only
// counts as "already reset" when the message confirms the not-one-life case.
export function isAlreadyReset(err) {
  const status = err?.status
  const msg = String(err?.message || '')
  if (status === 404) return true
  return /not found|not one-life/i.test(msg)
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Retry the atomic server reset with exponential backoff (2s, 4s, 8s, 16s).
// Resolves once the reset is confirmed (or proven already done); rejects only
// after every attempt fails with a transient error.
export async function resetOneLifeWithRetry({
  doReset = () => api.resetOneLife(),
  attempts = 5,
  baseDelayMs = 2000,
  sleep = wait,
} = {}) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      await doReset()
      return
    } catch (err) {
      if (isAlreadyReset(err)) return
      lastErr = err
      if (i < attempts - 1) await sleep(baseDelayMs * 2 ** i)
    }
  }
  throw lastErr
}

// Wipe device-local state. Only runs after the cloud account is provably reset.
async function wipeLocalState() {
  try {
    closeDB()
    await wipeLocalSave()
  } catch (err) { console.error('Failed to wipe local save:', err) }
  // Purge the in-memory collection-log cache + pending drop buffer so the
  // recreated character can't display (or re-flush) the dead character's log.
  // The server reset already deletes the collection_log rows; this clears the
  // matching client state, mirroring logout / force-restart.
  try { clearCollectionLogCache() } catch { /* ignore */ }
  try {
    localStorage.removeItem('pocketrpg_activeCombatSpell')
    localStorage.removeItem('pocketrpg_offline_mode')
    setLocalCharacterId(null)
  } catch { /* ignore */ }
  clearAuth()
}

export async function performOneLifeReset() {
  // Authoritative, atomic server wipe FIRST — retry or throw, never a partial
  // backout. Offline/local-only players have no cloud character or trading
  // post, so the local wipe alone is sufficient when there is no token.
  if (getToken()) {
    await resetOneLifeWithRetry()
  }
  await wipeLocalState()
}

let resetInFlight = false

// Trigger the visible One-Life death flow. The server-side wipe runs FIRST —
// only after the cloud account is gone do we wipe the device and redirect, so a
// browser refresh during the confirmation can't cancel the death. If the wipe
// can't reach the server we keep retrying in the background and do NOT restore
// control, so the dead character (and its offers) can never be used.
export async function triggerOneLifeDeath(addToast) {
  if (resetInFlight) return
  resetInFlight = true
  try {
    await performOneLifeReset()
    if (addToast) addToast('You died — account wiped.', 'error')
    setTimeout(() => { window.location.href = '/' }, 1500)
  } catch (err) {
    console.error('One-life reset failed; retrying in the background:', err)
    if (addToast) addToast('Connection lost — finishing reset. Keep the app open.', 'error')
    const retry = async () => {
      try {
        await performOneLifeReset()
        if (addToast) addToast('Account wiped.', 'error')
        setTimeout(() => { window.location.href = '/' }, 1000)
      } catch {
        setTimeout(retry, 15000)
      }
    }
    setTimeout(retry, 15000)
  } finally {
    resetInFlight = false
  }
}
