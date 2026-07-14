import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { tileToWorld } from './scene'
import type { PropPlacement } from '../../shared/protocol'

// Scenery dressing from the zone JSON `props` list: pure visuals — no pick
// data, no collision (that lives in the ASCII grid under them). Each distinct
// model loads once; instances are clones. A failed load just skips the model.

// Kenney nature-kit models are authored ~1 unit tall; base scales size each
// model against the 1-unit tile grid, multiplied by the placement's own scale.
const BASE_SCALE: Record<string, number> = {
  pine_a: 1.7,
  pine_b: 1.6,
  bush: 1.4,
  mushrooms: 1.1,
  flowers: 1.1,
  boulder: 1.3,
  // Varrick capital landmarks (native model bounds → tile-grid units).
  castle: 3.0,
  fountain: 1.5,
  stall: 1.8,
  banner: 2.0,
  altar: 1.6,
  crypt: 2.2,
  column: 2.0,
  dungeon_stairs: 0.9,
  dungeon_door: 0.8,
}
export async function createProps(scene: THREE.Scene, props: PropPlacement[]): Promise<void> {
  if (props.length === 0) return
  const urls = [...new Set(props.map((p) => p.model))]
  const templates = new Map<string, GLTF | null>()
  await Promise.all(
    urls.map(async (model) => {
      try {
        templates.set(model, await new GLTFLoader().loadAsync(`/models/props/${model}.glb`))
      } catch {
        templates.set(model, null)
      }
    })
  )
  const group = new THREE.Group()
  for (const p of props) {
    const template = templates.get(p.model)
    if (!template) continue
    const obj = template.scene.clone(true)
    obj.position.copy(tileToWorld(p.x, p.z))
    if (p.rot) obj.rotation.y = p.rot
    obj.scale.setScalar((BASE_SCALE[p.model] ?? 1) * (p.scale ?? 1))
    group.add(obj)
  }
  scene.add(group)
}
