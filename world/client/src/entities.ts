import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { tileToWorld } from './scene'
import type { EntityDiff, GearDescriptor } from '../../shared/protocol'
import { ATTACK_ANIMS, MOVE_DURATION_MS, animForSegment, gaitBob, isAttackAnim, resolveGltfAnim, segmentDurationMs, shouldSnap, stepYaw, yawToward } from './motion'
import { MONSTER_MODELS } from '../../shared/monsterModels'
import { buildProcCreature, creatureSpecFor, type ProcCreature } from './procCreature'
// Shared per-item placement registry — the SAME resolver the combat arena /
// equip modal uses (src/utils/equipModels.js + src/data/equipmentModels.json),
// so a registry-covered item renders with an identical model + bone-space
// transform + tint on both heroes. Models copied into the world bundle by
// world/scripts/build-equip.mjs.
import { getWeaponModel, getGearModel, getMonsterModel, resolveHeadGearModel as resolveHeadGearModelShared } from '../../../src/utils/equipModels.js'
import { monsterAttackWindup } from '../../../src/utils/combatWindup.js'
import { TICK_DURATION } from '../../../src/utils/constants.js'

const ANIM_CROSSFADE_S = 0.15
const TURN_SPEED_RAD_PER_S = 14
// hero.glb (Superhero_Male_FullBody + Peasant outfit, built by
// scripts/build-hero.mjs — same base character as the combat arena's
// public/3d-samples/hero.glb, item 12) is ~1.82 units tall at unit scale
// (T-pose bind bounds; the previous Male_Ranger export measured ~1.87) —
// scaled up slightly from the old 0.85 to keep the same ~1.59-unit rendered
// height against 1-unit tiles rather than shrinking the hero when the base
// model changed underneath it.
const HERO_SCALE = 0.873
// Rendered height (1.82 bind-pose units × HERO_SCALE) — the pick proxy's span.
const HERO_HEIGHT = 1.82 * HERO_SCALE
// cow.glb (Quaternius Farm Animal Pack) is authored Y-up-standing but large and
// off-origin. Its skeleton carries a baked −90°X + ×100 transform, so it renders
// upright with NO extra rotation — the earlier rotation was wrong. These are the
// asset's static world bounds from `node scripts/build-cow.mjs` / inspect-glb;
// they're stable because build-cow.mjs is deterministic. THREE.Box3.setFromObject
// is unreliable for skinned meshes (ignores the skinned pose), so we scale/floor
// from these constants instead of measuring at load.
const COW_TARGET_LENGTH = 1.6
const COW_BOUNDS = { minX: -1.12, minY: -0.07, minZ: -3.78, maxX: 1.12, maxY: 5.08, maxZ: 5.4 }

// 'run' is a client-local rendering choice — derived from segment length, not
// sent over the wire — so it extends the protocol's anim union rather than
// widening it.
export type AnimName = EntityDiff['anim'] | 'run'

export type GltfAnimator = {
  kind: 'gltf'
  mixer: THREE.AnimationMixer
  actions: Partial<Record<AnimName, THREE.AnimationAction>>
  current: THREE.AnimationAction | null
  /** Set only for boss GLBs with no walk clip (monsterModels.ts's
   * `noLocomotionClip`) — the procedural gait target (the cloned model, not
   * the outer group main.ts positions) and its bind-pose local Y/Z to offset
   * from each frame. */
  gait?: { target: THREE.Object3D; baseY: number; baseRotZ: number }
  /** Edge-detects the server's one-tick attack signal so a fresh swing fires
   * the one-shot attack clip exactly once (cleared when the signal drops back
   * to a non-attack anim). Mirrors ProcAnimator's `triggered`. */
  swingLatched?: boolean
  /** Sub-tick delay (ms) between the server's swing pre-signal and actually
   * starting the clip, so the clip's impact frame lands on the hit splat — the
   * SHARED windup the combat arena uses (src/utils/combatWindup.js), derived from
   * the monster's `attackImpactSec`. 0/undefined => start immediately (hero,
   * monsters with no impact metadata). */
  swingDelayMs?: number
  /** A pre-signalled swing waiting for `swingDelayMs` to elapse before its clip
   * starts; set on the edge, fired (or cancelled by death) in updateEntity. */
  pendingSwingAt?: number
  pendingSwingAction?: THREE.AnimationAction | null
}

function isAttackAction(animator: GltfAnimator, action: THREE.AnimationAction): boolean {
  return ATTACK_ANIMS.some((n) => animator.actions[n] === action)
}

/** Procedural blend-shell creatures (creatures3d) drive their own rig by state
 * rather than a mixer; `triggered` edge-detects so each server swing fires the
 * attack once and a death→idle transition re-spawns the rig. */
export type ProcAnimator = { kind: 'proc'; proc: ProcCreature; triggered: 'attack' | 'death' | null }
export type Animator = GltfAnimator | ProcAnimator

/** Boss/monster procedural render height in tiles (blend-shell path only). */
const PROC_TARGET_HEIGHT: Record<string, number> = { warlord_grondar: 2.8 }

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
  /** Combat opponent's entity id (server-reported), or null when not fighting.
   * Snapshot semantics — set unconditionally from each diff, never merged, so
   * combat-end (diff omits it) actually clears a stale facing target. */
  targetId: string | null
  /** Which clip the current movement segment plays — derived once per segment
   * from its planar length so a 2-tile running step never plays the walk clip
   * sped up. */
  segmentAnim: 'walk' | 'run'
}

/** Skinned characters animate far from their bind-pose bounds, so three.js can
 * frustum-cull them incorrectly — most visibly after a background/resume snaps
 * the mesh to a new tile, leaving the player invisible to themselves. Disabling
 * per-object culling on characters is the standard fix (they're always near the
 * camera anyway). */
function disableFrustumCulling(root: THREE.Object3D): void {
  root.traverse((obj) => {
    obj.frustumCulled = false
    obj.castShadow = true
  })
}

/** Name/handle of the invisible box input.ts raycasts instead of the model.
 * three.js resolves a SkinnedMesh hit by bone-transforming EVERY vertex of
 * EVERY triangle (SkinnedMesh.getVertexPosition), and it does that for any ray
 * that merely clips the bind-pose bounding sphere — measured at 40–50 ms for
 * Warlord Grondar's 39 k-triangle mesh, hit once per animation frame while the
 * cursor sits on him (hover is rAF-throttled) plus once per click. That alone
 * pinned the frame budget while attacking him. A 12-triangle box costs
 * microseconds and gives the same Pickable, since pickTargetOf walks up to the
 * entity group. */
export const PICK_PROXY = '__pick'

// Shared across every entity: never rendered (visible=false), never disposed
// on entity removal, so one geometry/material for all of them.
const PICK_PROXY_GEOMETRY = new THREE.BoxGeometry(1, 1, 1)
const PICK_PROXY_MATERIAL = new THREE.MeshBasicMaterial()

/** Footprint of the pick box: roughly the tile the entity stands on, capped so
 * a 2.8-tile boss doesn't swallow clicks on everything beside him. */
function proxyFootprint(height: number): number {
  return Math.min(1.6, Math.max(0.6, height * 0.55))
}

/** Adds the pick proxy to a rendered entity group. `height` is in world units;
 * the group's uniform scale is divided out because the proxy rides inside it. */
function addPickProxy(group: THREE.Object3D, height: number): void {
  const scale = group.scale.x || 1
  const width = proxyFootprint(height)
  const proxy = new THREE.Mesh(PICK_PROXY_GEOMETRY, PICK_PROXY_MATERIAL)
  proxy.name = PICK_PROXY
  proxy.visible = false
  proxy.castShadow = false
  proxy.receiveShadow = false
  proxy.scale.set(width / scale, height / scale, width / scale)
  proxy.position.y = height / 2 / scale
  group.add(proxy)
  group.userData.pickProxy = proxy
}

/** The object input.ts should raycast for this entity — its pick proxy, or the
 * mesh itself when it has none (placeholders). */
export function pickProxyOf(mesh: THREE.Object3D): THREE.Object3D {
  return (mesh.userData.pickProxy as THREE.Object3D | undefined) ?? mesh
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

/** The arena registry's *_full_helm.glb exports are meshopt-compressed
 * (EXT_meshopt_compression) — GLTFLoader throws "setMeshoptDecoder must be
 * called before loading compressed files" without this, which the caller's
 * try/catch swallows into "appearance never blocks play", silently leaving
 * every helm slot bare. Capes/shields/weapons aren't compressed so this was
 * invisible until a head-slot item exercised it.
 * Exported so a regression test can drive the exact production loader (with a
 * mocked fetch) rather than re-implementing the decoder wiring separately. */
export function loadTemplate(url: string): Promise<GLTF> {
  let t = templates.get(url)
  if (!t) {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    t = loader.loadAsync(url)
    templates.set(url, t)
  }
  return t
}

/** Binds a mixer to a freshly-cloned model, mapping the GLB's clips (named after
 * the protocol anim states by the build scripts) to actions; `die` plays once
 * and clamps. Returns null when the essential idle/walk clips are missing. */
function makeAnimator(model: THREE.Object3D, gltf: GLTF, names: readonly AnimName[]): Animator | null {
  const mixer = new THREE.AnimationMixer(model)
  const actions: GltfAnimator['actions'] = {}
  for (const name of names) {
    const clip = gltf.animations.find((c) => c.name === name)
    if (!clip) continue
    const action = mixer.clipAction(clip)
    if (name === 'die' || name === 'attack' || name === 'attack_ranged' || name === 'attack_magic' || name === 'attack_special') {
      // die and every attack are one-shots. The server flags an attack anim for
      // only the single tick a swing resolves, then drops back to idle — so a
      // looping attack action gets cut off after ~1 tick and barely reads.
      // Play it once and clamp; updateEntity latches the trigger so the whole
      // swing plays through, matching the combat arena's monster attack.
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    actions[name] = action
  }
  // Boss GLBs (Warlord Grondar) ship an idle but no locomotion clip — alias
  // walk to idle so they still render from the GLB instead of falling back to
  // the procedural creature; a wandering boss reads as gliding, acceptable
  // until a bespoke walk exists.
  if (!actions.walk && actions.idle) actions.walk = actions.idle
  if (!actions.idle || !actions.walk) return null
  const animator: GltfAnimator = { kind: 'gltf', mixer, actions, current: null }
  playAnim(animator, 'idle')
  return animator
}

/** Loads (once) and clones the hero model. Falls back to the capsule
 * placeholder on any load failure. */
export async function createHeroMesh(): Promise<{ mesh: THREE.Object3D; animator: Animator | null }> {
  try {
    const gltf = await loadTemplate('/models/hero.glb')
    const model = cloneSkeleton(gltf.scene)
    disableFrustumCulling(model)
    const group = new THREE.Group()
    group.add(model)
    group.scale.setScalar(HERO_SCALE)
    addPickProxy(group, HERO_HEIGHT)
    const animator = makeAnimator(model, gltf, ['idle', 'walk', 'run', 'mine', 'attack', 'attack_ranged', 'attack_magic', 'attack_special', 'die'])
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
    disableFrustumCulling(model)
    const b = COW_BOUNDS
    const centerX = (b.minX + b.maxX) / 2
    const centerZ = (b.minZ + b.maxZ) / 2
    // Centre x/z on the tile and drop feet (min.y) to y=0, in the model's own
    // (pre-group-scale) space; the group scale then applies uniformly.
    model.position.set(-centerX, -b.minY, -centerZ)
    const group = new THREE.Group()
    group.add(model)
    group.scale.setScalar(COW_TARGET_LENGTH / (b.maxZ - b.minZ))
    addPickProxy(group, (b.maxY - b.minY) * group.scale.y)
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
  if (spec) {
    try {
      const gltf = await loadTemplate(spec.url)
      const model = cloneSkeleton(gltf.scene)
      disableFrustumCulling(model)
      const b = spec.bounds
      model.position.set(-(b.minX + b.maxX) / 2, -b.minY + (spec.hover ?? 0), -(b.minZ + b.maxZ) / 2)
      const group = new THREE.Group()
      group.add(model)
      group.scale.setScalar(spec.targetHeight / (b.maxY - b.minY))
      addPickProxy(group, spec.targetHeight + (spec.hover ?? 0))
      const animator = makeAnimator(model, gltf, ['idle', 'walk', 'attack', 'die'])
      if (animator?.kind === 'gltf') {
        if (spec.noLocomotionClip) animator.gait = { target: model, baseY: model.position.y, baseRotZ: model.rotation.z }
        // Sub-tick swing delay so this monster's impact frame lands on the hit
        // splat, exactly as the combat arena aligns it (shared windup helper).
        animator.swingDelayMs = monsterAttackWindup(getMonsterModel(monsterId!)?.attackImpactSec ?? null, TICK_DURATION).startDelayMs
      }
      return { mesh: group, animator }
    } catch {
      return { mesh: boxPlaceholder(), animator: null }
    }
  }
  // No GLB: render a procedural blend-shell creature if the monster has a
  // creatures3d spec (e.g. Warlord Grondar). pasture_bull keeps its cow model.
  if (monsterId && monsterId !== 'pasture_bull' && creatureSpecFor(monsterId)) {
    const height = PROC_TARGET_HEIGHT[monsterId] ?? 2.4
    try {
      const proc = await buildProcCreature(monsterId, height)
      if (proc) {
        const group = new THREE.Group()
        group.add(proc.group)
        disableFrustumCulling(group)
        // After disableFrustumCulling — it forces castShadow on everything it
        // walks, and the proxy must stay out of the shadow pass.
        addPickProxy(group, height)
        return { mesh: group, animator: { kind: 'proc', proc, triggered: null } }
      }
    } catch { /* fall through to the cow placeholder */ }
  }
  return createCowMesh()
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

function weaponKey(weapon: GearDescriptor['weapon']): string {
  return weapon ? `${weapon.archetype}|${weapon.tint ?? ''}` : ''
}

/** Recolors a cloned material by the tier tint. Weapon pieces (small, mostly
 * untextured metal) overwrite the color outright; armor pieces (Quaternius
 * outfit exports with webp base-color textures) multiply instead, so tinting
 * recolors the cloth/leather read without flattening the texture detail —
 * mirrors src/3d/heroAttach.js's applyEquipTint(..., allMaterials=true). */
function tintMaterial(mat: THREE.Material, tint: THREE.Color, multiply: boolean): THREE.Material {
  const m = mat.clone() as THREE.MeshStandardMaterial
  if (m.color) multiply ? m.color.multiply(tint) : m.color.copy(tint)
  return m
}

function tintObject(obj: THREE.Object3D, tint: string | undefined, multiply: boolean): void {
  if (!tint) return
  const color = new THREE.Color(tint)
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => tintMaterial(m, color, multiply))
        : tintMaterial(o.material, color, multiply)
    }
  })
}

// Registry placement spec (src/utils/equipModels.js). Loosely typed — the JS
// resolver returns object literals; we only read the render fields.
type PlacementSpec = {
  model: string
  bone: string | null
  position: [number, number, number]
  rotationDeg: [number, number, number]
  scale: number
  tint: string | null
  tintAll: 'replace' | false
  slot?: string
  hideHead?: boolean
  hideBody?: boolean
  hideLegs?: boolean
  hideFeet?: boolean
}

/** Registry `model` (e.g. 'weapons/trident.glb') → world asset URL under the
 * equip dir populated by world/scripts/build-equip.mjs. */
function equipModelUrl(model: string): string {
  return `/models/equip/${model}`
}

/** Port of src/3d/heroAttach.js applyEquipTint so a registry piece recolours
 * exactly as it does in the arena. Materials are CLONED first — loadTemplate
 * hands back a shared cached GLTF, so mutating a material in place would bleed
 * the tint onto every other instance of the same model. */
function applyEquipTintRegistry(obj: THREE.Object3D, tint: string | null, mode: 'replace' | true | false): void {
  if (!tint) return
  const c = new THREE.Color(tint)
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.material) return
    const one = (m: THREE.Material): THREE.Material => {
      const mm = m.clone() as THREE.MeshStandardMaterial
      if (mm.color) {
        if (mode === 'replace') {
          mm.color.copy(c)
          if (mm.map) { mm.map = null; mm.needsUpdate = true }
        } else if (mode === true || /steel/i.test(mm.name || '')) {
          mm.color.multiply(c)
        }
      }
      return mm
    }
    o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material)
  })
}

/** Applies a registry placement spec (bone-space transform in degrees) to a
 * freshly cloned model — the world equivalent of heroAttach.js's attach math,
 * so the piece lands identically to the arena. */
function placeRegistryModel(model: THREE.Object3D, spec: PlacementSpec, tintMode: 'replace' | true | false): void {
  const [px, py, pz] = spec.position
  const [rx, ry, rz] = spec.rotationDeg
  model.position.set(px, py, pz)
  model.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), THREE.MathUtils.degToRad(rz))
  model.scale.setScalar(spec.scale)
  applyEquipTintRegistry(model, spec.tint, tintMode)
}

/** Attaches (or replaces/removes) the equipped weapon on a hero mesh. Prefers
 * the arena's per-item registry model (exact model + placement + tint parity
 * with the equip modal); falls back to the archetype silhouette + tier tint for
 * weapons the registry doesn't cover. Idempotent; a missing hand bone (capsule
 * fallback) or a failed load leaves the hero bare-handed. */
async function applyWeaponPiece(
  heroMesh: THREE.Object3D,
  weapon: GearDescriptor['weapon'],
  weaponItemId: string | undefined,
): Promise<void> {
  const hand = heroMesh.getObjectByName('hand_r')
  if (!hand) return
  const spec = (weaponItemId ? getWeaponModel(weaponItemId) : null) as PlacementSpec | null
  // Registry key is itemId-exact (tint/placement ride with it); the archetype
  // fallback keys on archetype+tint as before.
  const key = spec ? `reg:${weaponItemId}` : weaponKey(weapon)
  const existing = hand.getObjectByName(WEAPON_HOLDER)
  if ((existing?.userData.key ?? '') === key) return
  existing?.removeFromParent()
  if (!spec && !weapon) return

  const url = spec ? equipModelUrl(spec.model) : `/models/weapons/${weapon!.archetype}.glb`
  try {
    const gltf = await loadTemplate(url)
    // Re-check after the await: a newer applyWeaponPiece may have won the race.
    const current = hand.getObjectByName(WEAPON_HOLDER)
    if (current) {
      if (current.userData.key === key) return
      current.removeFromParent()
    }
    const model = gltf.scene.clone(true)
    const holder = new THREE.Group()
    holder.name = WEAPON_HOLDER
    holder.userData.key = key
    if (spec) {
      placeRegistryModel(model, spec, spec.tintAll)
    } else {
      const w = weapon!
      tintObject(model, w.tint, false)
      const grip = GRIP_OVERRIDES[w.archetype] ?? DEFAULT_GRIP
      model.rotation.set(...grip.rotation)
      model.position.set(...grip.position)
      model.scale.setScalar(grip.scale ?? WEAPON_SCALE)
    }
    holder.add(model)
    hand.add(holder)
  } catch {
    // Bare hands on any load failure — appearance never blocks play.
  }
}

// Armor (open-world/combat-arena parity): body/legs outfit pieces built by
// scripts/build-armor.mjs from the arena's own already-tiered Quaternius outfit
// exports (public/3d-samples/outfits/ranger_*.glb), which carry the same
// 65-joint universal rig as world's hero.glb — no bone position/rotation
// needed, just a skeleton rebind. Head/shield/cape/neck are rigid props
// attached per-item through the shared registry (applyRigidGearPiece).
const ARMOR_SLOTS = ['body', 'legs', 'boots'] as const
type ArmorSlot = (typeof ARMOR_SLOTS)[number]
const ARMOR_HOLDER: Record<ArmorSlot, string> = { body: '__armor_body', legs: '__armor_legs', boots: '__armor_boots' }

// Hero-anatomy regions a covering piece can cut out (head → helm, body/legs →
// outfit). Bone names are the Quaternius universal rig — mirrors
// src/3d/heroAttach.js's HIDE_REGION_BONES.
const HIDE_REGIONS = ['head', 'body', 'legs', 'feet'] as const
type HideRegion = (typeof HIDE_REGIONS)[number]
const HIDE_REGION_BONES: Record<HideRegion, string[]> = {
  head: ['Head'],
  body: ['spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r'],
  legs: ['pelvis', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'ball_leaf_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r', 'ball_leaf_r'],
  // Feet only — equipped boots hide the base hero's built-in footwear. These
  // bones are also in `legs`, so platelegs keep hiding the feet unchanged; this
  // is an independent channel boots trip. Mirrors heroAttach.js.
  feet: ['foot_l', 'ball_l', 'ball_leaf_l', 'foot_r', 'ball_r', 'ball_leaf_r'],
}

type HideMaskControl = { setHidden(regions: Partial<Record<HideRegion, boolean>>): void }

/** Ports src/3d/heroAttach.js's setupHideMask: a per-vertex mask lets an
 * equipped helm/body/legs piece cut the hero's own baked-in anatomy out of the
 * render, exactly, in every pose — a bone-transform approach can't do that
 * without pinching at the joints, and posed skin would otherwise bulge through
 * the armor at animation extremes. Applied to every skinned sub-mesh of the
 * hero (body + any hair/accessory meshes sharing the skeleton), not just the
 * primary one. */
function setupArmorHideMask(skinnedMeshes: THREE.SkinnedMesh[]): HideMaskControl | null {
  const meshes = skinnedMeshes.filter((m) => m.skeleton)
  if (!meshes.length) return null
  const hidden = new THREE.Vector4(0, 0, 0, 0) // onBeforeCompile fires lazily on first
  // render, so the desired state must be the shader's INITIAL uniform value.
  for (const skinnedMesh of meshes) {
    const regionIdx = HIDE_REGIONS.map((region) => {
      const wanted = new Set(HIDE_REGION_BONES[region])
      return new Set(skinnedMesh.skeleton.bones.map((b, i) => (wanted.has(b.name) ? i : -1)).filter((i) => i >= 0))
    })
    const geo = skinnedMesh.geometry
    const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight
    const n = geo.attributes.position.count
    const mask = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) {
        const j = si.getComponent(i, k), w = sw.getComponent(i, k)
        for (let r = 0; r < 4; r++) if (regionIdx[r].has(j)) mask[i * 4 + r] += w
      }
    }
    geo.setAttribute('hideMask', new THREE.BufferAttribute(mask, 4))
    const mats = Array.isArray(skinnedMesh.material) ? skinnedMesh.material : [skinnedMesh.material]
    for (const mat of mats) {
      const m = mat as THREE.MeshStandardMaterial
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uHideMask = { value: hidden }
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec4 hideMask;\nvarying vec4 vHideMask;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHideMask = hideMask;')
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec4 uHideMask;\nvarying vec4 vHideMask;')
          .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (dot(uHideMask, step(vec4(0.5, 0.35, 0.35, 0.35), vHideMask)) > 0.0) discard;')
      }
      m.needsUpdate = true
    }
  }
  return {
    setHidden(regions) {
      hidden.set(regions.head ? 1 : 0, regions.body ? 1 : 0, regions.legs ? 1 : 0, regions.feet ? 1 : 0)
    },
  }
}

// Rigid registry gear (head/shield/cape/neck): non-skinned props attached to a
// single bone with the arena's per-item placement — the world equivalent of
// heroAttach.js attachGearList's rigid branch. body/legs stay on the skinned
// rebind path above.
const RIGID_SLOTS = ['head', 'shield', 'cape', 'neck'] as const
type RigidSlot = (typeof RIGID_SLOTS)[number]
const RIGID_HOLDER: Record<RigidSlot, string> = {
  head: '__gear_head', shield: '__gear_shield', cape: '__gear_cape', neck: '__gear_neck',
}

/** Resolves a head-slot item to its render spec. Open headwear (wizard hat —
 * no hideHead) renders its own registry model on top of the head; full helms
 * and unmodeled head items render the shared default helm shell (hideHead
 * override). Same rule the arena uses (src/utils/equipModels.js). */
function resolveHeadGearModel(itemId: string | undefined): PlacementSpec | null {
  if (!itemId) return null
  return resolveHeadGearModelShared(itemId) as PlacementSpec | null
}

/** Attaches (or replaces/removes) one rigid registry gear piece on its bone.
 * Idempotent per itemId; a spec that isn't for this slot, a missing bone, or a
 * failed load leaves the slot bare. */
async function applyRigidGearPiece(heroMesh: THREE.Object3D, slot: RigidSlot, itemId: string | undefined): Promise<void> {
  const spec = (itemId ? (slot === 'head' ? resolveHeadGearModel(itemId) : (getGearModel(itemId) as PlacementSpec | null)) : null)
  const valid = !!(spec && spec.slot === slot && spec.bone)
  const holderName = RIGID_HOLDER[slot]
  const key = valid ? `reg:${itemId}` : ''
  const existing = heroMesh.getObjectByName(holderName)
  if ((existing?.userData.key ?? '') === key) return
  existing?.removeFromParent()
  if (!valid) return
  const bone = heroMesh.getObjectByName(spec!.bone!)
  if (!bone) return
  try {
    const gltf = await loadTemplate(equipModelUrl(spec!.model))
    // Re-check after the await: a newer call may have won the race.
    const current = heroMesh.getObjectByName(holderName)
    if (current) {
      if (current.userData.key === key) return
      current.removeFromParent()
    }
    // cloneSkeleton (not Object3D.clone) so a skinned prop with its own rig —
    // the cape's drape skeleton — rebinds onto its own cloned bones instead of
    // collapsing; a plain clone shares the cached template's skeleton and the
    // mesh renders empty. Harmless for the static props (helm/shield/amulet).
    const model = cloneSkeleton(gltf.scene)
    // Posed skinned props (cape) animate away from their bind bounds, so three
    // can frustum-cull them incorrectly once attached — same fix the hero uses.
    model.traverse((o) => { o.frustumCulled = false })
    // Tint parity with heroAttach.js attachGearList: tintAll ('replace') wins;
    // else neck/cape recolour whole (multiply-all); else steel-scoped multiply.
    const mode: 'replace' | true | false = spec!.tintAll ? spec!.tintAll : (slot === 'neck' || slot === 'cape') ? true : false
    placeRegistryModel(model, spec!, mode)
    const holder = new THREE.Group()
    holder.name = holderName
    holder.userData.key = key
    holder.add(model)
    bone.add(holder)
  } catch {
    // Bare slot on any load failure — appearance never blocks play.
  }
}


/** Largest-by-vertex-count skinned mesh is the hero's own base body mesh (as
 * opposed to hair/accessory sub-meshes) — same heuristic CombatArena3D and
 * heroAttach.js use to pick the skeleton/bindMatrix an armor piece rebinds
 * onto. */
function primarySkinnedMesh(meshes: THREE.SkinnedMesh[]): THREE.SkinnedMesh | null {
  let best: THREE.SkinnedMesh | null = null
  let bestCount = -1
  for (const m of meshes) {
    const count = m.geometry.attributes.position?.count ?? 0
    if (count > bestCount) { best = m; bestCount = count }
  }
  return best
}

async function applyArmorPiece(
  heroSkinned: THREE.SkinnedMesh,
  slot: ArmorSlot,
  piece: { tint?: string } | undefined,
): Promise<void> {
  const parent = heroSkinned.parent
  if (!parent) return
  const holderName = ARMOR_HOLDER[slot]
  const key = piece ? `${slot}|${piece.tint ?? ''}` : ''
  const existing = parent.getObjectByName(holderName)
  if ((existing?.userData.key ?? '') === key) return
  existing?.removeFromParent()
  if (!piece) return

  try {
    const gltf = await loadTemplate(`/models/armor/${slot}.glb`)
    // Re-check after the await: a newer applyArmorPiece may have won the race.
    const current = parent.getObjectByName(holderName)
    if (current) {
      if (current.userData.key === key) return
      current.removeFromParent()
    }
    const model = gltf.scene.clone(true)
    const pieces: THREE.SkinnedMesh[] = []
    model.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) pieces.push(o as THREE.SkinnedMesh) })
    if (!pieces.length) return
    const holder = new THREE.Group()
    holder.name = holderName
    holder.userData.key = key
    for (const sm of pieces) {
      // Rebind onto the hero's LIVE skeleton using its ORIGINAL bindMatrix
      // (frozen at load) rather than matrixWorld — the outfit build gave this
      // mesh a skin mirroring the hero's own joint order, so no additional
      // position/rotation/scale is needed, only the rebind.
      sm.bind(heroSkinned.skeleton, heroSkinned.bindMatrix)
      tintObject(sm, piece.tint, true)
      holder.add(sm)
    }
    parent.add(holder)
  } catch {
    // Bare slot on any load failure — appearance never blocks play.
  }
}

async function applyArmor(heroMesh: THREE.Object3D, gear: GearDescriptor | undefined): Promise<void> {
  const armor = gear?.armor
  const equip = gear?.equip
  const skinned: THREE.SkinnedMesh[] = []
  heroMesh.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh) })
  const heroSkinned = primarySkinnedMesh(skinned)
  // Rigid pieces (helm/shield/cape/neck) attach to bones directly, so they
  // still render on a capsule fallback that has a rig; skinned body/legs/boots
  // need the hero mesh (they rebind onto its skeleton).
  const rigid = Promise.all(RIGID_SLOTS.map((slot) => applyRigidGearPiece(heroMesh, slot, equip?.[slot])))
  if (!heroSkinned) { await rigid; return }

  let ctl = heroMesh.userData.armorHideMask as HideMaskControl | null | undefined
  if (ctl === undefined) {
    ctl = setupArmorHideMask(skinned)
    heroMesh.userData.armorHideMask = ctl
  }
  await Promise.all([rigid, ...ARMOR_SLOTS.map((slot) => applyArmorPiece(heroSkinned, slot, armor?.[slot]))])
  // Key the head mask off whether a helm mesh actually attached, not just the
  // registry flag — a failed/slow load (bad asset, network hiccup) must never
  // leave the head hidden with nothing rendered in its place.
  const helm = equip?.head ? resolveHeadGearModel(equip.head) : null
  const headAttached = !!heroMesh.getObjectByName(RIGID_HOLDER.head)
  // body/legs/boots hide their region off the descriptor (skinned pieces, like
  // the arena); the feet channel cuts the hero's built-in footwear under boots.
  ctl?.setHidden({ head: !!helm?.hideHead && headAttached, body: !!armor?.body, legs: !!armor?.legs, feet: !!armor?.boots })
}

/** Attaches (or replaces/removes) the weapon + armor matching `gear` on a
 * hero mesh — the open-world equivalent of the combat arena's
 * attachWeapon/attachGearList, so the same equipped loadout renders in both
 * places. */
export async function applyGear(heroMesh: THREE.Object3D, gear: GearDescriptor | undefined): Promise<void> {
  await Promise.all([applyWeaponPiece(heroMesh, gear?.weapon, gear?.equip?.weapon), applyArmor(heroMesh, gear)])
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
    targetId: null,
    segmentAnim: 'walk',
  }
}

/** `run` falls back to `walk` (not straight to idle) so a model built before a
 * run clip existed — e.g. a stale-cached hero.glb — keeps moving instead of
 * appearing to idle-slide across the ground. */
function playAnim(animator: GltfAnimator, name: AnimName): void {
  const action = animator.actions[name] ?? (name === 'run' ? animator.actions.walk : undefined) ?? animator.actions.idle
  if (!action || action === animator.current) return
  action.reset().fadeIn(ANIM_CROSSFADE_S).play()
  animator.current?.fadeOut(ANIM_CROSSFADE_S)
  animator.current = action
}

/** Starts a fresh one-shot swing clip, crossfading out whatever was playing. */
function playSwing(animator: GltfAnimator, action: THREE.AnimationAction): void {
  action.reset().fadeIn(ANIM_CROSSFADE_S).play()
  if (animator.current && animator.current !== action) animator.current.fadeOut(ANIM_CROSSFADE_S)
  animator.current = action
}

/** Drives a procedural creature from the world's anim state: each new server
 * swing fires the two-hand smash once, death plays once, and a return to idle
 * after death respawns the rig. Movement (walk) is positional, not a clip. */
function updateProcAnimator(a: ProcAnimator, name: AnimName, deltaSeconds: number): void {
  const isAttack = isAttackAnim(name)
  const want = name === 'die' ? 'death' : isAttack ? 'attack' : 'idle'
  if (want === 'idle') {
    if (a.triggered === 'death') a.proc.trigger('respawn')
    a.triggered = null
  } else if (a.triggered !== want) {
    a.proc.trigger(want)
    a.triggered = want
  }
  a.proc.update(deltaSeconds)
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
  // Snapshot, not a merge: an absent targetId means combat ended, and that
  // must actually clear facing — patch-merging like hp/name would leave the
  // entity facing a stale, possibly-respawned target forever.
  entity.targetId = diff.targetId ?? null
  entity.queue.push({ x: diff.x, z: diff.z })
  if (shouldSnap(entity.queue.length)) {
    const latest = entity.queue[entity.queue.length - 1]
    entity.queue.length = 0
    const pos = tileToWorld(latest.x, latest.z)
    entity.mesh.position.copy(pos)
    entity.fromPos.copy(pos)
    entity.toPos.copy(pos)
    entity.moving = false
    entity.segmentAnim = 'walk'
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
    const dx = target.x - entity.fromPos.x
    const dz = target.z - entity.fromPos.z
    entity.targetYaw = yawToward(dx, dz)
    // Planar length only — tileToWorld lifts Y by terrain height, and a
    // hillside segment must not misread as a run (or vice versa).
    entity.segmentAnim = animForSegment(dx * dx + dz * dz)
    entity.moving = true
    return
  }
}

/** Advances position playback, facing, and the animation mixer. Call every
 * animation frame. Walk/run/idle is derived from actual traversal so late
 * diffs can't strobe the animation; non-movement anims follow the server
 * state. `targetPos`, when the entity is stationary and has a combat target,
 * turns it to face that target — traversal facing always wins while moving,
 * so a fleeing/kiting combatant still faces its travel direction. */
export function updateEntity(entity: Entity, now: number, deltaSeconds: number, targetPos?: THREE.Vector3 | null): void {
  if (!entity.moving) startNextSegment(entity, now)
  if (entity.moving) {
    const t = Math.min(1, (now - entity.segmentStart) / entity.segmentDuration)
    entity.mesh.position.lerpVectors(entity.fromPos, entity.toPos, t)
    if (t >= 1) {
      entity.moving = false
      startNextSegment(entity, now)
    }
  }

  if (!entity.moving && targetPos && entity.serverAnim !== 'die') {
    const dx = targetPos.x - entity.mesh.position.x
    const dz = targetPos.z - entity.mesh.position.z
    if (dx * dx + dz * dz > 1e-6) entity.targetYaw = yawToward(dx, dz)
  }
  entity.mesh.rotation.y = stepYaw(entity.mesh.rotation.y, entity.targetYaw, TURN_SPEED_RAD_PER_S * deltaSeconds)

  if (entity.animator) {
    const name: AnimName = entity.moving ? entity.segmentAnim : entity.serverAnim === 'walk' ? 'idle' : entity.serverAnim
    if (entity.animator.kind === 'proc') {
      updateProcAnimator(entity.animator, name, deltaSeconds)
    } else {
      // Catch-up segments play faster (segmentDurationMs) than a full 600ms
      // step; scale playback so a running or catching-up stride doesn't slide
      // its feet, and reset to normal speed off any movement segment so
      // attack/die never speed up.
      const anim = entity.animator
      anim.mixer.timeScale = entity.moving ? MOVE_DURATION_MS / entity.segmentDuration : 1
      const attackAction = isAttackAnim(name) ? (anim.actions[name] ?? anim.actions.attack) : undefined
      const playing = anim.current
      const attackPlaying = playing != null && isAttackAction(anim, playing) && playing.isRunning()
      const decision = resolveGltfAnim(name, entity.moving, anim.swingLatched ?? false, attackPlaying)
      anim.swingLatched = decision.latched
      if (decision.fireSwing && attackAction) {
        if ((anim.swingDelayMs ?? 0) > 0) {
          // Defer the clip start by this monster's sub-tick impact delay so the
          // impact frame coincides with the hit splat (same alignment the arena
          // does — src/utils/combatWindup.js).
          anim.pendingSwingAt = now + anim.swingDelayMs!
          anim.pendingSwingAction = attackAction
        } else {
          playSwing(anim, attackAction)
        }
      } else if (decision.playBase) {
        playAnim(anim, name)
      }
      // Release a deferred swing once its lead elapses; a death cancels it so a
      // stale wind-up can't land through the collapse (mirrors CombatArena3D).
      if (anim.pendingSwingAt != null) {
        if (name === 'die') { anim.pendingSwingAt = undefined; anim.pendingSwingAction = null }
        else if (now >= anim.pendingSwingAt) {
          if (anim.pendingSwingAction) playSwing(anim, anim.pendingSwingAction)
          anim.pendingSwingAt = undefined
          anim.pendingSwingAction = null
        }
      }
      anim.mixer.update(deltaSeconds)
      const gait = anim.gait
      if (gait) {
        const bob = gaitBob(now / 1000, entity.moving)
        gait.target.position.y = gait.baseY + bob.y
        gait.target.rotation.z = gait.baseRotZ + bob.rotZ
      }
    }
  }
}
