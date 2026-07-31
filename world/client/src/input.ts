import * as THREE from 'three'
import { groundHeight, worldToTile } from './scene'
import { pickTargetOf } from './statics'
import { buildMenu, defaultInteract, hoverText, topPick, type Pickable } from './picking'
import { hideContextMenu, setHoverText, showContextMenu, type MenuDispatch } from './ui'

export type Tile = { x: number; z: number }
export type Interact = { kind: Pickable['kind']; id: string; action: string }

const MARKER_FADE_MS = 600
const LONG_PRESS_MS = 500
const LONG_PRESS_MOVE_PX = 10

export function createClickMarker(scene: THREE.Scene): THREE.Mesh {
  const geometry = new THREE.RingGeometry(0.25, 0.4, 24)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0 })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.visible = false
  scene.add(mesh)
  return mesh
}

export function showClickMarker(marker: THREE.Mesh, x: number, z: number): void {
  marker.position.set(x + 0.5, groundHeight(x + 0.5, z + 0.5) + 0.02, z + 0.5)
  marker.visible = true
  marker.userData.shownAt = performance.now()
}

export function updateClickMarker(marker: THREE.Mesh, now: number): void {
  if (!marker.visible) return
  const elapsed = now - (marker.userData.shownAt ?? 0)
  const material = marker.material as THREE.MeshBasicMaterial
  if (elapsed >= MARKER_FADE_MS) {
    marker.visible = false
    material.opacity = 0
    return
  }
  material.opacity = 1 - elapsed / MARKER_FADE_MS
}

export type InputHandlers = {
  onWalk: (tile: Tile) => void
  onInteract: (interact: Interact) => void
  /** Right-click → Follow on a player pickable (item 10). */
  onFollow: (targetId: string) => void
  onMessage: (text: string) => void
  /** Current picks-live set (npcs/loot move + come and go), resolved per event. */
  getPickables: () => THREE.Object3D[]
  getPlayerCombatLevel: () => number
  /** Last chance to set fields on a pickable before the menu is built. Exists
   * for rules that depend on the world's CURRENT state rather than on the
   * entity — the Wilderness attack rule reads both players' positions, so
   * baking it into the pickable at mesh creation would go stale the moment
   * either of them moved. */
  decoratePickable?: (pick: Pickable) => void
  /** Two-finger pinch: ratio of this move's finger distance over the last —
   * >1 fingers spreading (zoom in), <1 pinching in (zoom out). */
  onPinchZoom: (ratio: number) => void
}

/** Wires pointer input: left-click = default action / walk, right-click (mouse)
 * or long-press (touch) = context menu, hover = OSRS-style top-left action line.
 * Returns an unsubscribe function. */
export function setupInput(canvas: HTMLCanvasElement, camera: THREE.Camera, ground: THREE.Object3D, h: InputHandlers): () => void {
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

  function setPointer(event: { clientX: number; clientY: number }): void {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
  }

  /** Unique pickables under the cursor, near-to-far (ray order preserved).
   *
   * Decoration happens HERE rather than at each call site: hover, left-click
   * and the context menu all resolve picks through this one function, and a
   * rule applied to only some of them is a menu that offers an action the
   * left-click does not (which is exactly how Attack ended up right-click
   * only). */
  function resolvePicks(): Pickable[] {
    const hits = raycaster.intersectObjects(h.getPickables(), true)
    const out: Pickable[] = []
    const seen = new Set<Pickable>()
    for (const hit of hits) {
      const pick = pickTargetOf(hit.object)
      if (pick && !seen.has(pick)) {
        seen.add(pick)
        h.decoratePickable?.(pick)
        out.push(pick)
      }
    }
    return out
  }

  function tileUnderPointer(): Tile | null {
    // Recursive so a chunk-streamed ground (a Group of chunk meshes) is hit; a
    // single-mesh zone has no children, so recursive is identical there.
    const hits = raycaster.intersectObject(ground, true)
    return hits.length === 0 ? null : worldToTile(hits[0].point)
  }

  function performDefault(): void {
    const pick = topPick(resolvePicks())
    if (pick) {
      h.onInteract(defaultInteract(pick))
      return
    }
    const tile = tileUnderPointer()
    if (tile) h.onWalk(tile)
  }

  function openMenu(clientX: number, clientY: number): void {
    setPointer({ clientX, clientY })
    const picks = resolvePicks()
    const tile = tileUnderPointer()
    const rows = buildMenu(picks, h.getPlayerCombatLevel())
    const dispatch: MenuDispatch = (row) => {
      if (row.interact) h.onInteract(row.interact)
      else if (row.followTargetId) h.onFollow(row.followTargetId)
      else if (row.local === 'examine' && row.examineText) h.onMessage(row.examineText)
      else if (row.local === 'walk' && tile) h.onWalk(tile)
    }
    showContextMenu(rows, clientX, clientY, dispatch)
  }

  // ── Hover (throttled to one raycast per animation frame) ──
  let hoverPending: { clientX: number; clientY: number } | null = null
  let hoverScheduled = false
  function flushHover(): void {
    hoverScheduled = false
    if (!hoverPending) return
    setPointer(hoverPending)
    setHoverText(hoverText(resolvePicks()))
  }

  // ── Long-press (touch) ──
  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let longPressFired = false
  let downPos: { x: number; y: number } | null = null
  function clearLongPress(): void {
    if (longPressTimer) clearTimeout(longPressTimer)
    longPressTimer = null
  }

  // ── Two-finger pinch-to-zoom (touch) — replaces the browser's native
  // double-tap/pinch page zoom (killed by touch-action:none in CSS) with a
  // camera zoom, same intent as the desktop wheel handler. ──
  const touchPoints = new Map<number, { x: number; y: number }>()
  let pinchDist = 0
  let pinching = false

  function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (touchPoints.size >= 2) {
        // A second finger landed: this is a pinch, not a tap/long-press.
        clearLongPress()
        downPos = null
        longPressFired = false
        pinching = true
        const [a, b] = [...touchPoints.values()]
        pinchDist = distanceBetween(a, b)
        return
      }
    }
    hideContextMenu()
    downPos = { x: event.clientX, y: event.clientY }
    longPressFired = false
    if (event.pointerType === 'touch') {
      longPressTimer = setTimeout(() => {
        longPressFired = true
        openMenu(event.clientX, event.clientY)
      }, LONG_PRESS_MS)
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    if (event.pointerType === 'touch' && touchPoints.has(event.pointerId)) {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }
    if (touchPoints.size >= 2) {
      const [a, b] = [...touchPoints.values()]
      const dist = distanceBetween(a, b)
      if (pinchDist > 0) h.onPinchZoom(dist / pinchDist)
      pinchDist = dist
      return
    }
    if (downPos && longPressTimer) {
      const moved = Math.hypot(event.clientX - downPos.x, event.clientY - downPos.y)
      if (moved > LONG_PRESS_MOVE_PX) clearLongPress()
    }
    hoverPending = { clientX: event.clientX, clientY: event.clientY }
    if (!hoverScheduled) {
      hoverScheduled = true
      requestAnimationFrame(flushHover)
    }
  }

  function handlePointerUp(event: PointerEvent): void {
    if (event.pointerType === 'touch') touchPoints.delete(event.pointerId)
    if (touchPoints.size < 2) pinchDist = 0
    if (pinching) {
      // Swallow taps that land while lifting fingers off a pinch — it's the
      // end of a zoom gesture, not a walk/interact click.
      if (touchPoints.size === 0) pinching = false
      return
    }
    clearLongPress()
    downPos = null
    if (longPressFired) {
      longPressFired = false
      return
    }
    if (event.button !== 0) return
    setPointer(event)
    performDefault()
  }

  function handlePointerCancel(event: PointerEvent): void {
    touchPoints.delete(event.pointerId)
    if (touchPoints.size < 2) pinchDist = 0
    if (touchPoints.size === 0) pinching = false
  }

  function handleContextMenu(event: MouseEvent): void {
    event.preventDefault()
    openMenu(event.clientX, event.clientY)
  }

  canvas.addEventListener('pointerdown', handlePointerDown)
  canvas.addEventListener('pointermove', handlePointerMove)
  canvas.addEventListener('pointerup', handlePointerUp)
  canvas.addEventListener('pointercancel', handlePointerCancel)
  canvas.addEventListener('contextmenu', handleContextMenu)
  return () => {
    clearLongPress()
    canvas.removeEventListener('pointerdown', handlePointerDown)
    canvas.removeEventListener('pointermove', handlePointerMove)
    canvas.removeEventListener('pointerup', handlePointerUp)
    canvas.removeEventListener('pointercancel', handlePointerCancel)
    canvas.removeEventListener('contextmenu', handleContextMenu)
  }
}
