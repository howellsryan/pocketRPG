// The idle game's pending kill counts, batched onto the save push.
//
// A kill count is worth having for every monster, but the idle game must not
// grow a cloud write per kill (§6). So kills accumulate here and ride the save
// PUT as a side channel — exactly like the declared loss ledger, and for the
// same reason: nothing is stored in the blob, so the save format and the no-op
// key are untouched. The save push already happens on the combat heartbeat, on
// tab-hide and on every critical save, so the counts land without a single
// extra request.
//
// Window semantics mirror lossLedger.js in one respect and deliberately part
// company in another: settled by SUBTRACTION on a successful push (kills made
// while that push was on the wire belong to the next one) and retained on a
// failure — but NOT reset when a server copy is adopted. The ledger describes
// the very blob the server replaced; these counts live in their own D1 table,
// which adopting a save supersedes nothing about, and no /api/save refusal
// banks them. Resetting on every adopt threw away the kills the co-op lock
// preserves for the pull that follows a fight, and — boot being the same
// pull-then-adopt — everything a closing tab left in localStorage.
//
// It IS reset on a save_revision CONFLICT (sync.js), the only signal that a
// full write landed unseen and already banked what is still sitting here, and
// on logout / character switch via resetSyncState. Specifically that code —
// the bank-wipe rejection classifies as a conflict too and refused the write
// outright, so it banked nothing and the tally is simply what is still owed.
// That covers the revision-bumping write and nothing else: an idle-ceiling or
// no-op reply banks kills without moving the revision, so a lost response there
// is re-sent and counted twice. Closing that needs an idempotency key on the
// report, not another client-side rule.
//
// A tally the server failed to write is a different case and IS reported back:
// the kill_counts write is swallowed rather than failing an otherwise good
// save, and the reply carries killsApplied: false so this survives the ok.
//
// What may be reported at all is decided by killCountReports.js, not here.
import { filterReportableKills, MAX_REPORTED_KILLS_PER_MONSTER, MAX_REPORTED_MONSTERS } from './killCountReports.js'

const KILL_TALLY_STORAGE_KEY = 'pocketrpg_kill_tally'

// A save window kills a handful of distinct monsters. A bound on malformed
// state; overflow simply stops tallying, which under-counts rather than
// corrupting anything. Deliberately the SERVER's bound (killCountReports.js) —
// tallying more than one report can carry would silently drop the overflow.

let killTally = new Map()
let killTallyHydrated = false

function persistKillTally() {
  if (typeof localStorage === 'undefined') return
  try {
    if (killTally.size === 0) localStorage.removeItem(KILL_TALLY_STORAGE_KEY)
    else localStorage.setItem(KILL_TALLY_STORAGE_KEY, JSON.stringify(Object.fromEntries(killTally)))
  } catch { /* non-fatal: the tally is best-effort, never a correctness need */ }
}

// A reload drops module state but not the kills it described, so the tally is
// read back once on first use.
function hydrateKillTally() {
  if (killTallyHydrated) return
  killTallyHydrated = true
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(KILL_TALLY_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return
    for (const [monsterId, count] of Object.entries(parsed)) addKills(monsterId, count)
  } catch { /* corrupt entry: start clean rather than fail the boot */ }
}

function addKills(monsterId, count) {
  const n = Math.floor(Number(count) || 0)
  if (n <= 0) return false
  if (!killTally.has(monsterId) && killTally.size >= MAX_REPORTED_MONSTERS) return false
  // Clamped on the ACCUMULATED total, not per call: the server clamps what it
  // accepts the same way, and settling subtracts what was sent — so tallying
  // past the ceiling would drop the difference instead of carrying it.
  const next = Math.min((killTally.get(monsterId) || 0) + n, MAX_REPORTED_KILLS_PER_MONSTER)
  if (next === killTally.get(monsterId)) return false
  killTally.set(monsterId, next)
  return true
}

/**
 * Record kills of one monster. Filtered here as well as on the server so the
 * ledger never fills with entries the server will refuse — a boss or a
 * logged-drop monster is counted by its own authoritative completion.
 */
export function recordKills(monsterId, count = 1) {
  const reportable = filterReportableKills({ [monsterId]: count })
  const n = reportable[monsterId]
  if (!n) return
  hydrateKillTally()
  if (addKills(monsterId, n)) persistKillTally()
}

/** Records a daily-task game event's kills, if it describes any. One hook
 * covers live kills, idle catch-up and skip-hour, because all three already
 * report through the same event bus. */
export function recordKillsFromGameEvent(evt) {
  if (!evt || (evt.kind !== 'monster_kill' && evt.kind !== 'boss_kill')) return
  recordKills(evt.monsterId, evt.count ?? 1)
}

/** Everything tallied since the server last took a write, or null when there is
 * nothing — null rather than {} so the push omits the field entirely. */
export function readKillTally() {
  hydrateKillTally()
  if (killTally.size === 0) return null
  return Object.fromEntries(killTally)
}

/** A push carrying `shipped` landed. Subtract rather than clear: kills made
 * while it was on the wire belong to the next save's tally. */
export function settleKillTally(shipped) {
  if (!shipped || typeof shipped !== 'object') return
  hydrateKillTally()
  for (const [monsterId, count] of Object.entries(shipped)) {
    const remaining = (killTally.get(monsterId) || 0) - Math.floor(Number(count) || 0)
    if (remaining > 0) killTally.set(monsterId, remaining)
    else killTally.delete(monsterId)
  }
  persistKillTally()
}

/** Drop the tally — on a save-revision conflict, logout, or character switch.
 * NOT on adopting a server copy: see the window semantics at the top. */
export function resetKillTally() {
  killTallyHydrated = true
  killTally = new Map()
  persistKillTally()
}
