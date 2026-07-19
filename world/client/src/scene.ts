import * as THREE from 'three'

const CAMERA_OFFSET = new THREE.Vector3(0, 12, 9)
export const ZOOM_MIN = 0.6
export const ZOOM_MAX = 1.8
const TILE_PIXELS = 16

export type ZoneAmbience = { sky?: string; hemiIntensity?: number; sunIntensity?: number }
const DEFAULT_SKY = 0x87ceeb
// Fog near must clear the farthest the camera ever sits from its target
// (ZOOM_MAX * |CAMERA_OFFSET| ≈ 27) or the hero itself would fog out.
const FOG_NEAR = 45
const FOG_FAR = 110

export function createScene(ambience?: ZoneAmbience): THREE.Scene {
  const scene = new THREE.Scene()
  const sky = new THREE.Color(ambience?.sky ?? DEFAULT_SKY)
  scene.background = sky
  scene.fog = new THREE.Fog(sky, FOG_NEAR, FOG_FAR)
  return scene
}

export function createRenderer(container: HTMLElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.appendChild(renderer.domElement)
  return renderer
}

export function createCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200)
}

/** Positions the camera at a fixed offset from `target`, scaled by `zoom` and
 * rotated around `target` by `yaw` (radians, default 0 — no rotation),
 * looking at `target`. */
export function updateCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3, zoom: number, yaw = 0): void {
  const offset = CAMERA_OFFSET.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiplyScalar(zoom)
  camera.position.copy(target).add(offset)
  camera.lookAt(target)
}

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

const SHADOW_MAP_SIZE = 1024
const SHADOW_RADIUS_TILES = 14
const SUN_OFFSET = new THREE.Vector3(6, 12, 4)

/** Sun casts shadows in a frustum sized for the area immediately around its
 * target (the hero) — `updateShadowLight` recentres it every frame so a
 * 64-tile zone doesn't need (or pay for) a zone-sized shadow map. */
export function createLights(scene: THREE.Scene, ambience?: ZoneAmbience): { sun: THREE.DirectionalLight } {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a2a, ambience?.hemiIntensity ?? 1.1)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xffffff, ambience?.sunIntensity ?? 1.4)
  sun.position.copy(SUN_OFFSET)
  sun.castShadow = true
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 60
  sun.shadow.camera.left = -SHADOW_RADIUS_TILES
  sun.shadow.camera.right = SHADOW_RADIUS_TILES
  sun.shadow.camera.top = SHADOW_RADIUS_TILES
  sun.shadow.camera.bottom = -SHADOW_RADIUS_TILES
  scene.add(sun)
  // A DirectionalLight's target is a plain Object3D that must be in the scene
  // graph for its world matrix to update — otherwise the shadow frustum stays
  // pinned at the origin forever.
  scene.add(sun.target)
  return { sun }
}

/** Recentres the shadow-casting sun (and its target) on `target` each frame
 * so the shadow frustum follows the hero instead of covering the whole zone. */
export function updateShadowLight(sun: THREE.DirectionalLight, target: THREE.Vector3): void {
  sun.position.copy(target).add(SUN_OFFSET)
  sun.target.position.copy(target)
}

/** Bakes a checker texture over the walkable tiles and a darker checker over
 * blocked ('#') tiles into one canvas — far fewer draw calls than one overlay
 * mesh per blocked tile for a 32x32+ grid, same visual result. */
export type GroundPalette = { walkableA: string; walkableB: string; blockedA: string; blockedB: string }
const DEFAULT_PALETTE: GroundPalette = { walkableA: '#4a7c3a', walkableB: '#568c44', blockedA: '#3a3428', blockedB: '#443d30' }

/** Checker texture for the tile rectangle [x0,x0+w)×[z0,z0+h). The checker
 * parity uses GLOBAL tile coords (x0+x + z0+z) so a chunk's texture lines up
 * seamlessly with its neighbours; the whole-map call passes x0=z0=0. */
function buildGroundTextureRegion(collision: string[], x0: number, z0: number, w: number, h: number, palette: GroundPalette): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = w * TILE_PIXELS
  canvas.height = h * TILE_PIXELS
  const ctx = canvas.getContext('2d')!
  const { walkableA, walkableB, blockedA, blockedB } = palette
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const blocked = collision[z0 + z]?.[x0 + x] === '#'
      const even = (x0 + x + z0 + z) % 2 === 0
      ctx.fillStyle = blocked ? (even ? blockedA : blockedB) : (even ? walkableA : walkableB)
      // Canvas row 0 lands on the plane's v=1 edge, which sits at world z=z0
      // after the rotateX/translate below — so tile (z0+z) maps to canvas row z
      // directly. (The old height-1-z flip mirrored blocked tiles north-south:
      // clicks on visually open grass hit the real, invisible fence.)
      ctx.fillRect(x * TILE_PIXELS, z * TILE_PIXELS, TILE_PIXELS, TILE_PIXELS)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function buildGroundTexture(collision: string[], width: number, height: number, palette: GroundPalette): THREE.CanvasTexture {
  return buildGroundTextureRegion(collision, 0, 0, width, height, palette)
}

/** Lifts each vertex of a per-tile-subdivided plane to its global corner height.
 * The plane must already be rotated/translated into world space so a vertex's
 * rounded (x,z) is its global corner index — shared-edge vertices between chunks
 * read the same corner, so heights match exactly and seams don't crack. */
function liftToCorners(geometry: THREE.PlaneGeometry, mapWidth: number, mapHeight: number, corners: Float32Array): void {
  const stride = mapWidth + 1
  const pos = geometry.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const cx = Math.min(mapWidth, Math.max(0, Math.round(pos.getX(i))))
    const cz = Math.min(mapHeight, Math.max(0, Math.round(pos.getZ(i))))
    pos.setY(i, corners[cz * stride + cx])
  }
  pos.needsUpdate = true
  geometry.computeVertexNormals()
}

/** One ground chunk covering tiles [x0,x0+cw)×[z0,z0+ch) of a mapWidth×mapHeight
 * map — same geometry/texture/height pipeline as createGround, bounded to the
 * chunk (docs/single-world-map-investigation.md M2). `materialOverride` (a shared
 * terrain-preset material) skips the per-chunk canvas; otherwise the chunk owns
 * its own checker texture. `frustumCulled` lets three.js skip off-camera chunks. */
export function createGroundChunk(
  parent: THREE.Object3D,
  collision: string[],
  mapWidth: number,
  mapHeight: number,
  x0: number,
  z0: number,
  cw: number,
  ch: number,
  palette: GroundPalette | undefined,
  corners: Float32Array,
  materialOverride?: THREE.Material,
): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(cw, ch, cw, ch)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(x0 + cw / 2, 0, z0 + ch / 2)
  liftToCorners(geometry, mapWidth, mapHeight, corners)
  const material = materialOverride ?? new THREE.MeshStandardMaterial({ map: buildGroundTextureRegion(collision, x0, z0, cw, ch, palette ?? DEFAULT_PALETTE) })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.frustumCulled = true
  parent.add(mesh)
  return mesh
}

/** Ground plane spanning tile (0,0)-(width,height) with its corner at the world
 * origin, so tile (tx,tz)'s center is world position (tx+0.5, y, tz+0.5).
 *
 * With `corners` (a (width+1)×(height+1) row-major grid of per-corner heights)
 * the plane is subdivided one segment per tile and each vertex is lifted to its
 * corner height — so mesh vertices coincide exactly with the HeightField's
 * corner grid. Without it (editor preview, T0) the plane stays flat. */
export function createGround(scene: THREE.Scene, collision: string[], width: number, height: number, palette?: GroundPalette, corners?: Float32Array | null, materialOverride?: THREE.Material): THREE.Mesh {
  const geometry = corners
    ? new THREE.PlaneGeometry(width, height, width, height)
    : new THREE.PlaneGeometry(width, height)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(width / 2, 0, height / 2)
  if (corners) liftToCorners(geometry, width, height, corners)
  const material = materialOverride ?? new THREE.MeshStandardMaterial({ map: buildGroundTexture(collision, width, height, palette ?? DEFAULT_PALETTE) })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  scene.add(mesh)
  return mesh
}

// Per-zone terrain height sampler (world/client/src/terrain.ts registers it).
// Kept module-level so tileToWorld — which every placed thing routes through —
// picks up terrain height with no call-site changes. Null => flat (y=0), the
// pre-terrain behaviour. Movement/collision stay flat and server-authoritative;
// this only lifts render Y.
let heightSampler: ((worldX: number, worldZ: number) => number) | null = null

export function setHeightSampler(fn: ((worldX: number, worldZ: number) => number) | null): void {
  heightSampler = fn
}

/** Ground Y at a world (x,z). 0 until a HeightField is registered. */
export function groundHeight(worldX: number, worldZ: number): number {
  return heightSampler ? heightSampler(worldX, worldZ) : 0
}

export function tileToWorld(x: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x + 0.5, groundHeight(x + 0.5, z + 0.5), z + 0.5)
}

export function worldToTile(point: THREE.Vector3): { x: number; z: number } {
  return { x: Math.floor(point.x), z: Math.floor(point.z) }
}
