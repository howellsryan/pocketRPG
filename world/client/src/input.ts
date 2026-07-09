import * as THREE from 'three'
import { worldToTile } from './scene'

export type Tile = { x: number; z: number }

const MARKER_FADE_MS = 600

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

/** Attaches a pointerdown handler that raycasts against `ground` and reports
 * the tile under the cursor. Returns an unsubscribe function. */
export function setupClickToMove(
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  ground: THREE.Object3D,
  onTile: (tile: Tile) => void
): () => void {
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

  function handlePointerDown(event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObject(ground, false)
    if (hits.length === 0) return
    onTile(worldToTile(hits[0].point))
  }

  canvas.addEventListener('pointerdown', handlePointerDown)
  return () => canvas.removeEventListener('pointerdown', handlePointerDown)
}
