/**
 * Compute the elapsed-idle window when the page returns from a hidden state.
 *
 * Picks the most authoritative reading available:
 *   1. Cloud server-stamped (serverNow - lastActiveAt) — immune to local
 *      clock manipulation AND cannot be paused by mobile tab suspension.
 *   2. Cloud client wall-clock (Date.now() - lastActiveAt) when the server
 *      didn't echo serverNow back — paired with the rollback-watermark guard.
 *   3. Same-session: the larger of the perf-clock diff and the wall-clock
 *      diff. Mobile browsers (notably iOS Safari) pause performance.now()
 *      when the JS runtime is suspended, so a short perf-clock reading
 *      doesn't actually mean little time passed. The wall-clock fallback is
 *      clamped by the rollback watermark to defend against clock-set-back
 *      attacks.
 *   4. Pure local wall-clock as the last resort.
 *
 * The result is capped at MAX_OFFLINE_MS (24 h) to limit cross-session clock
 * manipulation.
 *
 * @param {object} input
 * @param {number} input.now                — Date.now() at return
 * @param {number} input.perfNow            — performance.now() at return
 * @param {number|null} input.hiddenAt      — Date.now() captured on hide
 * @param {number|null} input.hiddenAtPerf  — performance.now() captured on hide
 * @param {number|null} input.cloudServerNow      — server-stamped now
 * @param {number|null} input.cloudLastActiveAt   — server-stamped last active
 * @param {number} input.clockWatermark     — highest Date.now() ever observed
 * @param {number} [input.maxOfflineMs]     — cap (default 24 h)
 */
export function computeIdleElapsedMs({
  now,
  perfNow,
  hiddenAt,
  hiddenAtPerf,
  cloudServerNow = null,
  cloudLastActiveAt = null,
  clockWatermark = 0,
  maxOfflineMs = 24 * 60 * 60 * 1000,
}) {
  const clampWatermark = (ms) => {
    if (ms <= 0) return 0
    if (clockWatermark > 0 && now < clockWatermark) return 0
    return ms
  }

  let elapsed = 0

  if (Number.isFinite(cloudServerNow) && Number.isFinite(cloudLastActiveAt) && cloudServerNow && cloudLastActiveAt) {
    elapsed = Math.max(0, cloudServerNow - cloudLastActiveAt)
  } else if (Number.isFinite(cloudLastActiveAt) && cloudLastActiveAt) {
    elapsed = clampWatermark(Math.max(0, now - cloudLastActiveAt))
  } else {
    const wallDiff = Number.isFinite(hiddenAt) && hiddenAt
      ? Math.max(0, now - hiddenAt)
      : 0
    const perfDiff = Number.isFinite(hiddenAtPerf) && hiddenAtPerf !== null && Number.isFinite(perfNow) && perfNow >= hiddenAtPerf
      ? Math.floor(perfNow - hiddenAtPerf)
      : 0
    if (hiddenAtPerf !== null && Number.isFinite(hiddenAtPerf)) {
      // Same session: if perf.now() paused (mobile suspend), wall-clock is
      // higher and reflects the real elapsed window. Trust the larger reading
      // but keep the watermark guard against clock-set-back.
      elapsed = Math.max(perfDiff, clampWatermark(wallDiff))
    } else {
      elapsed = clampWatermark(wallDiff)
    }
  }

  return Math.min(Math.max(0, Math.floor(elapsed)), maxOfflineMs)
}
