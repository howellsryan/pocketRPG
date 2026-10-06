import { AMBIENT_MODELS } from '../../shared/ambientModels'
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { tileToWorld } from './scene'
import type { ZoneAmbient, ZoneAmbientCritter } from '../../shared/protocol'
import { modelUrl } from './assetBase'

// Ambient life (docs/world-design-review-2026-07.md §4.4) — the cheap layer that
// makes a town feel inhabited: non-combat walkers wandering a patch of ground
// (villagers in towns, critters in fields) and smoke curling off chimneys.
// Pure client render — no server, no gameplay — but wander respects the same
// collision grid the terrain bakes (R2-9, docs/open-world-changes-plan.md):
// a walker never picks, or steps into, a blocked tile, and (R3-4,
// docs/open-world-changes-plan.md) never picks a target too close to another
// walker in the same group, so a town plaza's villagers spread out instead of
// clumping onto the one open tile a mostly-building-blocked rect leaves.
// Humanoid GLBs (villagers) play a real idle/walk THREE.AnimationMixer clip
// pair, retargeted by build-villagers.mjs exactly like the hero/monsters
// (entities.ts's makeAnimator) — a skeleton frozen mid-stride with only a
// vertical bob read as broken. Animal critters (chicken/frog) ship no rig
// clips, so they keep the cheap bob-only path; smoke is a recycled point sprite.

// Loadable critter/villager GLBs with baked bounds (Box3.setFromObject is
// unreliable for skinned meshes — same reason as monsterModels.ts). `target`
// is render height in tiles: field critters read smaller and cuter than their
// combat cousins; villagers are human-scale.
const CRITTERS = AMBIENT_MODELS

// A rect fully walled in (author error, or a rect drawn over a building) must
// not spin forever hunting for a walkable point — after this many misses the
// walker just stands at the rect's centre.
const MAX_TARGET_ATTEMPTS = 20
// Minimum gap (tiles) a freshly-picked wander target keeps from every other
// walker already in the group — small enough that a tight plaza still finds
// room, large enough that villagers read as separate people, not a clump.
const MIN_SEPARATION = 1.2
const ANIM_CROSSFADE_S = 0.15

type Instance = {
  group: THREE.Group
  /** Index into the shared `walkers`/`walkerFramesAt` arrays — position/yaw
   * are looked up here each frame rather than integrated locally, so every
   * client's instances read the same deterministic simulation. */
  walkerIndex: number
  mixer: THREE.AnimationMixer | null
  idleAction: THREE.AnimationAction | null
  walkAction: THREE.AnimationAction | null
  current: THREE.AnimationAction | null
}

/** Whether the tile under world-space (x, z) is walkable per the zone's
 * collision grid ('.' walkable, anything else — incl. out of bounds — not). */
export function isWalkableTile(collision: string[], x: number, z: number): boolean {
  return collision[Math.floor(z)]?.[Math.floor(x)] === '.'
}

/** Picks a random walkable point inside [cx, cx+cw) x [cz, cz+ch), at least
 * MIN_SEPARATION from every point in `avoid`, retrying up to
 * MAX_TARGET_ATTEMPTS times. Falls back to the first walkable point found
 * (ignoring separation) if no candidate clears every avoid point in budget,
 * and further degrades to the rect's centre when the rect has no walkable
 * tile at all — the walker then just stands there instead of hanging the
 * frame loop. */
export function pickWanderTarget(
  collision: string[], cx: number, cz: number, cw: number, ch: number,
  rand: () => number = Math.random,
  avoid: { x: number; z: number }[] = [],
): { x: number; z: number } {
  let fallback: { x: number; z: number } | null = null
  const minSepSq = MIN_SEPARATION * MIN_SEPARATION
  for (let i = 0; i < MAX_TARGET_ATTEMPTS; i++) {
    const x = cx + rand() * cw
    const z = cz + rand() * ch
    if (!isWalkableTile(collision, x, z)) continue
    if (!fallback) fallback = { x, z }
    const clear = avoid.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 >= minSepSq)
    if (clear) return { x, z }
  }
  return fallback ?? { x: cx + cw / 2, z: cz + ch / 2 }
}

// ── Deterministic ambient simulation (item 9) ──────────────────────────────
// Ambient walkers used to be seeded and stepped from Math.random() every
// frame — private to each client, so two players standing in the same town
// saw two different crowds. Every value here is instead a pure function of a
// stable seed + a leg index, evaluated against a shared wall-clock epoch —
// any client, joining at any moment, computes the exact same walker position
// without replaying the zone's whole history: "the seed at step N" is a
// direct hash, never an RNG stream advanced N times.
//
// A walker's path is a sequence of fixed-duration legs; leg L runs from
// waypoint(L) to waypoint(L+1), and both waypoints are themselves pure
// functions of L (via legWaypoints below) — so computing "where is everyone
// right now" costs one pass over the walkers, not one pass per elapsed leg.
// Trade-off: the straight line between two individually-walkable waypoints
// isn't re-validated tile-by-tile (unlike the old per-frame step check), so a
// pathological non-convex wander rect could walk a leg through a blocked
// tile. Every rect authored so far is a simple open area, so this hasn't
// been observed — flagging it rather than adding mid-leg pathfinding, which
// would reintroduce the same non-determinism this rewrite removes.
export const AMBIENT_LEG_SECONDS = 4.5

/** Deterministic 32-bit hash → [0,1), addressed by (seed, ...ints) rather than
 * advanced call-by-call: the same inputs always produce the same output, with
 * no state to replay to get there. Not cryptographic — just needs to spread
 * wander targets around a rect. */
export function hashRand(seed: number, ...ints: number[]): number {
  let h = seed >>> 0
  for (const n of ints) {
    h = Math.imul(h ^ n, 2654435761) >>> 0
    h ^= h >>> 15
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Stable identity for one walker: the zone (so two zones never collide),
 * which critter spec in ambient.critters, and which instance of that spec —
 * every walker in the world gets a distinct, reproducible seed. */
export function walkerSeed(zoneId: string, specIndex: number, instanceIndex: number): number {
  let h = 2166136261 >>> 0
  const key = `${zoneId}:${specIndex}:${instanceIndex}`
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0
  return h >>> 0
}

/** An addressable rand() stream for one (seed, legIndex)'s target pick —
 * pickWanderTarget's internal retries (up to MAX_TARGET_ATTEMPTS) each get
 * their own reproducible draw via the attempt counter, without needing the
 * earlier draws to have actually happened first. */
function legRandStream(seed: number, legIndex: number): () => number {
  let attempt = 0
  return () => hashRand(seed, legIndex, attempt++)
}

export type WanderRect = { cx: number; cz: number; cw: number; ch: number }
export type Walker = { seed: number; rect: WanderRect }

/** Every walker's waypoint for leg `legIndex`, resolved in the caller's fixed
 * order (spec index, then instance index) so each walker's separation check
 * only ever avoids already-resolved waypoints — no circular dependency, and
 * no need to know any OTHER leg's waypoints to compute this one. */
export function legWaypoints(collision: string[], walkers: Walker[], legIndex: number): { x: number; z: number }[] {
  const points: { x: number; z: number }[] = []
  for (const w of walkers) {
    points.push(pickWanderTarget(collision, w.rect.cx, w.rect.cz, w.rect.cw, w.rect.ch, legRandStream(w.seed, legIndex), points))
  }
  return points
}

export type WalkerFrame = { x: number; z: number; yaw: number }

/** Position + facing for every walker at `elapsedSeconds` since the shared
 * ambient epoch. The one function two independent clients must agree on for
 * item 9 to work: same `walkers`/`collision`/`elapsedSeconds` in, same
 * `WalkerFrame[]` out, regardless of which client computed it or when. */
export function walkerFramesAt(collision: string[], walkers: Walker[], elapsedSeconds: number, legSeconds = AMBIENT_LEG_SECONDS): WalkerFrame[] {
  const legIndex = Math.floor(elapsedSeconds / legSeconds)
  const frac = elapsedSeconds / legSeconds - legIndex
  const starts = legWaypoints(collision, walkers, legIndex)
  const ends = legWaypoints(collision, walkers, legIndex + 1)
  return walkers.map((_, i) => {
    const a = starts[i]
    const b = ends[i]
    const dx = b.x - a.x
    const dz = b.z - a.z
    return { x: a.x + dx * frac, z: a.z + dz * frac, yaw: Math.hypot(dx, dz) < 1e-6 ? 0 : Math.atan2(dx, dz) }
  })
}

export type AmbientLayer = { ready: Promise<void>; update: (dt: number, elapsedSeconds?: number) => void; dispose: () => void }

/** Builds the ambient layer: kicks off critter/villager model loads (instances
 * appear as each GLB resolves) and adds the smoke emitters. Returns an
 * update/dispose handle; `heightAt` floors walkers onto the (render-only)
 * terrain relief; `collision` gates wander targets; `zoneId` seeds the
 * deterministic walker identities (item 9) so every client in the same zone
 * simulates the same crowd. */
export function createAmbient(
  scene: THREE.Scene,
  ambient: ZoneAmbient | undefined,
  heightAt: (worldX: number, worldZ: number) => number,
  collision: string[],
  zoneId: string,
): AmbientLayer {
  const instances: Instance[] = []
  const smokers = (ambient?.smoke ?? []).map((s) => createSmoke(scene, s.x + 0.5, (s.y ?? 0) + heightAt(s.x + 0.5, s.z + 0.5), s.z + 0.5))
  const disposables: Array<() => void> = smokers.map((s) => s.dispose)

  // Flat, fixed-order walker list spanning every spec's every instance —
  // this order is what makes cross-spec separation (a chicken avoiding a
  // villager's waypoint, not just other chickens) deterministic: each
  // walker's leg target only ever avoids walkers earlier in this list.
  const specs = ambient?.critters ?? []
  const walkers: Walker[] = []
  const walkerIndexBase: number[] = []
  specs.forEach((spec, specIndex) => {
    walkerIndexBase.push(walkers.length)
    for (let i = 0; i < spec.count; i++) {
      walkers.push({ seed: walkerSeed(zoneId, specIndex, i), rect: { cx: spec.x, cz: spec.z, cw: spec.w, ch: spec.h } })
    }
  })

  const ready = Promise.all(specs.map((spec, specIndex) => spawnCritters(scene, spec, walkerIndexBase[specIndex], instances))).then(() => undefined)

  let bob = 0
  return {
    ready,
    update: (dt: number, elapsedSeconds = Date.now() / 1000) => {
      if (instances.length > 0) {
        const frames = walkerFramesAt(collision, walkers, elapsedSeconds)
        bob += dt * 8
        const bobOffset = Math.abs(Math.sin(bob)) * 0.06
        for (const c of instances) {
          const frame = frames[c.walkerIndex]
          if (!frame) continue
          const world = c.group.position
          world.x = frame.x
          world.z = frame.z
          world.y = heightAt(world.x, world.z) + (c.mixer ? 0 : bobOffset)
          c.group.rotation.y = frame.yaw
          if (c.mixer) {
            const wanted = c.walkAction
            if (wanted && wanted !== c.current) {
              wanted.reset().fadeIn(ANIM_CROSSFADE_S).play()
              c.current?.fadeOut(ANIM_CROSSFADE_S)
              c.current = wanted
            }
            c.mixer.update(dt)
          }
        }
      }
      for (const s of smokers) s.update(dt)
    },
    dispose: () => {
      for (const c of instances) scene.remove(c.group)
      for (const d of disposables) d()
    },
  }
}

/** Builds an idle/walk mixer from clips retargeted onto this GLB by name
 * (build-hero.mjs/build-villagers.mjs convention — entities.ts's makeAnimator
 * does the same for the hero/monsters). Animal critter GLBs ship no clips, so
 * this returns nulls and the caller keeps the bob-only path. */
function makeAmbientAnimator(model: THREE.Object3D, gltf: GLTF): Pick<Instance, 'mixer' | 'idleAction' | 'walkAction' | 'current'> {
  const idleClip = gltf.animations.find((c) => c.name === 'idle')
  const walkClip = gltf.animations.find((c) => c.name === 'walk')
  if (!idleClip || !walkClip) return { mixer: null, idleAction: null, walkAction: null, current: null }
  const mixer = new THREE.AnimationMixer(model)
  const idleAction = mixer.clipAction(idleClip)
  const walkAction = mixer.clipAction(walkClip)
  idleAction.play()
  return { mixer, idleAction, walkAction, current: idleAction }
}

/** Loads one critter spec's GLB and spawns its `spec.count` instances, tagged
 * with their flat walker index (`walkerIndexBase + i`) into the shared
 * deterministic simulation — `update()` positions them from `walkerFramesAt`
 * once the mesh exists, so initial placement doesn't need its own spawn-point
 * logic (it's just this walker's frame at whatever moment the load resolves). */
async function spawnCritters(scene: THREE.Scene, spec: ZoneAmbientCritter, walkerIndexBase: number, out: Instance[]): Promise<void> {
  const def = CRITTERS[spec.model]
  if (!def) return
  let gltf
  try {
    gltf = await new GLTFLoader().loadAsync(modelUrl(def.url))
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
    group.position.copy(tileToWorld(spec.x + spec.w / 2, spec.z + spec.h / 2))
    scene.add(group)
    const animator = makeAmbientAnimator(model, gltf)
    out.push({ group, walkerIndex: walkerIndexBase + i, ...animator })
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
