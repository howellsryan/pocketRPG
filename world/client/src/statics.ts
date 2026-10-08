import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { tileToWorld } from './scene'
import type { StaticObject } from '../../shared/protocol'
import type { Pickable } from './picking'
import { resourceAction, resourceNodeFor } from '../../shared/resources'
import { modelUrl } from './assetBase'

// Kenney nature-kit boulder tinted per ore; KayKit dungeon chest (both CC0,
// copied from assets/open-world by hand — see the build guide's asset section).
const ROCK_TINTS: Record<string, number> = { tin: 0x9aa5ad, copper: 0xb87333, clay: 0xa76d47, rune_essence: 0xb3a0cf, iron: 0x986249, coal: 0x343940, gold: 0xc5a65b, mithril: 0x7289ad, adamantite: 0x547c64, runite: 0x73a8ad }
const DEFAULT_ROCK_TINT = 0x8a8a8a
const ROCK_SCALE = 1.5
const ROCK_DEPLETED_SCALE = 0.85
const DEPLETED_DARKEN = 0.45
const CHEST_SCALE = 0.55

const ROCK_INFO: Record<string, { name: string; examine: string }> = {
  tin: { name: 'Tin Rock', examine: 'A rock streaked with dull grey tin ore.' },
  copper: { name: 'Copper Rock', examine: 'A rock veined with ruddy copper ore.' },
  clay: { name: 'Clay Deposit', examine: 'Soft clay exposed beside the outcrop.' },
  rune_essence: { name: 'Rune Essence Deposit', examine: 'Pale stone threaded with dormant rune essence.' },
}
const DEFAULT_ROCK_INFO = { name: 'Rock', examine: 'A rugged, ore-bearing rock.' }

const TREE_INFO: Record<string, { name: string; model: string; scale: number; examine: string; foliage?: number; stretch?: [number,number,number] }> = {
  normal: { name: 'Tree', model: '/models/tree_normal.glb', scale: 1.3, examine: 'A leafy tree, good for beginner axes.' },
  oak: { name: 'Oak', model: '/models/tree_oak.glb', scale: 1.5, examine: 'A broad old oak. Its wood is sturdier than most.' },
}
// Adapt owned tree meshes with species-specific silhouettes and foliage.
const TREE_VARIANTS: Record<string,{name:string;foliage:number;scale:number;stretch:[number,number,number]}> = {
 willow:{name:'Willow',foliage:0x668568,scale:1.6,stretch:[1.2,.88,1.2]},
 maple:{name:'Maple',foliage:0xb58146,scale:1.5,stretch:[1.05,1.05,1.05]},
 teak:{name:'Teak',foliage:0x7a8d46,scale:1.6,stretch:[.95,1.16,.95]},
 mahogany:{name:'Mahogany',foliage:0x41684c,scale:1.7,stretch:[1.1,1.13,1.1]},
 yew:{name:'Yew',foliage:0x355a4a,scale:1.8,stretch:[.9,1.25,.9]},
 magic:{name:'Magic Tree',foliage:0x648caa,scale:1.85,stretch:[1.1,1.18,1.1]},
 redwood:{name:'Redwood',foliage:0x557052,scale:2.1,stretch:[.82,1.5,.82]},
}
for(const [id,variant] of Object.entries(TREE_VARIANTS))TREE_INFO[id]={...variant,model:'/models/tree_oak.glb',examine:'A '+variant.name.toLowerCase()+' ready for woodcutting.'}
const DEFAULT_TREE_INFO = { name: 'Tree', model: '/models/tree_normal.glb', scale: 1.3, examine: 'A tree of the deep wood.' }
const TREE_STUMP_SCALE = 2.2

/** Processing stations (Phase 7). No anvil asset exists in the library yet —
 * it renders from primitives until a bespoke model lands (see the guide §14). */
const STATION_INFO: Record<string, { name: string; label: string; action: string; model: string | null; scale: number; examine: string; fallback: () => THREE.Object3D }> = {
  // The furnace chimney model is ~3 units tall and the range's brick ring is a
  // flat ~0.5-unit disc — scales bring both to tile proportions; the range gets
  // an emissive flame added over whatever renders (model or fallback).
  furnace: {
    name: 'Furnace', label: 'Smelt', action: 'smelt', model: '/models/furnace.glb', scale: 0.55,
    examine: 'A stout brick furnace, hot enough to melt ore into bars.',
    fallback: furnaceFallback,
  },
  anvil: {
    name: 'Anvil', label: 'Smith', action: 'smith', model: null, scale: 1,
    examine: 'A battered iron anvil. Bars go on, gear comes off.',
    fallback: anvilFallback,
  },
  range: {
    name: 'Cooking Range', label: 'Cook', action: 'cook', model: '/models/range.glb', scale: 1.8,
    examine: 'A brick cooking fire. Mind you don’t burn anything.',
    fallback: rangeFallback,
  },
}

export type Statics = {
  pickables: THREE.Object3D[]
  setRockDepleted: (id: string, depleted: boolean) => void
}

type RockEntry = { obj: THREE.Object3D; materials: THREE.MeshStandardMaterial[] }
/** Depleted trees swap the healthy canopy for the stump (no tint games). */
type TreeEntry = { tree: THREE.Object3D; stump: THREE.Object3D }

async function tryLoad(url: string): Promise<GLTF | null> {
  try {
    return await new GLTFLoader().loadAsync(modelUrl(url))
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

function anvilFallback(): THREE.Object3D {
  const metal = new THREE.MeshStandardMaterial({ color: 0x3d434a, roughness: 0.55, metalness: 0.6 })
  const group = new THREE.Group()
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.34), metal)
  base.position.y = 0.09
  const waist = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.2), metal)
  waist.position.y = 0.3
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.26), metal)
  top.position.y = 0.49
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 12), metal)
  horn.rotation.z = -Math.PI / 2
  horn.position.set(0.45, 0.49, 0)
  group.add(base, waist, top, horn)
  return group
}

function furnaceFallback(): THREE.Object3D {
  const group = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.55, 1.2, 10),
    new THREE.MeshStandardMaterial({ color: 0x8a7f74, roughness: 0.95 })
  )
  body.position.y = 0.6
  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.26, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xff7722, emissive: 0xcc4400, emissiveIntensity: 1.4 })
  )
  mouth.position.set(0, 0.35, 0.5)
  group.add(body, mouth)
  return group
}

function rangeFlame(y: number): THREE.Object3D {
  const fire = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.34, 8),
    new THREE.MeshStandardMaterial({ color: 0xffaa33, emissive: 0xdd6600, emissiveIntensity: 1.6 })
  )
  fire.position.y = y
  return fire
}

function rangeFallback(): THREE.Object3D {
  const group = new THREE.Group()
  const bricks = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), new THREE.MeshStandardMaterial({ color: 0x9a5b45, roughness: 0.95 }))
  bricks.position.y = 0.08
  group.add(bricks)
  return group
}

function treeFallback(): THREE.Object3D {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.8), new THREE.MeshStandardMaterial({ color: 0x6b4a2b }))
  trunk.position.y = 0.4
  const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: 0x2f6b2f }))
  canopy.position.y = 1.1
  const group = new THREE.Group()
  group.add(trunk, canopy)
  return group
}

/** Shoreline tackle: the bobber reaches toward water to the east of its
 * walkable interaction tile. This is a fishing site, not a bank chest. */
function fishingSite(): THREE.Object3D {
  const group = new THREE.Group()
  const wood = new THREE.MeshStandardMaterial({ color: 0x785337, roughness: 1 })
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 1.5, 6), wood)
  pole.position.set(0.28, 0.7, 0); pole.rotation.z = -0.45
  const line = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.62,1.35,0), new THREE.Vector3(1.3,0.8,0), new THREE.Vector3(1.45,0.1,0),
  ]), 12, 0.012, 4, false), new THREE.MeshStandardMaterial({ color: 0xc7b894 }))
  const bobber = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 6), new THREE.MeshStandardMaterial({ color: 0xb66348 }))
  bobber.position.set(1.45,0.12,0)
  const ripple = new THREE.Mesh(new THREE.TorusGeometry(0.23,0.016,4,18), new THREE.MeshStandardMaterial({color:0xb5d4d0}))
  ripple.rotation.x = Math.PI/2; ripple.position.set(1.45,0.07,0)
  group.add(pole,line,bobber,ripple)
  return group
}
function gatheringSite(task: string): THREE.Object3D {
  if(task==='gather_bowstring')return fieldworkCache()
  const group=new THREE.Group()
  const add=(geometry:THREE.BufferGeometry,color:number,x:number,y:number,z:number)=>{
    const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:1}))
    mesh.position.set(x,y,z);group.add(mesh);return mesh
  }
  if(['pick_white_berries','pick_limpwurt_root','gather_snape_grass','harvest_potato_cactus'].includes(task)){
    const cactus=task==='harvest_potato_cactus'
    add(cactus?new THREE.CylinderGeometry(.16,.19,.9,6):new THREE.IcosahedronGeometry(.35,0),0x547348,0,cactus?.45:.3,0)
    if(task==='pick_white_berries')for(const [x,z] of [[-.18,.17],[.15,.2],[.04,-.17]])add(new THREE.SphereGeometry(.07,6,4),0xe9e0cc,x,.52,z)
    if(cactus){const arm=add(new THREE.CylinderGeometry(.1,.1,.45,6),0x6f8751,.22,.55,0);arm.rotation.z=.7}
  }else if(['collect_seaweed','collect_spiders_eggs'].includes(task)){
    add(new THREE.CylinderGeometry(.3,.38,.09,8),0x625c45,0,.05,0)
    for(const x of [-.17,0,.17])add(new THREE.IcosahedronGeometry(.16,0),task==='collect_seaweed'?0x456750:0xd6c9b2,x,.14,0).scale.set(.6,task==='collect_seaweed'?.5:1,1.5)
  }else if(task==='collect_sand'){
    add(new THREE.CylinderGeometry(.26,.19,.4,8),0x766d58,0,.2,0)
    add(new THREE.CylinderGeometry(.22,.22,.05,8),0xd8c294,0,.4,0)
  }else if(task==='collect_wine_of_zamorak'){
    add(new THREE.BoxGeometry(.5,.35,.4),0x73523c,0,.18,0)
    add(new THREE.CylinderGeometry(.08,.1,.3,6),0x683e62,0,.5,0)
  }else if(task==='catch_newts'){
    add(new THREE.CylinderGeometry(.3,.24,.25,8),0x896d45,0,.13,0)
    add(new THREE.IcosahedronGeometry(.11,0),0x7f9b52,0,.27,0).scale.set(1,.5,2)
  }else return fieldworkCache()
  return group
}
function fieldworkCache(): THREE.Object3D {
  const group = new THREE.Group()
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.65,0.38,0.5), new THREE.MeshStandardMaterial({color:0x876442,roughness:1}))
  box.position.y = 0.19
  const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.14,0.25,12), new THREE.MeshStandardMaterial({color:0xd4c29c,roughness:1}))
  spool.rotation.z = Math.PI/2; spool.position.set(0,0.49,0)
  const cord = new THREE.Mesh(new THREE.TorusGeometry(0.18,0.035,5,14), new THREE.MeshStandardMaterial({color:0xb39b75}))
  cord.rotation.x = Math.PI/2; cord.position.set(0.14,0.42,0.05)
  group.add(box,spool,cord)
  return group
}

export async function createStatics(scene: THREE.Scene, statics: StaticObject[]): Promise<Statics> {
  const treeModels = [...new Set(statics.filter((s) => s.type === 'tree').map((s) => (TREE_INFO[s.tree ?? ''] ?? DEFAULT_TREE_INFO).model))]
  const needStump = treeModels.length > 0
  const stationModels = [
    ...new Set(
      statics
        .map((s) => STATION_INFO[s.type]?.model)
        .filter((m): m is string => Boolean(m))
    ),
  ]
  const [rockGltf, chestGltf, stumpGltf, ...restGltfs] = await Promise.all([
    tryLoad('/models/rock.glb'),
    tryLoad('/models/chest.glb'),
    needStump ? tryLoad('/models/stump.glb') : Promise.resolve(null),
    ...treeModels.map((url) => tryLoad(url)),
    ...stationModels.map((url) => tryLoad(url)),
  ])
  const treeGltfs = restGltfs.slice(0, treeModels.length)
  const stationGltfs = restGltfs.slice(treeModels.length)
  const treeTemplates = new Map(treeModels.map((url, i) => [url, treeGltfs[i]]))
  const stationTemplates = new Map(stationModels.map((url, i) => [url, stationGltfs[i]]))
  const pickables: THREE.Object3D[] = []
  const rocks = new Map<string, RockEntry>()
  const trees = new Map<string, TreeEntry>()

  for (const s of statics) {
    const wrapper = new THREE.Group()
    let materials: THREE.MeshStandardMaterial[] = []

    if (s.type === 'tree') {
      const info = TREE_INFO[s.tree ?? ''] ?? DEFAULT_TREE_INFO
      const gltf = treeTemplates.get(info.model)
      const tree = new THREE.Group()
      tree.add(gltf ? gltf.scene.clone(true) : treeFallback())
      tree.scale.setScalar(info.scale)
      if ('stretch' in info && info.stretch) tree.scale.multiply(new THREE.Vector3(...info.stretch))
      if ('foliage' in info && info.foliage) tree.traverse(child=>{
        if(!(child instanceof THREE.Mesh))return
        const material=child.material as THREE.MeshStandardMaterial
        if(material.color.g>material.color.r&&material.color.g>material.color.b){
          child.material=material.clone()
          ;(child.material as THREE.MeshStandardMaterial).color.set(info.foliage!)
        }
      })
      const stump = new THREE.Group()
      if (stumpGltf) stump.add(stumpGltf.scene.clone(true))
      stump.scale.setScalar(TREE_STUMP_SCALE)
      stump.visible = false
      wrapper.add(tree, stump)
      trees.set(s.id, { tree, stump })
      wrapper.userData.pick = {
        kind: 'rock', id: s.id, name: info.name,
        actions: [{ label: 'Chop', action: 'chop' }], examine: info.examine,
      } satisfies Pickable
    } else if (s.type === 'rock') {
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
      const node = resourceNodeFor(s)
      const action = node && resourceAction(node)
      const info = ROCK_INFO[s.rock ?? ''] ?? (action ? {name: action.name, examine: `A deposit for ${action.name.toLowerCase()}.`} : DEFAULT_ROCK_INFO)
      wrapper.userData.pick = {
        kind: 'rock', id: s.id, name: info.name,
        actions: [{ label: 'Mine', action: 'mine' }], examine: info.examine,
      } satisfies Pickable
    } else if (s.type === 'fishing_spot' || s.type === 'gather_site') {
      const node = resourceNodeFor(s)
      const action = node && resourceAction(node)
      wrapper.add(s.type === 'fishing_spot' ? fishingSite() : gatheringSite(s.gather ?? ''))
      wrapper.userData.pick = {
        kind: 'rock', id: s.id,
        name: action?.name ?? (s.type === 'fishing_spot' ? 'Fishing Spot' : 'Gathering Site'),
        actions: [{ label: s.type === 'fishing_spot' ? 'Fish' : 'Gather', action: s.type === 'fishing_spot' ? 'fish' : 'gather' }],
        examine: action?.description ?? 'A shoreline spot where shrimps gather.',
      } satisfies Pickable
    } else if (STATION_INFO[s.type]) {
      const info = STATION_INFO[s.type]
      const gltf = info.model ? stationTemplates.get(info.model) : null
      wrapper.add(gltf ? gltf.scene.clone(true) : info.fallback())
      if (s.type === 'range') wrapper.add(rangeFlame(0.22))
      wrapper.scale.setScalar(info.scale)
      wrapper.userData.pick = {
        kind: 'object', id: s.id, name: info.name,
        actions: [{ label: info.label, action: info.action }],
        examine: info.examine,
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
    const treeEntry = trees.get(id)
    if (treeEntry) {
      treeEntry.tree.visible = !depleted
      treeEntry.stump.visible = depleted
      return
    }
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
