import * as THREE from 'three'
import { groundKind, groundKindGrid, type ZoneGroundRegion } from '../../shared/groundKinds'

// Painted ground layer (docs/world-design-review-2026-07.md §4.1). Renders a
// zone's `ground` regions — dirt paths, cobbled roads, plazas, farm soil,
// interior floors, water — as a lit overlay draped over the base ground, plus a
// translucent surface plane for water. Pure decoration: collision/movement stay
// on the ASCII grid, so this touches render only. Composes over BOTH ground
// materials (checker and the blended terrain preset) because it's a separate
// mesh sitting just above them, not a texture edit — one code path, both looks.
//
// The overlay uses alphaTest (not blending): every texel is either a kind's
// solid colour or fully transparent, so a hard cutout keeps depthWrite on,
// receives the sun's shadow, and never z-fights (a small polygonOffset lifts it
// off the base). Raycasting is disabled on the overlay and water so click-to-
// move still hits the base ground mesh underneath.

const OVERLAY_EPSILON = 0.02

/** Per-tile RGBA canvas: a painted tile gets its kind colour (opaque), an
 * unpainted tile is transparent. Null when nothing is painted. */
function buildKindTexture(width: number, height: number, grid: string[]): THREE.CanvasTexture | null {
  let painted = false
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, width, height)
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const kind = groundKind(grid[z * width + x])
      if (!kind) continue
      painted = true
      ctx.fillStyle = kind.color
      ctx.fillRect(x, z, 1, 1)
    }
  }
  if (!painted) return null
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Lifts each vertex of a per-tile-subdivided plane to the terrain corner
 * heights (matching createGround), so the overlay drapes over relief. */
function drape(geometry: THREE.PlaneGeometry, width: number, height: number, corners: Float32Array | null): void {
  if (!corners) return
  const stride = width + 1
  const pos = geometry.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const cx = Math.min(width, Math.max(0, Math.round(pos.getX(i))))
    const cz = Math.min(height, Math.max(0, Math.round(pos.getZ(i))))
    pos.setY(i, corners[cz * stride + cx])
  }
  pos.needsUpdate = true
  geometry.computeVertexNormals()
}

/** Adds the painted-ground overlay for `ground` regions. Returns the mesh (for
 * disposal) or null when nothing is painted. */
export function createGroundPaint(
  scene: THREE.Scene,
  width: number,
  height: number,
  ground: ZoneGroundRegion[] | undefined,
  corners: Float32Array | null,
): THREE.Mesh | null {
  const grid = groundKindGrid(width, height, ground)
  const texture = buildKindTexture(width, height, grid)
  if (!texture) return null
  const geometry = new THREE.PlaneGeometry(width, height, width, height)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(width / 2, OVERLAY_EPSILON, height / 2)
  drape(geometry, width, height, corners)
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    alphaTest: 0.5,
    roughness: 0.9,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.raycast = () => {}
  scene.add(mesh)
  return mesh
}

/** Adds a translucent surface plane per water region (its painted colour is the
 * riverbed showing through). Returns the planes for disposal. */
export function createWater(
  scene: THREE.Scene,
  ground: ZoneGroundRegion[] | undefined,
  heightAt: (x: number, z: number) => number,
): THREE.Mesh[] {
  const planes: THREE.Mesh[] = []
  for (const r of ground ?? []) {
    const kind = groundKind(r.kind)
    if (!kind?.water) continue
    const cx = r.x + r.w / 2
    const cz = r.z + r.h / 2
    const geometry = new THREE.PlaneGeometry(r.w, r.h)
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(cx, heightAt(cx, cz) + 0.06, cz)
    const material = new THREE.MeshStandardMaterial({
      color: kind.surface ?? '#3b6b88',
      transparent: true,
      opacity: 0.74,
      // Molten rock is lit from inside and barely reflects; water is the reverse.
      roughness: kind.molten ? 0.85 : 0.15,
      metalness: kind.molten ? 0 : 0.2,
      emissive: new THREE.Color(kind.molten ? (kind.surface ?? '#d2571d') : '#000000'),
      emissiveIntensity: kind.molten ? 0.7 : 0,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.receiveShadow = true
    mesh.raycast = () => {}
    scene.add(mesh)
    planes.push(mesh)
  }
  return planes
}
