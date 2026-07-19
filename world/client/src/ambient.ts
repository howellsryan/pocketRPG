import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { tileToWorld } from './scene'
import type { ZoneAmbient, ZoneAmbientCritter } from '../../shared/protocol'

// Ambient life (docs/world-design-review-2026-07.md §4.4) — the cheap layer that
// makes a town feel inhabited: non-combat walkers wandering a patch of ground
// (villagers in towns, critters in fields) and smoke curling off chimneys.
// Pure client render — no server, no gameplay — but wander respects the same
// collision grid the terrain bakes (R2-9, docs/open-world-changes-plan.md):
// a walker never picks, or steps into, a blocked tile. Movement is a slow
// random walk within an authored rectangle rather than a skeletal mixer, so
// one small module covers every model without per-clip wiring (static pose is
// fine — the bob is the only "animation"); smoke is a recycled point sprite.

// Loadable critter/villager GLBs with baked bounds (Box3.setFromObject is
// unreliable for skinned meshes — same reason as monsterModels.ts). `target`
// is render height in tiles: field critters read smaller and cuter than their
// combat cousins; villagers are human-scale.
const CRITTERS: Record<string, { url: string; target: number; b: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } }> = {
  chicken: { url: '/models/chicken.glb', target: 0.55, b: { minX: -1.17, maxX: 1.17, minY: -0.01, maxY: 2.34, minZ: -0.8, maxZ: 1.3 } },
  frog: { url: '/models/frog.glb', target: 0.4, b: { minX: -2.32, maxX: 2.32, minY: -0.01, maxY: 2.68, minZ: -0.58, maxZ: 0.97 } },
  // Target 1.6 matches HERO_SCALE's rendered height in entities.ts (Quaternius
  // Ranger outfit, ~1.9 units tall raw × 0.85 ≈ 1.615) — villagers read at the
  // same human scale as the player instead of an arbitrarily different one.
  // Bounds are the actual posed (idle, not bind/T-pose) box from a headless
  // three.js render of the built GLB — Box3.setFromObject in the browser
  // evaluates skinning correctly; gltf-transform's getBounds does not.
  villager_a: { url: '/models/villager_a.glb', target: 1.6, b: { minX: -0.36, maxX: 0.395, minY: -0.004, maxY: 1.796, minZ: -0.323, maxZ: 0.388 } },
  villager_b: { url: '/models/villager_b.glb', target: 1.6, b: { minX: -0.366, maxX: 0.399, minY: -0.004, maxY: 1.774, minZ: -0.335, maxZ: 0.392 } },
  villager_c: { url: '/models/villager_c.glb', target: 1.6, b: { minX: -0.36, maxX: 0.395, minY: -0.004, maxY: 1.796, minZ: -0.323, maxZ: 0.388 } },
}

const WANDER_SPEED = 0.55 // tiles/sec — an unhurried amble
// A rect fully walled in (author error, or a rect drawn over a building) must
// not spin forever hunting for a walkable point — after this many misses the
// walker just stands at the rect's centre.
const MAX_TARGET_ATTEMPTS = 20

type Instance = {
  group: THREE.Group
  cx: number; cz: number; cw: number; ch: number
  tx: number; tz: number
  yaw: number
  bob: number
}

/** Whether the tile under world-space (x, z) is walkable per the zone's
 * collision grid ('.' walkable, anything else — incl. out of bounds — not). */
export function isWalkableTile(collision: string[], x: number, z: number): boolean {
  return collision[Math.floor(z)]?.[Math.floor(x)] === '.'
}

/** Picks a random walkable point inside [cx, cx+cw) x [cz, cz+ch), retrying
 * against the collision grid up to MAX_TARGET_ATTEMPTS times. A rect with no
 * walkable tile at all degrades to the rect's centre rather than looping —
 * the walker then just stands there instead of hanging the frame loop. */
export function pickWanderTarget(
  collision: string[], cx: number, cz: number, cw: number, ch: number,
  rand: () => number = Math.random,
): { x: number; z: number } {
  for (let i = 0; i < MAX_TARGET_ATTEMPTS; i++) {
    const x = cx + rand() * cw
    const z = cz + rand() * ch
    if (isWalkableTile(collision, x, z)) return { x, z }
  }
  return { x: cx + cw / 2, z: cz + ch / 2 }
}

export type AmbientLayer = { update: (dt: number) => void; dispose: () => void }

/** Builds the ambient layer: kicks off critter/villager model loads (instances
 * appear as each GLB resolves) and adds the smoke emitters. Returns an
 * update/dispose handle; `heightAt` floors walkers onto the (render-only)
 * terrain relief; `collision` gates wander targets and steps. */
export function createAmbient(
  scene: THREE.Scene,
  ambient: ZoneAmbient | undefined,
  heightAt: (worldX: number, worldZ: number) => number,
  collision: string[],
): AmbientLayer {
  const instances: Instance[] = []
  const smokers = (ambient?.smoke ?? []).map((s) => createSmoke(scene, s.x + 0.5, (s.y ?? 0) + heightAt(s.x + 0.5, s.z + 0.5), s.z + 0.5))
  const disposables: Array<() => void> = smokers.map((s) => s.dispose)

  for (const spec of ambient?.critters ?? []) void spawnCritters(scene, spec, instances, collision)

  return {
    update: (dt: number) => {
      for (const c of instances) {
        const world = c.group.position
        const dx = c.tx - world.x
        const dz = c.tz - world.z
        const dist = Math.hypot(dx, dz)
        if (dist < 0.2) {
          const next = pickWanderTarget(collision, c.cx, c.cz, c.cw, c.ch)
          c.tx = next.x
          c.tz = next.z
        } else {
          const step = Math.min(WANDER_SPEED * dt, dist)
          const nextX = world.x + (dx / dist) * step
          const nextZ = world.z + (dz / dist) * step
          if (isWalkableTile(collision, nextX, nextZ)) {
            world.x = nextX
            world.z = nextZ
            c.yaw = Math.atan2(dx, dz)
            c.bob += dt * 8
          } else {
            // The step would cross into a blocked tile — abandon this target
            // and pick a new one rather than walking through a wall.
            const next = pickWanderTarget(collision, c.cx, c.cz, c.cw, c.ch)
            c.tx = next.x
            c.tz = next.z
          }
        }
        world.y = heightAt(world.x, world.z) + Math.abs(Math.sin(c.bob)) * 0.06
        c.group.rotation.y = c.yaw
      }
      for (const s of smokers) s.update(dt)
    },
    dispose: () => {
      for (const c of instances) scene.remove(c.group)
      for (const d of disposables) d()
    },
  }
}

async function spawnCritters(scene: THREE.Scene, spec: ZoneAmbientCritter, out: Instance[], collision: string[]): Promise<void> {
  const def = CRITTERS[spec.model]
  if (!def) return
  let gltf
  try {
    gltf = await new GLTFLoader().loadAsync(def.url)
  } catch {
    return
  }
  const { b, target } = def
  const scale = target / (b.maxY - b.minY)
  for (let i = 0; i < spec.count; i++) {
    const model = cloneSkeleton(gltf.scene)
    model.position.set(-((b.minX + b.maxX) / 2) * scale, -b.minY * scale, -((b.minZ + b.maxZ) / 2) * scale)
    model.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) mesh.castShadow = true
    })
    const group = new THREE.Group()
    group.scale.setScalar(scale)
    group.add(model)
    const spawnPoint = pickWanderTarget(collision, spec.x, spec.z, spec.w, spec.h)
    const start = tileToWorld(spawnPoint.x, spawnPoint.z)
    group.position.copy(start)
    scene.add(group)
    const wanderTarget = pickWanderTarget(collision, spec.x, spec.z, spec.w, spec.h)
    out.push({
      group,
      cx: spec.x, cz: spec.z, cw: spec.w, ch: spec.h,
      tx: wanderTarget.x, tz: wanderTarget.z,
      yaw: Math.random() * Math.PI * 2,
      bob: Math.random() * Math.PI * 2,
    })
  }
}

// ── Chimney smoke: a handful of soft puffs rising and recycling ──────────────
const PUFFS = 14
const RISE = 1.1 // tiles/sec

let softTexture: THREE.CanvasTexture | null = null
function puffTexture(): THREE.CanvasTexture {
  if (softTexture) return softTexture
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(214,210,200,0.9)')
  g.addColorStop(1, 'rgba(214,210,200,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  softTexture = new THREE.CanvasTexture(c)
  return softTexture
}

function createSmoke(scene: THREE.Scene, wx: number, wy: number, wz: number): { update: (dt: number) => void; dispose: () => void } {
  const ages = new Float32Array(PUFFS)
  const positions = new Float32Array(PUFFS * 3)
  for (let i = 0; i < PUFFS; i++) {
    ages[i] = (i / PUFFS) * 3
    positions[i * 3] = wx
    positions[i * 3 + 1] = wy
    positions[i * 3 + 2] = wz
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    map: puffTexture(),
    size: 0.9,
    transparent: true,
    depthWrite: false,
    opacity: 0.5,
    sizeAttenuation: true,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  scene.add(points)

  const update = (dt: number): void => {
    const attr = geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < PUFFS; i++) {
      ages[i] += dt
      if (ages[i] > 3) {
        ages[i] -= 3
        attr.setXYZ(i, wx, wy, wz)
      } else {
        attr.setXYZ(
          i,
          attr.getX(i) + Math.sin(ages[i] * 1.7 + i) * 0.12 * dt,
          wy + ages[i] * RISE,
          attr.getZ(i) + Math.cos(ages[i] * 1.3 + i) * 0.12 * dt,
        )
      }
    }
    attr.needsUpdate = true
  }
  return {
    update,
    dispose: () => {
      scene.remove(points)
      geometry.dispose()
      material.dispose()
    },
  }
}
