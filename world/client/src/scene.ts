import * as THREE from 'three'

const CAMERA_OFFSET = new THREE.Vector3(0, 12, 9)
export const ZOOM_MIN = 0.6
export const ZOOM_MAX = 1.8
const TILE_PIXELS = 16

export type ZoneAmbience = { sky?: string; hemiIntensity?: number; sunIntensity?: number }
const DEFAULT_SKY = 0x87ceeb

export function createScene(ambience?: ZoneAmbience): THREE.Scene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(ambience?.sky ?? DEFAULT_SKY)
  return scene
}

export function createRenderer(container: HTMLElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  container.appendChild(renderer.domElement)
  return renderer
}

export function createCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200)
}

/** Positions the camera at a fixed offset from `target`, scaled by `zoom`, looking at `target`. No rotation in v1. */
export function updateCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3, zoom: number): void {
  camera.position.copy(target).add(CAMERA_OFFSET.clone().multiplyScalar(zoom))
  camera.lookAt(target)
}

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

export function createLights(scene: THREE.Scene, ambience?: ZoneAmbience): void {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a2a, ambience?.hemiIntensity ?? 1.1)
  scene.add(hemi)
  const dir = new THREE.DirectionalLight(0xffffff, ambience?.sunIntensity ?? 1.4)
  dir.position.set(6, 12, 4)
  scene.add(dir)
}

/** Bakes a checker texture over the walkable tiles and a darker checker over
 * blocked ('#') tiles into one canvas — far fewer draw calls than one overlay
 * mesh per blocked tile for a 32x32+ grid, same visual result. */
export type GroundPalette = { walkableA: string; walkableB: string; blockedA: string; blockedB: string }
const DEFAULT_PALETTE: GroundPalette = { walkableA: '#4a7c3a', walkableB: '#568c44', blockedA: '#3a3428', blockedB: '#443d30' }

function buildGroundTexture(collision: string[], width: number, height: number, palette: GroundPalette): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width * TILE_PIXELS
  canvas.height = height * TILE_PIXELS
  const ctx = canvas.getContext('2d')!
  const { walkableA, walkableB, blockedA, blockedB } = palette
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const blocked = collision[z]?.[x] === '#'
      const even = (x + z) % 2 === 0
      ctx.fillStyle = blocked ? (even ? blockedA : blockedB) : (even ? walkableA : walkableB)
      // Canvas row 0 lands on the plane's v=1 edge, which sits at world z=0
      // after the rotateX/translate below — so tile z maps to canvas row z
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

/** Ground plane spanning tile (0,0)-(width,height) with its corner at the world
 * origin, so tile (tx,tz)'s center is world position (tx+0.5, 0, tz+0.5). */
export function createGround(scene: THREE.Scene, collision: string[], width: number, height: number, palette?: GroundPalette): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(width, height)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(width / 2, 0, height / 2)
  const material = new THREE.MeshStandardMaterial({ map: buildGroundTexture(collision, width, height, palette ?? DEFAULT_PALETTE) })
  const mesh = new THREE.Mesh(geometry, material)
  scene.add(mesh)
  return mesh
}

export function tileToWorld(x: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x + 0.5, 0, z + 0.5)
}

export function worldToTile(point: THREE.Vector3): { x: number; z: number } {
  return { x: Math.floor(point.x), z: Math.floor(point.z) }
}
