import { useEffect } from 'preact/hooks'

/**
 * Calls `handler` whenever the user presses Escape while `enabled` is true.
 * Listener is registered on `keydown` capture-phase so the topmost mounted
 * modal handles it first (most-recently-mounted handler runs last in capture
 * but first in bubble — we use bubble for last-wins behaviour).
 *
 * Pass enabled=false to no-op (e.g. for modals that must not be dismissable).
 */
export function useEscapeKey(handler, enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined
    const onKeyDown = (e) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return
      // Don't dismiss while typing in an input.
      const target = e.target
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      handler(e)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handler, enabled])
}
