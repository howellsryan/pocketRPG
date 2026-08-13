// Cloud-save push/pull. Pushes are debounced to once per 120s per character;
// durability between debounce windows comes from critical-save milestones
// (level-up / boss / quest / unlock) and the visibility/unload flush. Every
// mutation still lands in IndexedDB immediately regardless (src/db/stores.js)
// — the boot-time pull below must not clobber that with a stale cloud copy;
// see isLocalWriteNewerThanCloud.

import { api, getToken, getCharacterId, setLocalCharacterId, sendSaveBeacon, SAVE_REVISION_EVENT } from './api.js'
import { buildSavePayloadFromSnapshot, applySavePayload } from '../db/saveload.js'
import { LOCAL_WRITE_MARKER_KEY } from '../db/stores.js'
import { withTimeout } from '../utils/helpers.js'
import { CRITICAL_SAVE_COALESCE_MS, CRITICAL_SAVE_REASONS, normaliseCriticalSaveReason } from './criticalSavePolicy.js'
import { classifySaveError, saveLockCode } from './saveErrors.js'
import { readItemLossLedger, resetItemLossLedger, settleItemLossLedger } from '../engine/lossLedger.js'
import { readKillTally, resetKillTally, settleKillTally } from '../engine/killTally.js'
import { clearWorldHandoff, hasPendingWorldHandoff } from './worldHandoff.js'

const PUSH_DEBOUNCE_MS = 120_000
// Engagement-aware idle throttle. The periodic autosave + activity heartbeat
// are crash-durability BACKSTOPS, not the durability mechanism: live progress
// is mirrored to IndexedDB/localStorage every tick, flushed to the cloud on
// tab-hide/unload, and — on a hard crash — recovered on next boot by idle
// catch-up from the server-stamped last_active_at (which moves atomically with
// the save blob). Genuine milestones (level-up, rare drop, boss/quest/unlock,
// slayer) still push immediately via the critical-save path. So an AFK
// foreground session running an idle grind does NOT need a write every ~2 min —
// it only needs an occasional backstop. We keep the responsive cadence while
// the player is actually interacting and stretch it to ~hourly once idle, which
// is the dominant lever on idle D1 write/read volume.
const ENGAGED_INTERACTION_WINDOW_MS = 90_000
const IDLE_PERIODIC_SAVE_INTERVAL_MS = 3_600_000 // ~1h
// Hard ceiling: once a session has gone this long with no human interaction it
// is an abandoned/forgotten tab. The periodic backstop stops emitting saves
// entirely so it stops hitting the server — live progress is reconstructable on
// return via idle catch-up (itself capped at 24h). Re-arms on the next
// interaction. Mirrors the server-side IDLE_WRITE_CEILING_MS / MAX_OFFLINE_MS.
const IDLE_WRITE_CEILING_MS = 24 * 60 * 60 * 1000
// Last time the player interacted with the page (pointer/key/touch, or a
// tab-foreground transition). Seeded to "now" so a fresh session starts engaged.
let lastInteractionAt = Date.now()
// Grace window for clock skew between this client and the cloud server when
// deciding whether the cloud copy is meaningfully newer than our last push.
const FRESHNESS_GRACE_MS = 5_000
// Hard cap for blocking boot/visibility-time cloud reads. A slow or hung
// endpoint must never trap the user on the loading screen or prevent the
// idle-result modal from appearing — we fall back to local state instead.
const CLOUD_READ_TIMEOUT_MS = 5_000
const LOCK_RETRY_MS = 5_000
// How many consecutive failed pushes we tolerate before declaring the save
// "blocked" — at which point the UI hard-stops play and forces the player to
// retry or log out, rather than letting them keep playing on top of progress
// that is silently failing to persist.
const SAVE_FAILURE_BLOCK_THRESHOLD = 3
// Backoff between automatic retries of a failed push. Scales with the failure
// streak and is capped so a long outage retries on a steady cadence.
const SAVE_RETRY_BACKOFF_MS = 3_000
const MAX_RETRY_BACKOFF_MS = 30_000
export const CLOUD_SAVE_STATUS_EVENT = 'pocketrpg:cloud-save-status'

let lastPushedAt = 0
let lastSaveRevision = 0
// Serialized content of the last *successful* push, with the volatile
// top-level `timestamp` normalized out. The 60s cadence skips the network
// round-trip entirely when the snapshot hasn't actually changed (pure idle /
// AFK tabs), cutting daily DB writes without weakening durability — content
// equal to the last successful push is already on the server.
let lastPushedContentKey = null

// Volatile fields on settings.activeTask that the activity runner mutates on
// EVERY 600ms tick (per-action countdown + live session tallies). They carry no
// durable state the cloud needs — XP/coins/items already live in stats/inventory/
// bank — but if they're left in the dirty-check key, a task merely counting down
// (or an AFK tab with a task running) looks "changed" every tick and defeats the
// no-op skip, so each periodic/heartbeat save writes even when nothing real
// progressed. Neutralise them so only genuine progress (or a task identity
// change) counts as a content change. Task IDENTITY (type/skill/action/…) is
// preserved, so starting/stopping/switching a task still triggers a save.
const VOLATILE_ACTIVE_TASK_FIELDS = ['ticksRemaining', 'pendingTicks', 'totalTicks', 'session']

function normaliseActiveTaskForKey(settings) {
  const activeTask = settings?.activeTask
  if (!activeTask || typeof activeTask !== 'object') return settings
  const trimmed = { ...activeTask }
  for (const f of VOLATILE_ACTIVE_TASK_FIELDS) delete trimmed[f]
  return { ...settings, activeTask: trimmed }
}

// Exported for tests: timestamp-insensitive content key for a save payload.
export function saveContentKey(payload) {
  return JSON.stringify({ ...payload, timestamp: 0, settings: normaliseActiveTaskForKey(payload?.settings) })
}
let pendingTimer = null
let pendingSnapshot = null
// The declared loss ledger AS OF the moment pendingSnapshot was captured. It
// must be pinned with the snapshot, not read at flush time: the snapshot is
// taken on the 60s/120s heartbeat and then sits in the debounce, so a
// flush-time read declares spends the payload does not yet contain — and
// settling drops them, leaving the save that finally carries them looking
// unexplained. That is the exact noise this ledger exists to remove.
let pendingLosses = null
let pendingSaveOptions = {}
let inFlight = false
// Promise for the push currently on the wire. Callers (pushNow, re-entrant
// flushNow) await this so we never abandon a save while the server is still
// responding — the skip-hour durability gate depends on this WAIT.
let inFlightPromise = null
// Consecutive failed pushes since the last success. Drives escalation from a
// soft 'failed' badge to a hard 'blocked' modal.
let consecutiveFailures = 0
let criticalTimer = null
let pendingCriticalSnapshotSource = null
let pendingCriticalReasons = new Set()
let hasUnsyncedChanges = false
// While a critical, all-or-nothing operation (e.g. a paid skip) is mid-flight,
// the game is frozen and we MUST NOT let the autosave cadence or critical-save
// milestones fire competing writes that race the operation's own authoritative
// push — that race is what drove the intermittent save_revision_conflict. The
// operation calls pushNow() directly, which deliberately bypasses this gate.
let savesSuspended = false
let saveSuspendCount = 0
// Set once the server rejects a push with save_revision_conflict — our local
// state has diverged from the authoritative cloud copy. We stop pushing the
// stale snapshot (it only repeats the 409) and let the app roll back to the
// cloud copy. Cleared on resetSyncState / a fresh page boot.
let conflictPending = false
// Which lock refused the last push, or null if the last push wasn't lock-refused.
// A lock is the server saying "something else owns this save right now", not a
// failure — the co-op join path reads this to tell "the room already has me"
// apart from a save that genuinely didn't land.
let lastLockCode = null

if (typeof window !== 'undefined') {
  window.addEventListener(SAVE_REVISION_EVENT, (event) => {
    const revision = Number(event?.detail?.saveRevision)
    if (Number.isFinite(revision) && revision >= 0) {
      lastSaveRevision = revision
    }
  })
}

function emitCloudSaveStatus(status, detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CLOUD_SAVE_STATUS_EVENT, {
    detail: {
      status,
      ...detail,
    },
  }))
}

function markUnsynced() {
  hasUnsyncedChanges = true
  emitCloudSaveStatus('pending')
  emitCloudSaveStatus('out_of_sync')
}

function canSync() {
  return !!getToken() && !!getCharacterId()
}

// Perform the actual network push for the current pendingSnapshot. The caller
// guarantees no other push is in flight. Returns true if the save landed.
async function performPush() {
  const snap = pendingSnapshot
  const losses = pendingLosses
  // Read at SEND time, never captured with the snapshot: the tally is only
  // settled when a push LANDS, so a batch captured while an earlier push was
  // still on the wire still contains that push's kills and would report them
  // twice. Kills need no pairing with the blob the way `losses` does — they
  // land in their own table — so the latest read is always the right one.
  const kills = readKillTally()
  pendingSnapshot = null
  pendingLosses = null
  inFlight = true
  emitCloudSaveStatus('saving')
  try {
    const data = buildSavePayloadFromSnapshot(snap)
    const json = JSON.stringify(data)
    const contentKey = saveContentKey(data)
    // Dirty check: identical to the last successful push → nothing to do, so we
    // never hit the network (and the server therefore never writes). The one
    // exception is a `touch` push (PvP lobby): the match-create guard refuses a
    // save whose updated_at is >15s old, so a lobby-sitting player whose save
    // content hasn't changed still needs the server to bump updated_at. Those
    // pushes skip the dirty check and the server bumps updated_at without
    // rewriting the blob (see save.js no-op branch).
    const wantsTouch = pendingSaveOptions.touch === true
    if (!wantsTouch && contentKey === lastPushedContentKey) {
      pendingSaveOptions = {}
      hasUnsyncedChanges = false
      consecutiveFailures = 0
      lastLockCode = null
      emitCloudSaveStatus('saved', { updatedAt: lastPushedAt || null, skipped: true })
      return true
    }
    // Tell the server whether the player is genuinely engaged (interacted
    // recently). Idle backstop writes carry interactive:false so the server can
    // enforce the idle write ceiling; engaged/manual saves omit it (default
    // interactive) and always persist + refresh the freshness stamp.
    const interactive = isEngaged()
    const res = await api.putSave(json, { ...pendingSaveOptions, saveRevision: lastSaveRevision, interactive, losses, kills })
    // Settle by subtracting what THIS payload declared. Anything spent since it
    // was captured stays on the ledger for the save that will carry it.
    if (losses) settleItemLossLedger(losses)
    if (kills) settleKillTally(kills)
    pendingSaveOptions = {}
    if (res?.updatedAt) lastPushedAt = res.updatedAt
    if (Number.isFinite(res?.save_revision)) lastSaveRevision = res.save_revision
    lastPushedContentKey = contentKey
    hasUnsyncedChanges = false
    consecutiveFailures = 0
    lastLockCode = null
    // The server took our copy, so no world session holds this character's save
    // lock and the cloud has nothing we don't (see worldHandoff.js).
    clearWorldHandoff()
    emitCloudSaveStatus('saved', { updatedAt: res?.updatedAt || null })
    console.log('[PocketRPG] Cloud save pushed, size:', json.length)
    return true
  } catch (err) {
    const kind = classifySaveError(err)
    // A save lock means something else legitimately owns this character right
    // now — a live open-world session or a co-op boss fight — so the companion
    // app and the idle game never write the same save at once.
    // Expected and transient: keep the latest snapshot queued, retry shortly
    // (it clears when the player leaves), and NEVER count it toward the failure
    // streak that escalates to the blocking "save failed" modal.
    if (kind === 'lock') {
      lastLockCode = saveLockCode(err)
      // A co-op room owns this save for the whole fight, and the client re-pulls
      // the server's copy on the way out — it never pushes its own (§20). Keeping
      // this snapshot queued lands the PRE-FIGHT state on top of the room's
      // write-back the instant the lock lifts, taking the fight's XP, supplies
      // and drops with it. Drop it instead: the pull is the source of truth.
      if (lastLockCode === 'CHARACTER_IN_COOP_SESSION') {
        pendingSnapshot = null
        // We are discarding this snapshot for the room's write-back, so the
        // ledger describing it goes too — kept, it would declare against a
        // window the room has already superseded.
        resetItemLossLedger()
        // The kill tally deliberately SURVIVES: those kills happened in the idle
        // game before the room took the save, they live in their own table, and
        // nothing about them is superseded by the room's write-back.
        hasUnsyncedChanges = false
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
        emitCloudSaveStatus('saved', { updatedAt: lastPushedAt || null, skipped: true })
        return false
      }
      pendingSnapshot = snap
      markUnsynced()
      schedulePush(snap, LOCK_RETRY_MS, losses)
      return false
    }
    // save_revision_conflict: our local state diverged from the server's
    // authoritative copy (we got into a bad state — typically progress applied
    // faster than a prior save round-tripped). Re-pushing the same stale
    // snapshot only repeats the 409, so we DROP the pending push, flag the
    // conflict, and emit 'conflict' so the app rolls back to the cloud copy
    // (a fresh GET on the next boot). This is NOT a transient network failure,
    // so it must NOT count toward the failure streak that escalates to the
    // blocking modal, and we must NOT schedule a retry.
    // BANK_WIPE_REJECTED: the server refused a save whose bank collapsed to
    // (near) nothing — our local state is corrupt (a load/migration bug wiped
    // the bank). Re-pushing repeats the 409, so we route it through the SAME
    // rollback path as a revision conflict: flag it, drop the bad snapshot, and
    // emit 'conflict' so the app re-pulls and re-applies the intact cloud copy,
    // restoring the bank instead of retrying the wipe.
    if (kind === 'conflict') {
      conflictPending = true
      pendingSnapshot = null
      pendingLosses = null
      // A stale revision is the only signal we get that a FULL write of ours
      // landed without us seeing the ok: it banked the kills, we settle only on
      // a reply so the tally kept them, and the next push 409s on the revision
      // that write moved. Re-sending would count them twice. Dropped here
      // rather than in applyCloudSave, which also runs on the co-op-exit and
      // boot pulls, where nothing suggests a write landed and the tally is
      // simply the kills still owed.
      //
      // This does NOT cover every lost ok. The idle-ceiling and no-op replies
      // bank kills while leaving the revision alone, so a lost response there
      // raises no conflict and the retry banks them again — an over-count no
      // client-side rule can catch, and the reason the real fix is an
      // idempotency key on the report. Nor is a 409 proof it was us: raised by a
      // foreign writer (a world flush, an action completion) this loses the
      // window's counts instead. Both errors are bounded and invisible, and §14
      // keeps every gated monster off this channel entirely.
      resetKillTally()
      pendingSaveOptions = {}
      hasUnsyncedChanges = false
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
      emitCloudSaveStatus('conflict', { currentRevision: Number(err?.body?.current_revision) })
      return false
    }
    pendingSaveOptions = {}
    // Genuine failure: keep the snapshot queued so the retry re-sends THIS
    // state (never silently drop progress) and track the streak. Once we've
    // failed enough times in a row we escalate to 'blocked', which the UI
    // turns into a hard stop with Retry / Logout.
    pendingSnapshot = snap
    hasUnsyncedChanges = true
    consecutiveFailures++
    const backoff = Math.min(SAVE_RETRY_BACKOFF_MS * consecutiveFailures, MAX_RETRY_BACKOFF_MS)
    console.warn(`[PocketRPG] Cloud push failed (attempt ${consecutiveFailures}):`, err.message)
    if (consecutiveFailures >= SAVE_FAILURE_BLOCK_THRESHOLD) {
      emitCloudSaveStatus('blocked', { error: err?.message || 'cloud_save_failed', failures: consecutiveFailures })
    } else {
      emitCloudSaveStatus('failed', { error: err?.message || 'cloud_save_failed' })
    }
    // Keep retrying in the background regardless of state — if the network
    // recovers, the next success emits 'saved' and the UI lifts the block.
    schedulePush(snap, backoff, losses)
    return false
  } finally {
    inFlight = false
  }
}

async function flushNow() {
  pendingTimer = null
  if (!canSync()) return false
  if (inFlight) {
    // A push is already on the wire. Wait for it to settle rather than bail.
    if (inFlightPromise) { try { await inFlightPromise } catch { /* handled below */ } }
    // If newer data is queued and nothing is scheduled to flush it, push now.
    // A failed push restores its snapshot AND schedules a backoff retry (which
    // sets pendingTimer), so a pending timer means "leave it to the backoff" —
    // don't tight-loop and bypass it.
    if (pendingSnapshot && !inFlight && !pendingTimer) return await flushNow()
    return !hasUnsyncedChanges
  }
  if (!pendingSnapshot) return !hasUnsyncedChanges
  inFlightPromise = performPush()
  try {
    return await inFlightPromise
  } finally {
    inFlightPromise = null
  }
}

function schedulePush(snapshot, delay = PUSH_DEBOUNCE_MS, losses = readItemLossLedger()) {
  pendingSnapshot = snapshot
  pendingLosses = losses
  markUnsynced()
  if (pendingTimer) return
  pendingTimer = setTimeout(flushNow, delay)
}

// Public: schedule a debounced push (called from the 60s tick + idle modal events).
export function schedulePushSave(snapshot) {
  if (!canSync()) return
  if (savesSuspended || conflictPending) return
  schedulePush(snapshot)
}

// Public: record that the player just interacted (pointer/key/touch/foreground).
// Drives the engaged-vs-idle decision in schedulePeriodicSave. Exported for the
// app to forward synthetic interactions if needed; the listeners below cover the
// common cases automatically.
export function noteUserInteraction(at = Date.now()) {
  lastInteractionAt = at
}

function isEngaged(now = Date.now()) {
  return now - lastInteractionAt < ENGAGED_INTERACTION_WINDOW_MS
}

// Public: engagement-aware periodic/heartbeat backstop save. Called on the
// fixed-interval autosave tick and the activity heartbeat. While the player is
// actively interacting it behaves like schedulePushSave (responsive 120s
// debounce). Once the session is idle/AFK it only schedules a push after
// IDLE_PERIODIC_SAVE_INTERVAL_MS has elapsed since the last *successful* write —
// so an idle grind writes at most ~hourly instead of every ~2 min. lastPushedAt
// advances on every successful push (including critical-milestone saves), so an
// idle session that keeps levelling naturally coalesces its backstop with those.
export function schedulePeriodicSave(snapshot) {
  if (!canSync()) return
  if (savesSuspended || conflictPending) return
  const now = Date.now()
  // Phase 1 hard ceiling: an abandoned tab stops emitting periodic saves
  // altogether (the real lever on stale-tab request spam). Re-arms when the
  // player next interacts.
  if (now - lastInteractionAt > IDLE_WRITE_CEILING_MS) return
  if (!isEngaged(now)) {
    if (now - lastPushedAt < IDLE_PERIODIC_SAVE_INTERVAL_MS) return
  }
  schedulePush(snapshot)
}

// Treat genuine user input as engagement. Passive + capture so we observe it
// without interfering with the app's own handlers. A tab returning to the
// foreground also counts — the player is back and may be about to act.
if (typeof window !== 'undefined') {
  const markInteraction = () => { lastInteractionAt = Date.now() }
  for (const evt of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(evt, markInteraction, { passive: true, capture: true })
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) lastInteractionAt = Date.now()
    })
  }
}

// Public: freeze/unfreeze the background save cadence while a critical,
// all-or-nothing operation (paid skip) owns the single in-flight write. The
// operation drives its own durable save via pushNow(), which bypasses this gate.
// Refcounted so nested/overlapping holders are safe: a short blocking op (the
// game lock) can run inside a long one (a co-op boss session, where the server
// owns the save) without the inner resume lifting the outer suspension.
export function suspendSaves() { saveSuspendCount += 1; savesSuspended = true }
export function resumeSaves() {
  saveSuspendCount = Math.max(0, saveSuspendCount - 1)
  savesSuspended = saveSuspendCount > 0
}
export function saveSuspensionDepth() { return saveSuspendCount }
// Public: has the server rejected our state as diverged? The app uses this to
// short-circuit its own save retry loops and trigger a cloud rollback.
export function isSaveConflict() { return conflictPending }
// Public: the lock code behind the last refused push ('CHARACTER_IN_COOP_SESSION',
// …), or null when the last push wasn't lock-refused. Lets a caller that owns the
// lock's own flow continue instead of reading the false return as lost progress.
export function lastSaveLockCode() { return lastLockCode }
// Public: the app finished rolling back to the authoritative cloud copy
// (pullSave + applyCloudSave re-adopted the server's revision) — pushes may
// resume. Only the rollback path should call this.
export function clearSaveConflict() { conflictPending = false }

// Public: bypass the debounce — used on tab-hide / page-unload so we don't
// lose a pending push. Also drains any pending critical save inline, so
// callers that need "everything I've queued is on the server now" (e.g.
// the collection-log POST, which is gated server-side on item ownership)
// can await this and be confident the next request sees the new state.
// Returns true if the save landed on the server, false otherwise — callers
// that gate UI on durable persistence (e.g. the paid skip-hour flow) use
// this to decide whether to reveal rewards or keep retrying.
export async function pushNow(snapshot, options = {}) {
  if (!canSync()) return false
  // Once we've detected a divergence, stop pushing — the app is rolling back to
  // the cloud copy. Any further push would just repeat the 409.
  if (conflictPending) return false
  // `touch: true` (PvP lobby) forces the push through the dirty check so the
  // server can refresh updated_at even when the save content is unchanged.
  if (options && options.touch) pendingSaveOptions = { ...pendingSaveOptions, touch: true }
  // If a push is already on the wire, wait for it to settle before issuing our
  // own. We must never abandon the server mid-response — the paid skip-hour
  // flow awaits this to confirm progress is durable before revealing rewards.
  if (inFlight && inFlightPromise) { try { await inFlightPromise } catch { /* re-attempted below */ } }
  if (snapshot) { pendingSnapshot = snapshot; pendingLosses = readItemLossLedger() }
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }

  // Resolve any pending critical-save snapshot synchronously and feed it
  // through the normal flushNow path. Without this, a critical push
  // queued moments before pushNow() would still be sitting on the
  // criticalTimer when we return.
  if (criticalTimer || pendingCriticalSnapshotSource) {
    if (criticalTimer) { clearTimeout(criticalTimer); criticalTimer = null }
    const source = pendingCriticalSnapshotSource
    pendingCriticalSnapshotSource = null
    pendingCriticalReasons.clear()
    const criticalSnapshot = resolveSnapshotSource(source)
    if (criticalSnapshot) { pendingSnapshot = criticalSnapshot; pendingLosses = readItemLossLedger() }
  }

  return await flushNow()
}

// Public: durably capture the current snapshot on page teardown (refresh /
// close / tab-hide) via navigator.sendBeacon, which survives the unload where a
// normal fetch would be cancelled. This is the reliability guarantee behind the
// relaxed foreground cadence: whatever the debounce hasn't pushed yet is flushed
// here on the way out. Fire-and-forget — we can't read the response — so we skip
// when there's nothing new (content matches the last successful push) and
// otherwise optimistically advance the local revision/content markers assuming
// the beacon lands (the common case). A genuine miss self-heals: the next boot
// pulls a fresh save, and a resumed tab re-anchors the revision via the
// visibility handler's checkCloudNewer. Returns true if a beacon was queued.
export function beaconSaveNow(snapshot) {
  if (!canSync()) return false
  if (conflictPending) return false
  if (!snapshot) return false
  let data
  try { data = buildSavePayloadFromSnapshot(snapshot) } catch { return false }
  const contentKey = saveContentKey(data)
  // Already durably stored by the last successful push — nothing to flush.
  if (contentKey === lastPushedContentKey) return false
  // Teardown saves are player-driven, so mark them interactive: the server then
  // always persists them (never applies the idle write ceiling), which keeps the
  // optimistic +1 revision bump below correct.
  const losses = readItemLossLedger()
  // A push already on the wire read the same tally and has not settled it yet.
  // The revision guard 409s one of the two writes in most cases, but not on the
  // idle-ceiling path — which answers ok without bumping the revision, so both
  // would count. The in-flight push settles them if it lands, and if it dies
  // with the page they simply ride the next session's first save.
  const kills = inFlight ? null : readKillTally()
  const sent = sendSaveBeacon(JSON.stringify(data), { saveRevision: lastSaveRevision, interactive: true, losses, kills })
  if (!sent) return false
  // A beacon's outcome is unreadable, so the ledger is settled on the same
  // optimistic assumption as the revision bump below. A beacon that misses
  // leaves the next push under-declaring, which flags — never the reverse.
  if (losses) settleItemLossLedger(losses)
  if (kills) settleKillTally(kills)
  lastSaveRevision = (Number.isFinite(lastSaveRevision) ? lastSaveRevision : 0) + 1
  lastPushedContentKey = contentKey
  lastPushedAt = Date.now()
  hasUnsyncedChanges = false
  return true
}

// Public: force an immediate save attempt — used by the save-blocked modal's
// "Retry" button. Reuses pushNow (which waits for any in-flight push), so a
// success lifts the block (emits 'saved') and a failure keeps it up.
export async function retrySaveNow(snapshot) {
  return await pushNow(snapshot)
}


function resolveSnapshotSource(source) {
  if (typeof source === 'function') return source()
  return source
}

export function requestCriticalPushSave(snapshotOrFactory, reason = 'critical') {
  if (!canSync()) return false
  if (savesSuspended || conflictPending) return false
  if (!snapshotOrFactory) return false

  pendingCriticalSnapshotSource = snapshotOrFactory
  pendingCriticalReasons.add(normaliseCriticalSaveReason(reason))
  // Credit consumption is now debited server-side by /api/skip-hour and
  // /api/slayer/skip — see Step 1 of the production-readiness rollout.
  // The client no longer self-reports credits_used_increment.
  markUnsynced()

  // Critical milestones should not wait behind the normal 60s autosave timer.
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }

  if (criticalTimer) return true

  criticalTimer = setTimeout(() => {
    criticalTimer = null
    const source = pendingCriticalSnapshotSource
    const reasons = [...pendingCriticalReasons]
    pendingCriticalSnapshotSource = null
    pendingCriticalReasons.clear()

    const snapshot = resolveSnapshotSource(source)
    if (!snapshot) return

    void pushNow(snapshot).catch(err => {
      console.warn('[PocketRPG] Critical cloud save failed:', err?.message || err, { reasons })
    })
  }, CRITICAL_SAVE_COALESCE_MS)

  return true
}

// Public: pull the cloud save for the selected character.
// Returns { applied, payload, updatedAt, readFailed }. Guarded by a timeout so
// a slow/hung endpoint can't trap the boot sequence on the "Loading…" screen.
//
// `readFailed` distinguishes two very different no-payload outcomes that the
// caller MUST treat differently:
//   • readFailed: true  — the read timed out or errored. We do NOT know
//     whether a save exists. Callers must never treat this as "no save" and
//     overwrite the cloud with a fresh character (that is how a transient
//     network blip used to wipe a live account back to level 3).
//   • readFailed: false — the server authoritatively answered and there is no
//     save row yet. Safe to initialise a new game.
// `withTimeout` resolves to the sentinel on BOTH timeout and rejection, so a
// sentinel return unambiguously means the read did not succeed.
export async function pullSave() {
  if (!canSync()) return { applied: false, readFailed: true }
  const READ_FAILED = Symbol('read_failed')
  const res = await withTimeout(api.getSave(), CLOUD_READ_TIMEOUT_MS, READ_FAILED)
  if (res === READ_FAILED) return { applied: false, readFailed: true }
  if (!res || !res.save) return { applied: false, readFailed: false }
  const { save_data, updatedAt, save_revision } = res.save
  if (Number.isFinite(save_revision)) lastSaveRevision = save_revision
  // Record that we've now seen this cloud state even if the caller ends up
  // skipping applyCloudSave (isLocalWriteNewerThanCloud) — otherwise a later
  // checkCloudNewer() would compare against a stale lastPushedAt of 0 and
  // wrongly treat this same save as a newer concurrent-session write.
  if (Number.isFinite(updatedAt)) lastPushedAt = updatedAt
  return { applied: false, payload: JSON.parse(save_data), updatedAt, readFailed: false }
}

// Public: check if the cloud copy is meaningfully newer than the last save we
// pushed/applied. Used by the visibility handler before running idle simulation
// — if another concurrent session has saved while this tab was hidden, we want
// to take that copy instead of overwriting it with stale local idle results.
// Returns the cloud payload to apply, or null if local is up-to-date. Timed
// out so a hung request can't block the idle-result modal from showing.
export async function checkCloudNewer() {
  if (!canSync()) return null
  const res = await withTimeout(api.getSave(), CLOUD_READ_TIMEOUT_MS, null)
  if (!res || !res.save) return null
  const { save_data, updatedAt, save_revision } = res.save
  if (Number.isFinite(save_revision)) lastSaveRevision = save_revision
  if (updatedAt <= lastPushedAt + FRESHNESS_GRACE_MS) return null
  return { payload: JSON.parse(save_data), updatedAt }
}

// Public: apply a previously-pulled cloud save to IDB. Caller decides whether
// to do this based on conflict-resolution UX.
export async function applyCloudSave(payload, updatedAt, saveRevision) {
  await applySavePayload(payload, { restoreLocalIdleMirrors: false })
  // We just adopted the server's holdings, so anything the ledger still claims
  // describes a window the server has already superseded. Carrying it forward
  // would let the next save's real losses hide behind spends that no longer
  // relate to what the server is comparing against.
  resetItemLossLedger()
  // The kill tally is deliberately NOT reset here, unlike the ledger above.
  // The ledger describes this write's holdings and is meaningless against a
  // blob the server has replaced; kill counts live in their own D1 table, which
  // adopting a save supersedes nothing about. Every /api/save path that banks
  // them answers `ok`, and all three refusals return before it — so a rejected
  // write counted nothing and the tally it kept is exactly what still needs
  // sending. Resetting cost the kills the co-op lock branch above deliberately
  // preserves (the client always PULLS on room exit), and, because boot is the
  // same pull-then-adopt, everything a closing tab left in localStorage.
  // Character switch and logout clear it through resetSyncState below.
  if (updatedAt) lastPushedAt = updatedAt
  // We just adopted the server's copy, so its content is already durably stored.
  // Seed the dirty-check key with it: the next autosave / screen-change push of
  // unchanged state is then recognised as a no-op CLIENT-side and never hits the
  // network — closing the gap where the first push after a boot pull or a
  // server-authoritative save would otherwise reach the server and make it write
  // updated_at for nothing.
  try { lastPushedContentKey = saveContentKey(payload) } catch { lastPushedContentKey = null }
  // When the server hands back its authoritative revision (e.g. an action
  // completion / skip that wrote the save server-side), adopt it. Otherwise the
  // next client save would push a stale save_revision and be rejected 409.
  if (Number.isFinite(saveRevision)) lastSaveRevision = saveRevision
  else if (Number.isFinite(updatedAt) && Number.isFinite(lastSaveRevision) === false) lastSaveRevision = 0
  // IDB now holds this character's data — stamp ownership so the next boot
  // knows which character these rows belong to.
  const charId = getCharacterId()
  if (charId) setLocalCharacterId(charId)
  // IDB content now matches this adopted copy — reset the local-write marker
  // so a subsequent boot doesn't mistake this adoption itself for an unsynced
  // local change (see isLocalWriteNewerThanCloud below).
  try { localStorage.setItem(LOCAL_WRITE_MARKER_KEY, String(Date.now())) } catch { /* non-fatal */ }
  // We now hold the server's copy, which includes anything the open world
  // granted — the handoff is settled.
  clearWorldHandoff()
}

// Public: does IndexedDB hold a local write made after the cloud's last known
// save? A fresh page load has no memory of what this device already pushed
// (the lastPushedAt/lastSaveRevision above reset to zero on every reload), so
// without this a boot-time cloud pull always wins over IDB — even when IDB
// holds a just-made change (a settings toggle, a bank tag edit, a world-map
// move) that the debounced/critical push hasn't reached the server yet. The
// local-write marker lives in localStorage, which (unlike the module state
// here) survives the reload. Same clock-skew grace as checkCloudNewer.
export function isLocalWriteNewerThanCloud(cloudUpdatedAt) {
  // The open world runs in its own tab and is the save's only writer while it
  // holds the lock — but this tab kept ticking behind it, so its local writes
  // are newer AND older at once: newer by clock, older by content. The cloud
  // copy wins until we have positively re-agreed with it (worldHandoff.js).
  if (hasPendingWorldHandoff()) return false
  let localWriteAt = 0
  try { localWriteAt = parseInt(localStorage.getItem(LOCAL_WRITE_MARKER_KEY) || '0', 10) } catch { localWriteAt = 0 }
  if (!Number.isFinite(localWriteAt) || localWriteAt <= 0) return false
  return localWriteAt > (Number(cloudUpdatedAt) || 0) + FRESHNESS_GRACE_MS
}

// Reset cached state — call on logout / character switch.
export function resetSyncState() {
  resetItemLossLedger()
  resetKillTally()
  lastPushedAt = 0
  lastSaveRevision = 0
  lastPushedContentKey = null
  lastInteractionAt = Date.now()
  pendingSnapshot = null
  pendingLosses = null
  hasUnsyncedChanges = false
  consecutiveFailures = 0
  inFlightPromise = null
  pendingSaveOptions = {}
  lastLockCode = null
  savesSuspended = false
  saveSuspendCount = 0
  conflictPending = false
  pendingCriticalSnapshotSource = null
  pendingCriticalReasons.clear()
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
  if (criticalTimer) { clearTimeout(criticalTimer); criticalTimer = null }
}
