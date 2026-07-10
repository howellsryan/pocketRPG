import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { tileToWorld } from './scene'
import type { StaticObject } from '../../shared/protocol'
import type { Pickable } from './picking'

// Kenney nature-kit boulder tinted per ore; KayKit dungeon chest (both CC0,
// copied from assets/open-world by hand — see the build guide's asset section).
const ROCK_TINTS: Record<string, number> = { tin: 0x9aa5ad, copper: 0xb87333 }
const DEFAULT_ROCK_TINT = 0x8a8a8a
const ROCK_SCALE = 1.5
const ROCK_DEPLETED_SCALE = 0.85
const DEPLETED_DARKEN = 0.45
const CHEST_SCALE = 0.55

const ROCK_INFO: Record<string, { name: string; examine: string }> = {
  tin: { name: 'Tin Rock', examine: 'A rock streaked with dull grey tin ore.' },
  copper: { name: 'Copper Rock', examine: 'A rock veined with ruddy copper ore.' },
}
const DEFAULT_ROCK_INFO = { name: 'Rock', examine: 'A rugged, ore-bearing rock.' }

export type Statics = {
  pickables: THREE.Object3D[]
  setRockDepleted: (id: string, depleted: boolean) => void
}

type RockEntry = { obj: THREE.Object3D; materials: THREE.MeshStandardMaterial[] }

async function tryLoad(url: string): Promise<GLTF | null> {
  try {
    return await new GLTFLoader().loadAsync(url)
  } catch {
    return null
  }
}

function rockFallback(): THREE.Object3D {
  return new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), new THREE.MeshStandardMaterial({ color: 0x8a8a8a }))
}

function chestFallback(): THREE.Object3D {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0x6b4a2b }))
  mesh.position.y = 0.3
  return mesh
}

/** Clones a template and gives every mesh its own material so per-instance
 * tinting/darkening can't bleed across rocks. Returns the collected materials. */
function cloneTinted(template: THREE.Object3D, tint: number | null): { obj: THREE.Object3D; materials: THREE.MeshStandardMaterial[] } {
  const obj = template.clone(true)
  const materials: THREE.MeshStandardMaterial[] = []
  obj.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const source = child.material as THREE.MeshStandardMaterial
    const material = source.clone()
    if (tint !== null) material.color.set(tint)
    material.userData.baseColor = material.color.clone()
    child.material = material
    materials.push(material)
  })
  return { obj, materials }
}

export async function createStatics(scene: THREE.Scene, statics: StaticObject[]): Promise<Statics> {
  const [rockGltf, chestGltf] = await Promise.all([tryLoad('/models/rock.glb'), tryLoad('/models/chest.glb')])
  const pickables: THREE.Object3D[] = []
  const rocks = new Map<string, RockEntry>()

  for (const s of statics) {
    const wrapper = new THREE.Group()
    let materials: THREE.MeshStandardMaterial[] = []

    if (s.type === 'rock') {
      const tint = ROCK_TINTS[s.rock ?? ''] ?? DEFAULT_ROCK_TINT
      if (rockGltf) {
        const cloned = cloneTinted(rockGltf.scene, tint)
        wrapper.add(cloned.obj)
        materials = cloned.materials
      } else {
        const fallback = rockFallback()
        ;(fallback as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.color.multiply(new THREE.Color(tint))
        wrapper.add(fallback)
        materials = [(fallback as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material]
        for (const m of materials) m.userData.baseColor = m.color.clone()
      }
      wrapper.scale.setScalar(ROCK_SCALE)
      rocks.set(s.id, { obj: wrapper, materials })
      const info = ROCK_INFO[s.rock ?? ''] ?? DEFAULT_ROCK_INFO
      wrapper.userData.pick = {
        kind: 'rock', id: s.id, name: info.name,
        actions: [{ label: 'Mine', action: 'mine' }], examine: info.examine,
      } satisfies Pickable
    } else {
      wrapper.add(chestGltf ? chestGltf.scene.clone(true) : chestFallback())
      wrapper.scale.setScalar(CHEST_SCALE)
      wrapper.userData.pick = {
        kind: 'object', id: s.id, name: 'Bank Chest',
        actions: [{ label: 'Use', action: 'bank' }],
        examine: 'A sturdy chest. Your bank, wherever you roam.',
      } satisfies Pickable
    }

    wrapper.position.copy(tileToWorld(s.x, s.z))
    scene.add(wrapper)
    pickables.push(wrapper)
  }

  function setRockDepleted(id: string, depleted: boolean): void {
    const entry = rocks.get(id)
    if (!entry) return
    entry.obj.scale.setScalar(depleted ? ROCK_DEPLETED_SCALE : ROCK_SCALE)
    for (const m of entry.materials) {
      const base = m.userData.baseColor as THREE.Color
      m.color.copy(base)
      if (depleted) m.color.multiplyScalar(DEPLETED_DARKEN)
    }
  }

  return { pickables, setRockDepleted }
}

/** Walks up from a raycast hit to the wrapper that carries pick metadata. */
export function pickTargetOf(object: THREE.Object3D): Pickable | null {
  let current: THREE.Object3D | null = object
  while (current) {
    const pick = current.userData?.pick as Pickable | undefined
    if (pick) return pick
    current = current.parent
  }
  return null
}
