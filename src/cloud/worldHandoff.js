// Who owns the save while the open world is running.
//
// The world opens in a NEW TAB (utils/helpers.js openWorld), so the idle game
// keeps running behind it: every tick writes IndexedDB, and every IDB write
// stamps LOCAL_WRITE_MARKER_KEY (db/stores.js). The world meanwhile grants what
// the player earned straight to the cloud save (world/server/grants.ts) — it is
// the only writer, because /api/save is locked for the whole session.
//
// Those two facts collide on the next boot. isLocalWriteNewerThanCloud() exists
// so a cloud pull can't clobber a local change the debounced push hasn't sent
// yet — but after a world session the "newer" local state is the PRE-world save,
// and the cloud copy is the one holding the world's XP, drops and gear. Letting
// local win there discards a Wilderness kill's whole loot pile and then pushes
// the loss over the top of it with a fresh revision, permanently.
//
// So: from the moment a handoff token is minted, the cloud is authoritative for
// this device. The flag clears the instant either side of that is settled — we
// adopted the cloud copy, or /api/save accepted a push (which can only happen
// when no world session holds the lock, i.e. nothing else owns the save).
//
// No imports on purpose: this is read from both cloud/sync.js and
// utils/helpers.js, and sync.js already imports helpers.js (CLAUDE.md §12 — a
// cycle here is a top-level TDZ throw that whites out the whole bundle).

const WORLD_HANDOFF_KEY = 'pocketrpg_worldHandoffAt'

/** Called when a world handoff token is minted — before the tab even opens, so
 * a player who closes it mid-load is still covered. */
export function markWorldHandoff() {
  try { localStorage.setItem(WORLD_HANDOFF_KEY, String(Date.now())) } catch { /* non-fatal */ }
}

export function clearWorldHandoff() {
  try { localStorage.removeItem(WORLD_HANDOFF_KEY) } catch { /* non-fatal */ }
}

/** True while the world may have written this character's save since we last
 * agreed with the cloud. Deliberately not time-boxed: a session can last hours,
 * and the two clears above are both positive proof, which a timeout is not. */
export function hasPendingWorldHandoff() {
  try { return Boolean(localStorage.getItem(WORLD_HANDOFF_KEY)) } catch { return false }
}
