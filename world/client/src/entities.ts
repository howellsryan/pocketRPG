import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { tileToWorld } from './scene'
import type { EntityDiff } from '../../shared/protocol'
import { segmentDurationMs, shouldSnap, stepYaw, yawToward } from './motion'

const ANIM_CROSSFADE_S = 0.15
const TURN_SPEED_RAD_PER_S = 14
// hero.glb (Quaternius Male Ranger, built by scripts/build-hero.mjs) is
// ~1.9 units tall at unit scale; scaled to read right against 1-unit tiles.
const HERO_SCALE = 0.85

export type AnimName = EntityDiff['anim']

export type Animator = {
  mixer: THREE.AnimationMixer
  actions: Partial<Record<AnimName, THREE.AnimationAction>>
  current: THREE.AnimationAction | null
}

type Waypoint = { x: number; z: number }

export type Entity = {
  id: string
  mesh: THREE.Object3D
  queue: Waypoint[]
  fromPos: THREE.Vector3
  toPos: THREE.Vector3
  segmentStart: number
  segmentDuration: number
  moving: boolean
  serverAnim: AnimName
  targetYaw: number
  animator: Animator | null
}

export function createCapsulePlaceholder(): THREE.Object3D {
  const geometry = new THREE.CapsuleGeometry(0.3, 0.6, 4, 8)
  const material = new THREE.MeshStandardMaterial({ color: 0xd8b06a })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.y = 0.6
  const group = new THREE.Group()
  group.add(mesh)
  return group
}

let heroTemplate: Promise<GLTF> | null = null

function loadHeroTemplate(): Promise<GLTF> {
  if (!heroTemplate) heroTemplate = new GLTFLoader().loadAsync('/models/hero.glb')
  return heroTemplate
}

/** Loads (once) and clones the hero model with a mixer whose actions are named
 * exactly after the protocol's anim states (scripts/build-hero.mjs guarantees
 * the clip names). Falls back to the capsule placeholder on any load failure. */
export async function createHeroMesh(): Promise<{ mesh: THREE.Object3D; animator: Animator | null }> {
  try {
    const gltf = await loadHeroTemplate()
    const model = cloneSkeleton(gltf.scene)
    const group = new THREE.Group()
    group.add(model)
    group.scale.setScalar(HERO_SCALE)
    const mixer = new THREE.AnimationMixer(model)
    const actions: Animator['actions'] = {}
    for (const name of ['idle', 'walk', 'mine', 'attack', 'die'] as const) {
      const clip = gltf.animations.find((c) => c.name === name)
      if (!clip) continue
      const action = mixer.clipAction(clip)
      if (name === 'die') {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
      }
      actions[name] = action
    }
    if (!actions.idle || !actions.walk) return { mesh: group, animator: null }
    const animator: Animator = { mixer, actions, current: null }
    playAnim(animator, 'idle')
    return { mesh: group, animator }
  } catch {
    return { mesh: createCapsulePlaceholder(), animator: null }
  }
}

export function createEntity(id: string, x: number, z: number, mesh: THREE.Object3D, animator: Animator | null = null): Entity {
  const pos = tileToWorld(x, z)
  mesh.position.copy(pos)
  return {
    id,
    mesh,
    queue: [],
    fromPos: pos.clone(),
    toPos: pos.clone(),
    segmentStart: 0,
    segmentDuration: segmentDurationMs(0),
    moving: false,
    serverAnim: 'idle',
    targetYaw: mesh.rotation.y,
    animator,
  }
}

function playAnim(animator: Animator, name: AnimName): void {
  const action = animator.actions[name] ?? animator.actions.idle
  if (!action || action === animator.current) return
  action.reset().fadeIn(ANIM_CROSSFADE_S).play()
  animator.current?.fadeOut(ANIM_CROSSFADE_S)
  animator.current = action
}

/** Called once per incoming diff for this entity: queues the reported tile so
 * playback stays smooth at one segment per tick, teleporting only when the
 * client has fallen hopelessly behind (hidden tab, long GC pause). */
export function applyEntityDiff(entity: Entity, diff: EntityDiff): void {
  entity.serverAnim = diff.anim
  entity.queue.push({ x: diff.x, z: diff.z })
  if (shouldSnap(entity.queue.length)) {
    const latest = entity.queue[entity.queue.length - 1]
    entity.queue.length = 0
    const pos = tileToWorld(latest.x, latest.z)
    entity.mesh.position.copy(pos)
    entity.fromPos.copy(pos)
    entity.toPos.copy(pos)
    entity.moving = false
  }
}

function startNextSegment(entity: Entity, now: number): void {
  while (entity.queue.length > 0) {
    const wp = entity.queue.shift()!
    const target = tileToWorld(wp.x, wp.z)
    if (target.distanceToSquared(entity.mesh.position) < 1e-6) continue
    entity.fromPos.copy(entity.mesh.position)
    entity.toPos.copy(target)
    entity.segmentStart = now
    entity.segmentDuration = segmentDurationMs(entity.queue.length)
    entity.targetYaw = yawToward(target.x - entity.fromPos.x, target.z - entity.fromPos.z)
    entity.moving = true
    return
  }
}

/** Advances position playback, facing, and the animation mixer. Call every
 * animation frame. Walk/idle is derived from actual traversal so late diffs
 * can't strobe the animation; non-movement anims follow the server state. */
export function updateEntity(entity: Entity, now: number, deltaSeconds: number): void {
  if (!entity.moving) startNextSegment(entity, now)
  if (entity.moving) {
    const t = Math.min(1, (now - entity.segmentStart) / entity.segmentDuration)
    entity.mesh.position.lerpVectors(entity.fromPos, entity.toPos, t)
    if (t >= 1) {
      entity.moving = false
      startNextSegment(entity, now)
    }
  }

  entity.mesh.rotation.y = stepYaw(entity.mesh.rotation.y, entity.targetYaw, TURN_SPEED_RAD_PER_S * deltaSeconds)

  if (entity.animator) {
    const name: AnimName = entity.moving ? 'walk' : entity.serverAnim === 'walk' ? 'idle' : entity.serverAnim
    playAnim(entity.animator, name)
    entity.animator.mixer.update(deltaSeconds)
  }
}
