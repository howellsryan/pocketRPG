import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { tileToWorld } from './scene'
import type { EntityDiff, GearDescriptor } from '../../shared/protocol'
import { segmentDurationMs, shouldSnap, stepYaw, yawToward } from './motion'
import { MONSTER_MODELS } from '../../shared/monsterModels'

const ANIM_CROSSFADE_S = 0.15
const TURN_SPEED_RAD_PER_S = 14
// hero.glb (Quaternius Male Ranger, built by scripts/build-hero.mjs) is
// ~1.9 units tall at unit scale; scaled to read right against 1-unit tiles.
const HERO_SCALE = 0.85
// cow.glb (Quaternius Farm Animal Pack) is authored Y-up-standing but large and
// off-origin. Its skeleton carries a baked −90°X + ×100 transform, so it renders
// upright with NO extra rotation — the earlier rotation was wrong. These are the
// asset's static world bounds from `node scripts/build-cow.mjs` / inspect-glb;
// they're stable because build-cow.mjs is deterministic. THREE.Box3.setFromObject
// is unreliable for skinned meshes (ignores the skinned pose), so we scale/floor
// from these constants instead of measuring at load.
const COW_TARGET_LENGTH = 1.6
const COW_BOUNDS = { minX: -1.12, minY: -0.07, minZ: -3.78, maxX: 1.12, maxY: 5.08, maxZ: 5.4 }

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
  hp?: number
  maxHp?: number
  monsterId?: string
  name?: string
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

const templates = new Map<string, Promise<GLTF>>()

function loadTemplate(url: string): Promise<GLTF> {
  let t = templates.get(url)
  if (!t) {
    t = new GLTFLoader().loadAsync(url)
    templates.set(url, t)
  }
  return t
}

/** Binds a mixer to a freshly-cloned model, mapping the GLB's clips (named after
 * the protocol anim states by the build scripts) to actions; `die` plays once
 * and clamps. Returns null when the essential idle/walk clips are missing. */
function makeAnimator(model: THREE.Object3D, gltf: GLTF, names: readonly AnimName[]): Animator | null {
  const mixer = new THREE.AnimationMixer(model)
  const actions: Animator['actions'] = {}
  for (const name of names) {
    const clip = gltf.animations.find((c) => c.name === name)
    if (!clip) continue
    const action = mixer.clipAction(clip)
    if (name === 'die') {
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    actions[name] = action
  }
  if (!actions.idle || !actions.walk) return null
  const animator: Animator = { mixer, actions, current: null }
  playAnim(animator, 'idle')
  return animator
}

/** Loads (once) and clones the hero model. Falls back to the capsule
 * placeholder on any load failure. */
export async function createHeroMesh(): Promise<{ mesh: THREE.Object3D; animator: Animator | null }> {
  try {
    const gltf = await loadTemplate('/models/hero.glb')
    const model = cloneSkeleton(gltf.scene)
    const group = new THREE.Group()
    group.add(model)
    group.scale.setScalar(HERO_SCALE)
    const animator = makeAnimator(model, gltf, ['idle', 'walk', 'mine', 'attack', 'die'])
    return { mesh: group, animator }
  } catch {
    return { mesh: createCapsulePlaceholder(), animator: null }
  }
}

function boxPlaceholder(): THREE.Object3D {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 1.4), new THREE.MeshStandardMaterial({ color: 0x8a5a3a }))
  mesh.position.y = 0.45
  const group = new THREE.Group()
  group.add(mesh)
  return group
}

/** Loads the cow model (its own rig/clips), centring it on x/z and flooring it
 * at y=0, then scaling to a fixed body length from its bounding box — the asset
 * is authored large and off-origin. Brown-box placeholder on load failure. */
export async function createCowMesh(): Promise<{ mesh: THREE.Object3D; animator: Animator | null }> {
  try {
    const gltf = await loadTemplate('/models/cow.glb')
    const model = cloneSkeleton(gltf.scene)
    const b = COW_BOUNDS
    const centerX = (b.minX + b.maxX) / 2
    const centerZ = (b.minZ + b.maxZ) / 2
    // Centre x/z on the tile and drop feet (min.y) to y=0, in the model's own
    // (pre-group-scale) space; the group scale then applies uniformly.
    model.position.set(-centerX, -b.minY, -centerZ)
    const group = new THREE.Group()
    group.add(model)
    group.scale.setScalar(COW_TARGET_LENGTH / (b.maxZ - b.minZ))
    const animator = makeAnimator(model, gltf, ['idle', 'walk', 'die'])
    return { mesh: group, animator }
  } catch {
    return { mesh: boxPlaceholder(), animator: null }
  }
}

/** Loads the registered model for a monster (centred, floored — or hovering,
 * for flyers — and scaled to its target height). Unregistered monsters get the
 * cow path (the Phase 2 default); any load failure gets the box placeholder. */
export async function createMonsterMesh(monsterId: string | undefined): Promise<{ mesh: THREE.Object3D; animator: Animator | null }> {
  const spec = monsterId ? MONSTER_MODELS[monsterId] : undefined
  if (!spec) return createCowMesh()
  try {
    const gltf = await loadTemplate(spec.url)
    const model = cloneSkeleton(gltf.scene)
    const b = spec.bounds
    model.position.set(-(b.minX + b.maxX) / 2, -b.minY + (spec.hover ?? 0), -(b.minZ + b.maxZ) / 2)
    const group = new THREE.Group()
    group.add(model)
    group.scale.setScalar(spec.targetHeight / (b.maxY - b.minY))
    const animator = makeAnimator(model, gltf, ['idle', 'walk', 'die'])
    return { mesh: group, animator }
  } catch {
    return { mesh: boxPlaceholder(), animator: null }
  }
}

// Weapon-in-hand (Phase 5): archetype models built by scripts/build-weapons.mjs
// attach under the hero rig's hand_r joint. Grips are authored at the model
// origin, blade along +Y; the transform below orients that into the Quaternius
// rig's palm (tuned visually — see docs/world-progress.md Phase 5 entry).
const WEAPON_HOLDER = '__weapon'
const WEAPON_SCALE = 0.7
// Tuned against the IDLE pose (not the T-pose — the palm rotates ~90° when the
// arm drops, which is how the first pass ended up clipping blades through the
// body). Default carry: blade vertical at the character's side, tip down.
type Grip = { rotation: [number, number, number]; position: [number, number, number]; scale?: number }
const DEFAULT_GRIP: Grip = { rotation: [-Math.PI / 2, Math.PI / 2, Math.PI / 2], position: [0, 0.05, 0.03] }
const GRIP_OVERRIDES: Record<string, Grip> = {
  // Staff reads planted-vertical: shaft along the hanging forearm, head up.
  staff: { rotation: [Math.PI, 0, 0], position: [0, 0.1, 0] },
  bow: { rotation: [Math.PI / 2, 0, 0], position: [0, 0.05, 0.03] },
  crossbow: { rotation: [0, 0, 0], position: [0, 0.05, 0.03] },
  blunt: { rotation: [-Math.PI / 2, Math.PI / 2, Math.PI / 2], position: [0, 0.05, 0.03], scale: 0.5 },
}

function gearKey(weapon: GearDescriptor['weapon']): string {
  return weapon ? `${weapon.archetype}|${weapon.tint ?? ''}` : ''
}

/** Attaches (or replaces/removes) the weapon model matching `gear` on a hero
 * mesh. Idempotent per archetype+tint; missing hand bone (capsule fallback) or
 * a failed model load leaves the hero bare-handed. */
export async function applyWeapon(heroMesh: THREE.Object3D, gear: GearDescriptor | undefined): Promise<void> {
  const hand = heroMesh.getObjectByName('hand_r')
  if (!hand) return
  const weapon = gear?.weapon
  const key = gearKey(weapon)
  const existing = hand.getObjectByName(WEAPON_HOLDER)
  if ((existing?.userData.key ?? '') === key) return
  existing?.removeFromParent()
  if (!weapon) return

  try {
    const gltf = await loadTemplate(`/models/weapons/${weapon.archetype}.glb`)
    // Re-check after the await: a newer applyWeapon may have won the race.
    const current = hand.getObjectByName(WEAPON_HOLDER)
    if (current) {
      if (current.userData.key === key) return
      current.removeFromParent()
    }
    const model = gltf.scene.clone(true)
    if (weapon.tint) {
      const tint = new THREE.Color(weapon.tint)
      model.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const tintOne = (m: THREE.Material): THREE.Material => {
            const mat = m.clone() as THREE.MeshStandardMaterial
            if (mat.color) mat.color.copy(tint)
            return mat
          }
          obj.material = Array.isArray(obj.material) ? obj.material.map(tintOne) : tintOne(obj.material)
        }
      })
    }
    const grip = GRIP_OVERRIDES[weapon.archetype] ?? DEFAULT_GRIP
    const holder = new THREE.Group()
    holder.name = WEAPON_HOLDER
    holder.userData.key = key
    model.rotation.set(...grip.rotation)
    model.position.set(...grip.position)
    model.scale.setScalar(grip.scale ?? WEAPON_SCALE)
    holder.add(model)
    hand.add(holder)
  } catch {
    // Bare hands on any load failure — appearance never blocks play.
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
  if (diff.hp != null) entity.hp = diff.hp
  if (diff.maxHp != null) entity.maxHp = diff.maxHp
  if (diff.monsterId != null) entity.monsterId = diff.monsterId
  if (diff.name != null) entity.name = diff.name
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
