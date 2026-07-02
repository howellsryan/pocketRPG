import { useRef, useEffect, useCallback } from 'preact/hooks'

/**
 * Shared pan/zoom/pinch controller for full-screen map stages (world map,
 * place maps). Owns the stage/board element refs, the pointer + wheel
 * handlers, and fit/zoom controls; the board is moved with a CSS transform.
 * Extracted verbatim from WorldMapScreen so both maps share one gesture model:
 *  - one-finger drag pans; two fingers pinch-zoom around the finger midpoint
 *  - pointers that start on interactive UI (`uiSelector`) are never captured,
 *    so their taps survive; pinches still reach the stage by bubbling
 *  - `wasGestureClick()` tells a node/spot click handler to swallow the click
 *    that trails a drag or pinch
 *  - fits on mount and whenever the stage resizes
 */
export function usePanZoomStage({ boardW, boardH, uiSelector, minK = 0.35, maxK = 2.2, fitPad = 80 }) {
  const stageRef = useRef(null)
  const boardRef = useRef(null)
  const viewRef = useRef({ x: 0, y: 0, k: 1 })
  const dragRef = useRef(null)
  const pointersRef = useRef(new Map()) // active pointers, for two-finger pinch
  const pinchRef = useRef(null) // { d0, k0, x0, y0, mid0 } while pinching
  const pinchEndedAtRef = useRef(0) // suppress the trailing click on a node/spot

  const applyView = useCallback(() => {
    const board = boardRef.current
    if (!board) return
    const v = viewRef.current
    board.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`
  }, [])

  const clampK = useCallback((k) => Math.max(minK, Math.min(maxK, k)), [minK, maxK])

  const fitAll = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    const kx = (stage.clientWidth - fitPad * 2) / boardW
    const ky = (stage.clientHeight - fitPad * 2) / boardH
    const v = viewRef.current
    v.k = Math.max(minK, Math.min(1, Math.min(kx, ky)))
    v.x = (stage.clientWidth - boardW * v.k) / 2
    v.y = (stage.clientHeight - boardH * v.k) / 2
    applyView()
  }, [applyView, boardW, boardH, minK, fitPad])

  const zoomBy = useCallback((f) => {
    const stage = stageRef.current
    if (!stage) return
    const v = viewRef.current
    const cx = stage.clientWidth / 2
    const cy = stage.clientHeight / 2
    const wx = (cx - v.x) / v.k
    const wy = (cy - v.y) / v.k
    v.k = clampK(v.k * f)
    v.x = cx - wx * v.k
    v.y = cy - wy * v.k
    applyView()
  }, [applyView, clampK])

  // Fit on mount and whenever the stage is resized.
  useEffect(() => {
    fitAll()
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fitAll)
      return () => window.removeEventListener('resize', fitAll)
    }
    const ro = new ResizeObserver(() => fitAll())
    ro.observe(stage)
    return () => ro.disconnect()
  }, [fitAll])

  // ── pan + pinch ──
  const onPointerDown = (e) => {
    const pts = pointersRef.current
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // Never capture a pointer that started on interactive UI (nodes, overlay
    // bars, zoom controls): capture retargets the eventual click to the stage
    // and the tap would die. Pinch moves still reach us by bubbling — the
    // stage fills the screen.
    const onUI = uiSelector ? e.target.closest(uiSelector) : null
    if (!onUI) stageRef.current?.setPointerCapture?.(e.pointerId)
    if (pts.size === 2) {
      // Second finger starts a pinch (even if it lands on a node): freeze the
      // drag and remember the starting view + finger midpoint/spread.
      const [a, b] = [...pts.values()]
      const v = viewRef.current
      dragRef.current = null
      pinchRef.current = {
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        k0: v.k, x0: v.x, y0: v.y,
        mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      }
      return
    }
    if (pts.size > 2 || onUI) return
    const v = viewRef.current
    dragRef.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, moved: 0 }
  }

  const onPointerMove = (e) => {
    const pts = pointersRef.current
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pinch = pinchRef.current
    if (pinch && pts.size >= 2) {
      const stage = stageRef.current
      if (!stage) return
      const rect = stage.getBoundingClientRect()
      const [a, b] = [...pts.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }
      const v = viewRef.current
      // Keep the world point that started under the fingers glued to their midpoint.
      const wx = (pinch.mid0.x - rect.left - pinch.x0) / pinch.k0
      const wy = (pinch.mid0.y - rect.top - pinch.y0) / pinch.k0
      v.k = clampK(pinch.k0 * (d / pinch.d0))
      v.x = mid.x - wx * v.k
      v.y = mid.y - wy * v.k
      applyView()
      return
    }
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    drag.moved += Math.abs(dx) + Math.abs(dy)
    const v = viewRef.current
    v.x = drag.vx + dx
    v.y = drag.vy + dy
    applyView()
  }

  const endDrag = (e) => {
    const pts = pointersRef.current
    if (e?.pointerId != null) pts.delete(e.pointerId)
    else pts.clear()
    if (pinchRef.current && pts.size < 2) {
      pinchRef.current = null
      pinchEndedAtRef.current = Date.now()
    }
    if (pts.size === 0) dragRef.current = null
  }

  const onWheel = (e) => {
    e.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const v = viewRef.current
    const wx = (mx - v.x) / v.k
    const wy = (my - v.y) / v.k
    v.k = clampK(v.k * (e.deltaY < 0 ? 1.12 : 0.89))
    v.x = mx - wx * v.k
    v.y = my - wy * v.k
    applyView()
  }

  /** True when a click is the tail of a drag or pinch and must be swallowed. */
  const wasGestureClick = () =>
    (dragRef.current && dragRef.current.moved > 6) ||
    !!pinchRef.current || Date.now() - pinchEndedAtRef.current < 350

  return {
    stageRef,
    boardRef,
    stageProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onPointerLeave: endDrag,
      onWheel,
    },
    fitAll,
    zoomBy,
    wasGestureClick,
  }
}
