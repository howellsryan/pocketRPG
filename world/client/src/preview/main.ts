import * as THREE from 'three'
import type { ZoneDef } from '../../../shared/zone'
import { createScene, createLights, createRenderer, createCamera, tileToWorld, updateCamera, updateShadowLight, clampZoom } from '../scene'
import { createTerrain } from '../terrain'
import { createScatterLayers } from '../scatter'
import { createStatics } from '../statics'
import { createProps } from '../props'
import { createAmbient } from '../ambient'
import { createEntity, createHeroMesh, createMonsterMesh, updateEntity, type Entity } from '../entities'
import lumbrightZone from '../../../zones/lumbright.json'
import overworldZone from '../../../zones/overworld.json'
import grondarLairZone from '../../../zones/grondar_lair.json'
import cowPastureZone from '../../../zones/cow_pasture.json'
import fiendPitZone from '../../../zones/fiend_pit.json'
import dragonRoostZone from '../../../zones/dragon_roost.json'
import zarythThroneZone from '../../../zones/zaryth_throne.json'
import wildernessZone from '../../../zones/wilderness.json'

// Auth-free scene review using the gameplay terrain, meshes, lights, shadows
// and close camera. No network simulation or authoritative NPC movement.
// Review tools reject asset failures; readiness means all scene loads finished.
const ZONES: Record<string, ZoneDef> = {
  lumbright: lumbrightZone as unknown as ZoneDef,
  overworld: overworldZone as unknown as ZoneDef,
  grondar_lair: grondarLairZone as unknown as ZoneDef,
  cow_pasture: cowPastureZone as unknown as ZoneDef,
  fiend_pit: fiendPitZone as unknown as ZoneDef,
  dragon_roost: dragonRoostZone as unknown as ZoneDef,
  zaryth_throne: zarythThroneZone as unknown as ZoneDef,
  wilderness: wildernessZone as unknown as ZoneDef,
}
declare global {
  interface Window {
    __previewReady?: boolean
    __previewError?: string
    __previewStats?: { calls: number; triangles: number; geometries: number; textures: number }
  }
}
const params = new URLSearchParams(location.search)
const zoneId = params.get('zone') ?? 'overworld'
if (!ZONES[zoneId]) throw new Error('Unknown preview zone: ' + zoneId)
const def = ZONES[zoneId]
const gameplay = params.get('mode') === 'gameplay'
const number = (name: string, fallback: number): number => {
  const value = params.has(name) ? Number(params.get(name)) : fallback
  if (!Number.isFinite(value)) throw new Error('Invalid preview parameter: ' + name)
  return value
}
const pair = (raw: string | null, fallback: { x: number; z: number }): { x: number; z: number } => {
  if (!raw) return fallback
  const values = raw.split(',').map(Number)
  if (values.length !== 2 || !values.every(Number.isFinite) || values[0]<0 || values[1]<0 || values[0]>=def.width || values[1]>=def.height) throw new Error('Invalid preview target')
  return { x: values[0], z: values[1] }
}
const targetTile = pair(params.get('target'), gameplay ? def.spawn : { x: def.width/2, z: def.height/2 })
const sel = document.getElementById('zoneSel') as unknown as HTMLSelectElement
for (const [id, zone] of Object.entries(ZONES)) {
  const option = document.createElement('option')
  option.value=id; option.textContent=zone.name; option.selected=id===zoneId; sel.appendChild(option)
}
sel.addEventListener('change',()=>{params.set('zone',sel.value); params.delete('target'); params.delete('follow'); location.search=params.toString()})
document.getElementById('meta')!.textContent = gameplay ? 'Gameplay camera · scene review' : 'Overview · scene review'
const host=document.getElementById('host')!
const scene=createScene(def.ambience)
if (!gameplay && scene.fog instanceof THREE.Fog) scene.fog.far=Math.max(scene.fog.far,Math.max(def.width,def.height)*3)
const {sun}=createLights(scene,def.ambience)
THREE.DefaultLoadingManager.onError=(url)=>{window.__previewError='Failed asset: '+url}
const follow=params.has('follow') ? pair(params.get('follow'),targetTile) : gameplay ? targetTile : undefined
const {heightField}=createTerrain(scene,def.collision,def.width,def.height,def.palette,def.terrain,def.ground,
  {chunkCentre:follow ? {...follow,radius:number('radius',4)} : undefined})
const entities: Entity[]=[]
const ready=[
  createProps(scene,def.props??[]),
  createStatics(scene,def.objects),
  Promise.all(def.npcs.map(async(npc)=>{
    const {mesh,animator}=await createMonsterMesh(npc.monsterId)
    const entity=createEntity(npc.id,npc.x,npc.z,mesh,animator)
    entities.push(entity); scene.add(mesh)
  })),
  createHeroMesh().then(({mesh,animator})=>{
    entities.push(createEntity('__preview_hero',targetTile.x,targetTile.z,mesh,animator)); scene.add(mesh)
  }),
  createScatterLayers(scene,def.terrain?.scatter??[],def.width,def.height,def.collision,
    new Set([...def.objects,...(def.exits??[]),...(def.props??[])].map((p)=>p.x+','+p.z)),
    def.terrain?.procedural?.seed??1,heightField.heightAt),
]
const ambient=createAmbient(scene,def.ambient,heightField.heightAt,def.collision,def.id)
ready.push(ambient.ready)
const renderer=createRenderer(host)
const camera=gameplay ? createCamera() : new THREE.PerspectiveCamera(45,window.innerWidth/window.innerHeight,.1,1200)
const target=tileToWorld(targetTile.x,targetTile.z)
const radius=Math.max(def.width,def.height)
const orbit={yaw:number('yaw',gameplay?0:Math.PI/4),pitch:number('pitch',.7),
  dist:number('distance',number('dist',1.05)*radius),zoom:clampZoom(number('zoom',1.3))}
function applyCamera(): void {
  if(gameplay) updateCamera(camera,target,orbit.zoom,orbit.yaw)
  else {
    camera.position.set(target.x+orbit.dist*Math.cos(orbit.pitch)*Math.sin(orbit.yaw),
      target.y+orbit.dist*Math.sin(orbit.pitch),target.z+orbit.dist*Math.cos(orbit.pitch)*Math.cos(orbit.yaw))
    camera.lookAt(target)
  }
  updateShadowLight(sun,target)
}
applyCamera()
let dragging=false, last={x:0,y:0}
renderer.domElement.addEventListener('pointerdown',(e)=>{dragging=true;last={x:e.clientX,y:e.clientY}})
window.addEventListener('pointerup',()=>{dragging=false})
window.addEventListener('pointermove',(e)=>{
  if(!dragging)return
  orbit.yaw-=(e.clientX-last.x)*.008
  orbit.pitch=Math.max(.15,Math.min(1.4,orbit.pitch-(e.clientY-last.y)*.006))
  last={x:e.clientX,y:e.clientY};applyCamera()
})
renderer.domElement.addEventListener('wheel',(e)=>{
  e.preventDefault()
  if(gameplay)orbit.zoom=clampZoom(orbit.zoom*(e.deltaY<0?.9:1.1))
  else orbit.dist=Math.max(8,Math.min(radius*2.5,orbit.dist*(e.deltaY<0?.9:1.1)))
  applyCamera()
},{passive:false})
window.addEventListener('resize',()=>{
  camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth,window.innerHeight)
})
const clock=new THREE.Clock()
function frame(): void {
  const dt=clock.getDelta(),now=performance.now()
  ambient.update(dt)
  for(const entity of entities)updateEntity(entity,now,dt)
  renderer.render(scene,camera)
  window.__previewStats={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
    geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures}
  requestAnimationFrame(frame)
}
frame()
void Promise.all(ready).then(()=>{
  if(window.__previewError)throw new Error(window.__previewError)
  renderer.render(scene,camera)
  window.__previewReady=true
}).catch((error: unknown)=>{
  window.__previewError=String(error)
  console.error('[Preview] setup failed',error)
})
