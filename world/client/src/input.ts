import * as THREE from 'three'
import { worldToTile } from './scene'
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
  marker.position.set(x + 0.5, 0.02, z + 0.5)
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
  onMessage: (text: string) => void
  /** Current picks-live set (npcs/loot move + come and go), resolved per event. */
  getPickables: () => THREE.Object3D[]
  getPlayerCombatLevel: () => number
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

  /** Unique pickables under the cursor, near-to-far (ray order preserved). */
  function resolvePicks(): Pickable[] {
    const hits = raycaster.intersectObjects(h.getPickables(), true)
    const out: Pickable[] = []
    const seen = new Set<Pickable>()
    for (const hit of hits) {
      const pick = pickTargetOf(hit.object)
      if (pick && !seen.has(pick)) {
        seen.add(pick)
        out.push(pick)
      }
    }
    return out
  }

  function tileUnderPointer(): Tile | null {
    const hits = raycaster.intersectObject(ground, false)
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

  function handlePointerDown(event: PointerEvent): void {
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
    clearLongPress()
    downPos = null
    if (longPressFired) {
      longPressFired = false
      return
    }
    setPointer(event)
    performDefault()
  }

  function handleContextMenu(event: MouseEvent): void {
    event.preventDefault()
    openMenu(event.clientX, event.clientY)
  }

  canvas.addEventListener('pointerdown', handlePointerDown)
  canvas.addEventListener('pointermove', handlePointerMove)
  canvas.addEventListener('pointerup', handlePointerUp)
  canvas.addEventListener('contextmenu', handleContextMenu)
  return () => {
    clearLongPress()
    canvas.removeEventListener('pointerdown', handlePointerDown)
    canvas.removeEventListener('pointermove', handlePointerMove)
    canvas.removeEventListener('pointerup', handlePointerUp)
    canvas.removeEventListener('contextmenu', handleContextMenu)
  }
}
