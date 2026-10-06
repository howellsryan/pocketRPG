import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { tileToWorld } from './scene'
import type { PropPlacement } from '../../shared/protocol'
import { PROP_BASE_SCALE } from '../../shared/propScale.js'
import { modelUrl } from './assetBase'

// Scenery dressing from the zone JSON `props` list: pure visuals — no pick
// data, no collision (that lives in the ASCII grid under them). Each distinct
// model loads once; instances are clones. A failed load just skips the model.

// Kenney nature-kit models are authored ~1 unit tall; base scales size each
// model against the 1-unit tile grid, multiplied by the placement's own scale.
export { PROP_BASE_SCALE } from '../../shared/propScale.js'
export async function createProps(scene: THREE.Scene, props: PropPlacement[]): Promise<void> {
  if (props.length === 0) return
  const urls = [...new Set(props.map((p) => p.model))]
  const templates = new Map<string, GLTF | null>()
  await Promise.all(
    urls.map(async (model) => {
      try {
        templates.set(model, await new GLTFLoader().loadAsync(modelUrl(`/models/props/${model}.glb`)))
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
    obj.scale.setScalar(((PROP_BASE_SCALE as Record<string, number>)[p.model] ?? 1) * (p.scale ?? 1))
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true }
    })
    group.add(obj)
  }
  scene.add(group)
}
