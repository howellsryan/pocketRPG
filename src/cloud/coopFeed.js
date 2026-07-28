// One co-op fight's live connection, from the client's side.
//
// The screen used to own a poll loop: ask the room for the beat, render it,
// work out when the next beat is due, ask again. That cost a request per member
// per 600ms — a Pages invocation, a JWT verification and a `characters` read
// each — and it could only ever arrive after the beat it wanted, so the fight
// was always a round trip stale and clumped when the aim drifted.
//
// Now the room pushes. This module owns the socket, the ticket that opens it,
// the reconnects, and — when a socket cannot be had at all — the old poll loop
// as a fallback, because Pages and the world Worker deploy separately (§20) and
// a Worker without the socket action is a routine state, not an outage.

import { coopApi } from './coop.js'
import { wsUrl } from './apiBase.js'
import { nextPollDelayMs } from '../utils/coopPolling.js'
import {
  COOP_SOCKET_IDLE_TIMEOUT_MS,
  COOP_SOCKET_MAX_ATTEMPTS,
  COOP_SOCKET_PING_MS,
  applyProjectionDelta,
  coopSocketBackoffMs,
  isFatalCoopSocketReason,
  isRejoinableCoopCloseReason,
} from '../engine/coopSocketProtocol.js'

/** A failed poll backs off rather than hammering. */
const POLL_ERROR_BACKOFF_MS = 2000
/** An intent the room never answers resolves empty rather than rejecting: the
 * screen's optimistic echo has its own time backstop, and a false "Action
 * failed" toast for an action that probably landed is worse than silence. */
const INTENT_ACK_TIMEOUT_MS = 5000
/**
 * Statuses that mean this SESSION is no longer this player's: the room let them
 * go while they were away (403), the fight ended (404), or something else owns
 * them now (409). None of them is fixed by asking again — but none of them is a
 * reason to strand the player on an error screen either, so they end the feed
 * through `onLost` and the caller rejoins.
 */
const LOST_STATUSES = new Set([403, 404, 409])
/** A dead end proper. 401 means the login went, and rejoining would only fail
 * the same way. */
const FATAL_STATUSES = new Set([401])

/**
 * Connects to a fight and streams it.
 *
 * `onTick` fires once per delivered beat with the whole projected state (the
 * deltas are applied here, so callers never see the wire format) and the events
 * belonging to it. `onStatus` carries a transient connection message, or null
 * when healthy. `onLost` means this session has moved on without the player and
 * the caller should put them back in a fight; `onFatal` is the genuine dead end.
 */
export function openCoopFeed({ sessionId, onTick, onStatus, onLost, onFatal }) {
  let stopped = false
  let socket = null
  let attempts = 0
  let polling = false
  let state = null
  let sinceTick = null
  let pollTimer = null
  let pingTimer = null
  let idleTimer = null
  let reconnectTimer = null
  let intentSeq = 0
  const awaitingAck = new Map()

  const clearTimer = (t) => { if (t) clearTimeout(t) }

  function stopSocketTimers() {
    if (pingTimer) clearInterval(pingTimer)
    pingTimer = null
    clearTimer(idleTimer)
    idleTimer = null
  }

  function teardown() {
    stopSocketTimers()
    clearTimer(pollTimer)
    clearTimer(reconnectTimer)
    pollTimer = null
    reconnectTimer = null
    for (const entry of awaitingAck.values()) {
      clearTimer(entry.timer)
      entry.resolve({})
    }
    awaitingAck.clear()
    if (socket) {
      const ws = socket
      socket = null
      try { ws.close(1000, 'client_exit') } catch { /* already gone */ }
    }
  }

  function fatal(message) {
    if (stopped) return
    stopped = true
    teardown()
    onFatal?.(message)
  }

  /** The room has moved on without this player. Nothing here is retryable, so
   * stop cleanly and let the caller decide how to get them back into a fight. */
  function lost(reason) {
    if (stopped) return
    stopped = true
    teardown()
    onLost?.(reason)
  }

  function endedBy(err) {
    if (FATAL_STATUSES.has(err?.status)) {
      fatal(err?.message || 'This fight has ended.')
      return true
    }
    if (LOST_STATUSES.has(err?.status)) {
      lost(err?.body?.code || err?.message || 'not_a_member')
      return true
    }
    return false
  }

  function deliver(nextState, events, tick) {
    state = nextState
    if (Number.isFinite(tick)) sinceTick = tick
    onStatus?.(null)
    onTick?.({ state, events: events || [] })
  }

  // ---- socket transport -----------------------------------------------------

  function armIdleWatchdog() {
    clearTimer(idleTimer)
    // The room pushes on every beat of a live fight and answers every ping, so
    // this much silence is not a quiet fight — it is a socket that died without
    // telling anybody, which is the normal shape of a phone changing network.
    idleTimer = setTimeout(() => {
      if (socket) try { socket.close(4000, 'idle') } catch { /* already gone */ }
    }, COOP_SOCKET_IDLE_TIMEOUT_MS)
  }

  function onFrame(raw) {
    armIdleWatchdog()
    let frame
    try { frame = JSON.parse(raw) } catch { return }
    switch (frame?.t) {
      case 'sync':
        attempts = 0
        deliver(frame.state || null, frame.events, frame.tick)
        return
      case 'tick':
        deliver(applyProjectionDelta(state, frame.delta), frame.events, frame.tick)
        return
      case 'ack':
      case 'nack': {
        const entry = awaitingAck.get(frame.id)
        if (!entry) return
        awaitingAck.delete(frame.id)
        clearTimer(entry.timer)
        if (frame.t === 'ack') entry.resolve({ tick_number: frame.tick_number })
        // The status is carried so a refusal reads the same as it did over
        // HTTP — a rate-limited message has to stay "slow down", not become the
        // raw error code.
        else entry.reject(Object.assign(new Error(frame.error || 'Action failed'), { status: frame.status || 400 }))
        return
      }
      case 'bye':
        // The room is finished with this socket. Whether that is the end of the
        // fight or just this connection is the reason's to say.
        if (isRejoinableCoopCloseReason(frame.reason)) lost(frame.reason)
        else if (isFatalCoopSocketReason(frame.reason)) fatal('This fight has ended.')
        return
      default:
    }
  }

  async function connectSocket() {
    if (stopped) return
    let ticket
    try {
      ticket = (await coopApi.socketTicket(sessionId))?.ticket
    } catch (err) {
      if (endedBy(err)) return
      scheduleRetry()
      return
    }
    if (stopped) return
    if (!ticket) {
      startPolling()
      return
    }

    const params = new URLSearchParams({ ticket })
    if (Number.isFinite(sinceTick)) params.set('sinceTick', String(sinceTick))
    let ws
    try {
      ws = new WebSocket(wsUrl(`/api/coop/session/${sessionId}/socket?${params}`))
    } catch {
      startPolling()
      return
    }
    socket = ws

    ws.addEventListener('open', () => { armIdleWatchdog() })
    ws.addEventListener('message', (event) => { if (socket === ws) onFrame(event.data) })
    ws.addEventListener('close', () => {
      if (socket !== ws || stopped) return
      socket = null
      stopSocketTimers()
      // The attempt budget is only spent on connections that never delivered a
      // beat: `sync` resets it, so a socket that worked for an hour and then
      // dropped gets the full budget again rather than inheriting an old count.
      scheduleRetry()
    })

    pingTimer = setInterval(() => {
      if (socket !== ws) return
      try { ws.send(JSON.stringify({ t: 'ping' })) } catch { /* the close handler has it */ }
    }, COOP_SOCKET_PING_MS)
  }

  function scheduleRetry() {
    if (stopped || polling) return
    if (attempts >= COOP_SOCKET_MAX_ATTEMPTS) {
      startPolling()
      return
    }
    const wait = coopSocketBackoffMs(attempts)
    attempts += 1
    onStatus?.('Reconnecting…')
    reconnectTimer = setTimeout(() => { void connectSocket() }, wait)
  }

  // ---- polling fallback -----------------------------------------------------

  function startPolling() {
    if (stopped || polling) return
    polling = true
    stopSocketTimers()
    void poll()
  }

  async function poll() {
    if (stopped) return
    const sentAt = Date.now()
    try {
      const res = await coopApi.tick(sessionId, sinceTick ?? undefined)
      if (stopped) return
      deliver(res.state ?? state, res.events, res.current_tick)
      pollTimer = setTimeout(poll, nextPollDelayMs(res.next_tick_in_ms, Date.now() - sentAt))
    } catch (err) {
      if (stopped) return
      if (endedBy(err)) return
      onStatus?.(err?.message || 'Connection problem — retrying…')
      pollTimer = setTimeout(poll, POLL_ERROR_BACKOFF_MS)
    }
  }

  // ---- actions --------------------------------------------------------------

  function send(action) {
    if (stopped) return Promise.resolve({})
    if (!polling && socket && socket.readyState === 1) {
      intentSeq += 1
      const id = intentSeq
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          awaitingAck.delete(id)
          resolve({})
        }, INTENT_ACK_TIMEOUT_MS)
        awaitingAck.set(id, { resolve, reject, timer })
        try {
          socket.send(JSON.stringify({ t: 'intent', id, action }))
        } catch (err) {
          awaitingAck.delete(id)
          clearTimer(timer)
          reject(err instanceof Error ? err : new Error('Action failed'))
        }
      })
    }
    return coopApi.sendAction(sessionId, action)
  }

  void connectSocket()

  return {
    send,
    close() {
      if (stopped) return
      stopped = true
      teardown()
    },
    /** Which transport is actually carrying the fight — for tests and for the
     * connection notice, never for game logic. */
    isPolling: () => polling,
  }
}
