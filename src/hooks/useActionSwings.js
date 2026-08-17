import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { SWING_MAX_MS, EAT_ANIM_MS, makeConsumeToken } from '../utils/actionSprites.js'

/**
 * Holds the latest swing token per side for a combat stage (InkwrightCombatStage
 * today, ActionSpriteStage before it was deleted), and — the whole point — LETS
 * IT GO once its motion is over.
 *
 * A token that outlives its animation is a loaded gun: the stage replays a
 * motion whenever its element remounts or its classes are re-added, so a held
 * token fires a phantom swing on the next auto-restart, boss respawn, target
 * switch or re-render that happens to toggle a class. Expiring the token is one
 * fix for that entire family, and it means no caller needs an `idle` flag or a
 * reset effect — a side that is not swinging simply has no token.
 *
 * `SWING_MAX_MS` is the longest any motion can be (actionSprites clamps to it),
 * so clearing there can never truncate one. Timers are cleared on unmount, the
 * same discipline as the hit-splat timers alongside them.
 */
export function useActionSwings() {
  const [swings, setSwings] = useState({ player: null, monster: null })
  const timersRef = useRef(new Set())

  useEffect(() => () => {
    for (const t of timersRef.current) clearTimeout(t)
    timersRef.current.clear()
  }, [])

  /** Feed one tick's swings. A side with no swing this tick keeps whatever it
   * had until that token expires on its own. Stable, so a screen may close over
   * it in a tick/beat callback without re-subscribing every render. */
  const pushSwings = useCallback((next) => {
    if (!next || (!next.player && !next.monster)) return
    setSwings(prev => ({
      player: next.player || prev.player,
      monster: next.monster || prev.monster,
    }))
    for (const side of ['player', 'monster']) {
      const swing = next[side]
      if (!swing) continue
      const timer = setTimeout(() => {
        timersRef.current.delete(timer)
        // Only clear the token this timer was armed for — a newer swing on the
        // same side owns the slot now and has its own timer coming.
        setSwings(prev => (prev[side]?.id === swing.id ? { ...prev, [side]: null } : prev))
      }, SWING_MAX_MS)
      timersRef.current.add(timer)
    }
  }, [])

  return { swings, pushSwings }
}

/**
 * Same expiring-token shape as useActionSwings, single slot: holds the
 * actor's latest "eating/drinking" gesture token and lets it go once its
 * animation is over (EAT_ANIM_MS, not SWING_MAX_MS — the gesture has its own
 * fixed duration, see actionSprites.js). A held token would replay the
 * gesture on the next unrelated remount, same failure mode as a held swing.
 */
export function useConsumeToken() {
  const [token, setToken] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const pushConsume = useCallback(() => {
    const next = makeConsumeToken()
    setToken(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setToken(prev => (prev?.id === next.id ? null : prev))
    }, EAT_ANIM_MS)
  }, [])

  return { token, pushConsume }
}
