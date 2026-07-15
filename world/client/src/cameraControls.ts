// Desktop camera controls: arrow-key orbit/zoom, middle-mouse drag orbit,
// wheel zoom (absorbing the math that used to live inline in main.ts). Pure
// reducers are exported separately from the DOM wiring so they're testable
// without a browser.
import { clampZoom } from './scene'

export type CamState = { yaw: number; zoom: number }

const YAW_SPEED_RAD_PER_S = 2.2
const ZOOM_KEY_SPEED_PER_S = 0.9
const DRAG_YAW_PER_PIXEL = 0.006
const WHEEL_ZOOM_PER_DELTA = 0.001

export function yawFromKeys(yaw: number, left: boolean, right: boolean, dtSeconds: number): number {
  if (left === right) return yaw
  return yaw + (left ? 1 : -1) * YAW_SPEED_RAD_PER_S * dtSeconds
}

/** ArrowUp zooms in (closer, smaller `zoom`), ArrowDown zooms out. */
export function zoomFromKeys(zoom: number, up: boolean, down: boolean, dtSeconds: number): number {
  if (up === down) return zoom
  return clampZoom(zoom + (up ? -1 : 1) * ZOOM_KEY_SPEED_PER_S * dtSeconds)
}

export function applyWheel(zoom: number, deltaY: number): number {
  return clampZoom(zoom + deltaY * WHEEL_ZOOM_PER_DELTA)
}

export function applyDrag(yaw: number, dxPixels: number): number {
  return yaw - dxPixels * DRAG_YAW_PER_PIXEL
}

/** Fingers spreading (ratio > 1) zooms in — same divide convention the
 * existing pinch handler used before this module absorbed it. */
export function applyPinch(zoom: number, ratio: number): number {
  return clampZoom(zoom / ratio)
}

export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true
  return (el as HTMLElement).isContentEditable === true
}

export type CameraControls = {
  state: CamState
  update(dtSeconds: number): void
  pinch(ratio: number): void
  dispose(): void
}

const ARROW_KEYS: Record<string, 'left' | 'right' | 'up' | 'down'> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

/** Wires arrow-key orbit/zoom, middle-mouse-drag orbit, and wheel zoom onto
 * `canvas`. Wheel/middle-drag are canvas-scoped; keys and drag-release are
 * window-scoped so a drag that leaves the canvas still ends cleanly. */
export function attachCameraControls(canvas: HTMLCanvasElement, initial?: Partial<CamState>): CameraControls {
  const state: CamState = { yaw: initial?.yaw ?? 0, zoom: clampZoom(initial?.zoom ?? 1) }
  const held = { left: false, right: false, up: false, down: false }
  let dragging = false
  let lastX = 0

  function handleKeyDown(event: KeyboardEvent): void {
    const key = ARROW_KEYS[event.key]
    if (!key || isTypingTarget(document.activeElement)) return
    held[key] = true
    event.preventDefault()
  }
  function handleKeyUp(event: KeyboardEvent): void {
    const key = ARROW_KEYS[event.key]
    if (!key) return
    // Always release, even if focus moved to a text input mid-hold — a guard
    // here (mirroring keydown's) would leave the flag stuck true and the
    // camera spinning/zooming forever once focus returns to the canvas.
    held[key] = false
  }
  function handleWheel(event: WheelEvent): void {
    state.zoom = applyWheel(state.zoom, event.deltaY)
    event.preventDefault()
  }
  function handlePointerDown(event: PointerEvent): void {
    if (event.button !== 1) return
    dragging = true
    lastX = event.clientX
    // Kills the browser's native middle-click autoscroll cursor/gesture.
    event.preventDefault()
  }
  function handlePointerMove(event: PointerEvent): void {
    if (!dragging) return
    state.yaw = applyDrag(state.yaw, event.clientX - lastX)
    lastX = event.clientX
  }
  function endDrag(): void {
    dragging = false
  }

  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  canvas.addEventListener('wheel', handleWheel, { passive: false })
  canvas.addEventListener('pointerdown', handlePointerDown)
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)

  return {
    state,
    update(dtSeconds) {
      state.yaw = yawFromKeys(state.yaw, held.left, held.right, dtSeconds)
      state.zoom = zoomFromKeys(state.zoom, held.up, held.down, dtSeconds)
    },
    pinch(ratio) {
      state.zoom = applyPinch(state.zoom, ratio)
    },
    dispose() {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      canvas.removeEventListener('wheel', handleWheel)
      canvas.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    },
  }
}
