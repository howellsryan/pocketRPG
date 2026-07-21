// Stops the *browser* from zooming the page — double-tap, Safari pinch-gesture,
// and ctrl/⌘+wheel — so a fullscreen game can't get stuck zoomed with no browser
// chrome left to zoom back out. The in-world camera has its own pinch/wheel zoom
// (input.ts, cameraControls.ts); this only kills the native page zoom. iOS
// Safari ignores the viewport's `user-scalable=no`, so these JS guards are what
// actually hold on iPhone/iPad.

export type TapPoint = { t: number; x: number; y: number }

// A native double-tap zoom is two quick taps at ~the same spot. Guarding on
// position as well as time leaves rapid taps on *different* controls (e.g. a HUD
// tab then an item) alone — only a genuine same-spot double-tap is a zoom.
export function isDoubleTap(prev: TapPoint | null, next: TapPoint, maxMs = 350, maxDist = 40): boolean {
  if (!prev) return false
  return next.t - prev.t <= maxMs && Math.hypot(next.x - prev.x, next.y - prev.y) <= maxDist
}

export function preventPageZoom(target: Document = document): () => void {
  let lastTap: TapPoint | null = null

  const onTouchEnd = (e: TouchEvent): void => {
    const t = e.changedTouches[0]
    if (!t) return
    const next: TapPoint = { t: Date.now(), x: t.clientX, y: t.clientY }
    if (isDoubleTap(lastTap, next)) e.preventDefault()
    lastTap = next
  }
  const prevent = (e: Event): void => e.preventDefault()
  // Chrome/Firefox surface trackpad/⌘ pinch as a wheel event with ctrlKey set.
  const onWheel = (e: WheelEvent): void => { if (e.ctrlKey) e.preventDefault() }

  target.addEventListener('touchend', onTouchEnd, { passive: false })
  target.addEventListener('dblclick', prevent)
  target.addEventListener('gesturestart', prevent as EventListener)
  target.addEventListener('gesturechange', prevent as EventListener)
  target.addEventListener('gestureend', prevent as EventListener)
  target.addEventListener('wheel', onWheel as EventListener, { passive: false })

  return () => {
    target.removeEventListener('touchend', onTouchEnd)
    target.removeEventListener('dblclick', prevent)
    target.removeEventListener('gesturestart', prevent as EventListener)
    target.removeEventListener('gesturechange', prevent as EventListener)
    target.removeEventListener('gestureend', prevent as EventListener)
    target.removeEventListener('wheel', onWheel as EventListener)
  }
}
