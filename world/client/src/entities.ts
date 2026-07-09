import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { tileToWorld } from './scene'
import type { EntityDiff } from '../../shared/protocol'

const MOVE_DURATION_MS = 600
const ANIM_CROSSFADE_S = 0.15

// Substring match against the clip names actually found in hero.glb (see
// world/scripts/list-anims.mjs) — there is no clip literally named "Idle" or
// "Walk", but idle_loop/walk_loop are the unambiguous plain base cycles (as
// opposed to walk_formal_loop/walk_carry_loop, which imply a specific context).
const IDLE_CLIP = 'idle_loop'
const WALK_CLIP = 'walk_loop'

export type Animator = {
  mixer: THREE.AnimationMixer
  idle: THREE.AnimationAction
  walk: THREE.AnimationAction
  current: THREE.AnimationAction
}

export type Entity = {
  id: string
  mesh: THREE.Object3D
  prevPos: THREE.Vector3
  nextPos: THREE.Vector3
  moveStartedAt: number
  anim: EntityDiff['anim']
  animator: Animator | null
}

export function createCapsulePlaceholder(): THREE.Mesh {
  const geometry = new THREE.CapsuleGeometry(0.3, 0.6, 4, 8)
  const material = new THREE.MeshStandardMaterial({ color: 0xd8b06a })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.y = 0.6
  return mesh
}

let heroTemplate: Promise<GLTF> | null = null

function loadHeroTemplate(): Promise<GLTF> {
  if (!heroTemplate) {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    heroTemplate = loader.loadAsync('/models/hero.glb')
  }
  return heroTemplate
}

/** Loads (once) and clones the hero model, with a mixer + idle/walk actions
 * bound to this clone's own skeleton. Falls back to the capsule placeholder
 * if the model or its expected clips can't be found. */
export async function createHeroMesh(): Promise<{ mesh: THREE.Object3D; animator: Animator | null }> {
  try {
    const gltf = await loadHeroTemplate()
    const mesh = cloneSkeleton(gltf.scene)
    const mixer = new THREE.AnimationMixer(mesh)
    const idleClip = gltf.animations.find((c) => c.name === IDLE_CLIP)
    const walkClip = gltf.animations.find((c) => c.name === WALK_CLIP)
    if (!idleClip || !walkClip) return { mesh, animator: null }
    const idle = mixer.clipAction(idleClip)
    const walk = mixer.clipAction(walkClip)
    idle.play()
    return { mesh, animator: { mixer, idle, walk, current: idle } }
  } catch {
    return { mesh: createCapsulePlaceholder(), animator: null }
  }
}

export function createEntity(id: string, x: number, z: number, mesh: THREE.Object3D, animator: Animator | null = null): Entity {
  const pos = tileToWorld(x, z)
  pos.y = mesh.position.y
  mesh.position.copy(pos)
  return { id, mesh, prevPos: pos.clone(), nextPos: pos.clone(), moveStartedAt: performance.now(), anim: 'idle', animator }
}

function crossfadeTo(animator: Animator, next: THREE.AnimationAction): void {
  if (animator.current === next) return
  next.reset().fadeIn(ANIM_CROSSFADE_S).play()
  animator.current.fadeOut(ANIM_CROSSFADE_S)
  animator.current = next
}

/** Called once per incoming diff for this entity — starts a fresh 600ms lerp
 * from wherever the mesh currently sits toward the newly reported tile, and
 * crossfades the animation if it changed. */
export function setEntityTarget(entity: Entity, diff: EntityDiff): void {
  const target = tileToWorld(diff.x, diff.z)
  target.y = entity.mesh.position.y
  entity.prevPos.copy(entity.mesh.position)
  entity.nextPos.copy(target)
  entity.moveStartedAt = performance.now()
  entity.anim = diff.anim

  if (entity.animator) {
    crossfadeTo(entity.animator, diff.anim === 'walk' ? entity.animator.walk : entity.animator.idle)
  }
}

/** Advances the mesh's position along its current lerp and its animation
 * mixer, if any. Call every animation frame. */
export function updateEntity(entity: Entity, now: number, deltaSeconds: number): void {
  const t = Math.min(1, (now - entity.moveStartedAt) / MOVE_DURATION_MS)
  entity.mesh.position.lerpVectors(entity.prevPos, entity.nextPos, t)
  entity.animator?.mixer.update(deltaSeconds)
}
