import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { tileToWorld } from './scene'
import type { PropPlacement } from '../../shared/protocol'
import { PROP_BASE_SCALE } from '../../shared/propScale.js'
import { modelUrl } from './assetBase'
import { collectMeshParts } from './scatter'

// Scenery dressing from the zone JSON `props` list: pure visuals — no pick
// data, no collision (that lives in the ASCII grid under them). Each distinct
// model loads once; complete mesh parts are instanced in spatial batches. A failed load just skips the model.

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
  for(const [model,template] of templates){
    if(!template)continue
    const parts=collectMeshParts(template.scene)
    if(model==='wheat')for(const part of parts){
      const tint=(material:THREE.Material)=>{const clone=material.clone() as THREE.MeshStandardMaterial;clone.color?.set(0xd6b35e);return clone}
      part.material=Array.isArray(part.material)?part.material.map(tint):tint(part.material)
    }
    const batches=new Map<string,THREE.Matrix4[]>()
    for(const p of props.filter((p)=>p.model===model)){
      const key=Math.floor(p.x/32)+','+Math.floor(p.z/32),batch=batches.get(key)??[]
      const scale=((PROP_BASE_SCALE as Record<string,number>)[model]??1)*(p.scale??1)
      batch.push(new THREE.Matrix4().compose(tileToWorld(p.x,p.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),p.rot??0),
        new THREE.Vector3(scale,scale,scale)))
      batches.set(key,batch)
    }
    for(const batch of batches.values())for(const part of parts){
      const mesh=new THREE.InstancedMesh(part.geometry,part.material,batch.length)
      batch.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix))
      mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere()
      mesh.castShadow=true;mesh.receiveShadow=true
      group.add(mesh)
    }
  }
  scene.add(group)
}
