// Leaving the world by walking away from the tab.
//
// The world opens in its own tab and holds this character's save lock for as
// long as its socket is open (functions/_lib/game/worldSessions.js), so a player
// who switches back to the idle game without closing the world tab blocks every
// cloud save indefinitely — the socket stays healthy, the server never sees a
// close, and the linger grace period never starts. So the tab going hidden is
// treated as leaving: after this long we depart for real (the server flushes the
// pack/XP and releases the lock at once) and reconnect when the player returns.
//
// Short enough that switching to the idle game frees the save almost
// immediately; long enough that a glance at another app, a notification, or an
// OS share sheet doesn't cost the player their fight.
export const AWAY_DISCONNECT_MS = 10_000

export interface AwayWatchOptions {
  isHidden: () => boolean
  /** Leave the world now: tell the server, then close without reconnecting. */
  depart: () => void
  /** The player came back: reconnect and re-enter at the checkpoint. */
  resume: () => void
  delayMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface AwayWatch {
  /** Call on every visibilitychange (and once on setup). */
  onVisibilityChange: () => void
  /** True while we have deliberately left because the tab went away. */
  isAway: () => boolean
}

/** Arms the away timer while the tab is hidden and cancels it the moment the
 * player comes back, so only a real absence departs. Pure but for the injected
 * timer/visibility hooks, which is what makes it testable. */
export function createAwayWatch(options: AwayWatchOptions): AwayWatch {
  const delay = options.delayMs ?? AWAY_DISCONNECT_MS
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let timer: unknown = null
  let away = false

  return {
    isAway: () => away,
    onVisibilityChange(): void {
      if (options.isHidden()) {
        if (away || timer !== null) return
        timer = setTimer(() => {
          timer = null
          away = true
          options.depart()
        }, delay)
        return
      }
      if (timer !== null) {
        clearTimer(timer)
        timer = null
      }
      if (!away) return
      away = false
      options.resume()
    },
  }
}
