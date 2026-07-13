// Shared One-Life death helpers. Used by direct combat death (CombatScreen)
// and by idle/skip death (App, gameState).
//
// One-Life death no longer wipes the account — the server endpoint
// (`/api/characters/reset-one-life`) flips the character's `is_one_life`
// flag off in place and leaves the save, idle state, collection log, kill
// counts and trading post offers untouched. An ironman one-life character
// reverts to a plain Ironman; a normal one-life character reverts to a plain
// normal account. The retry helpers below just make that single flag flip
// resilient to a flaky connection — see `gameState.jsx`'s `revertOneLifeMode`
// for the local-state side (player flags, localStorage) applied once the
// server confirms.
import { api } from '../cloud/api.js'

// Treat "this character is not one-life" as proof the server-side revert
// already committed — covers a retry after a committed request whose
// response was lost, or a second death arriving after an earlier one already
// flipped the flag. (After a successful revert the character answers 400
// "not one-life"; a stale/foreign character id answers 404.)
export function isAlreadyReset(err) {
  const status = err?.status
  const msg = String(err?.message || '')
  if (status === 404) return true
  return /not found|not one-life/i.test(msg)
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Retry the server-side flag flip with exponential backoff (2s, 4s, 8s, 16s).
// Resolves once the revert is confirmed (or proven already done); rejects only
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
