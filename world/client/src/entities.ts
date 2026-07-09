import * as THREE from 'three'
import { tileToWorld } from './scene'
import type { EntityDiff } from '../../shared/protocol'

const MOVE_DURATION_MS = 600

export type Entity = {
  id: string
  mesh: THREE.Object3D
  prevPos: THREE.Vector3
  nextPos: THREE.Vector3
  moveStartedAt: number
  anim: EntityDiff['anim']
}

export function createCapsulePlaceholder(): THREE.Mesh {
  const geometry = new THREE.CapsuleGeometry(0.3, 0.6, 4, 8)
  const material = new THREE.MeshStandardMaterial({ color: 0xd8b06a })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.y = 0.6
  return mesh
}

export function createEntity(id: string, x: number, z: number, mesh: THREE.Object3D): Entity {
  const pos = tileToWorld(x, z)
  pos.y = mesh.position.y
  mesh.position.copy(pos)
  return { id, mesh, prevPos: pos.clone(), nextPos: pos.clone(), moveStartedAt: performance.now(), anim: 'idle' }
}

/** Called once per incoming diff for this entity — starts a fresh 600ms lerp
 * from wherever the mesh currently sits toward the newly reported tile. */
export function setEntityTarget(entity: Entity, diff: EntityDiff): void {
  const target = tileToWorld(diff.x, diff.z)
  target.y = entity.mesh.position.y
  entity.prevPos.copy(entity.mesh.position)
  entity.nextPos.copy(target)
  entity.moveStartedAt = performance.now()
  entity.anim = diff.anim
}

/** Advances the mesh's position along its current lerp. Call every animation frame. */
export function updateEntity(entity: Entity, now: number): void {
  const t = Math.min(1, (now - entity.moveStartedAt) / MOVE_DURATION_MS)
  entity.mesh.position.lerpVectors(entity.prevPos, entity.nextPos, t)
}
