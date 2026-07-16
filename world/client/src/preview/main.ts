import * as THREE from 'three'
import type { ZoneDef } from '../../../shared/zone'
import { createScene, createLights } from '../scene'
import { createTerrain } from '../terrain'
import { createScatterLayers } from '../scatter'
import { createStatics } from '../statics'
import { createProps } from '../props'
import pastureZone from '../../../zones/pasture.json'
import forestZone from '../../../zones/forest.json'
import lumbrightZone from '../../../zones/lumbright.json'
import varrickZone from '../../../zones/varrick.json'
import varrickDungeonZone from '../../../zones/varrick_dungeon.json'

// Auth-free, server-free terrain preview. Renders a bundled zone JSON through
// the REAL terrain pipeline (createTerrain + scatter + statics/props), so it
// shows exactly what the game draws — bypassing the D1 zone-def override that
// can mask edits in a live dev session. Also the target for scripts/shoot-zone.mjs
// (headless screenshots). No gameplay, no networking.

const ZONES: Record<string, ZoneDef> = {
  pasture: pastureZone as ZoneDef,
  forest: forestZone as ZoneDef,
  lumbright: lumbrightZone as ZoneDef,
  varrick: varrickZone as unknown as ZoneDef,
  varrick_dungeon: varrickDungeonZone as unknown as ZoneDef,
}

declare global {
  interface Window {
    __previewReady?: boolean
  }
}

const params = new URLSearchParams(location.search)
const zoneId = params.get('zone') && ZONES[params.get('zone')!] ? params.get('zone')! : 'pasture'
const yawParam = params.get('yaw')
const def = ZONES[zoneId]

// Zone dropdown → reload with the chosen zone.
const sel = document.getElementById('zoneSel') as unknown as HTMLSelectElement
for (const id of Object.keys(ZONES)) {
  const opt = document.createElement('option')
  opt.value = id
  opt.textContent = ZONES[id].name
  if (id === zoneId) opt.selected = true
  sel.appendChild(opt)
}
sel.addEventListener('change', () => {
  params.set('zone', sel.value)
  location.search = params.toString()
})
document.getElementById('meta')!.textContent = def.terrain
  ? `relief ${def.terrain.relief} · ${def.terrain.material ?? 'checker'} · ${(def.terrain.scatter ?? []).length} scatter layers`
  : 'no terrain block (flat)'

const host = document.getElementById('host')!
const width = host.clientWidth || window.innerWidth
const height = host.clientHeight || window.innerHeight

const scene = createScene(def.ambience)
createLights(scene, def.ambience)
const { heightField } = createTerrain(scene, def.collision, def.width, def.height, def.palette, def.terrain)
void createProps(scene, def.props ?? [])
void createStatics(scene, def.objects)

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(width, height)
host.appendChild(renderer.domElement)

const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 500)
const center = new THREE.Vector3(def.width / 2, 0, def.height / 2)
const radius = Math.max(def.width, def.height)
// Lower pitch than gameplay so relief reads against the horizon.
const orbit = { yaw: yawParam != null ? Number(yawParam) : Math.PI / 4, pitch: 0.5, dist: radius * 1.05 }

function applyCamera(): void {
  camera.position.set(
    center.x + orbit.dist * Math.cos(orbit.pitch) * Math.sin(orbit.yaw),
    orbit.dist * Math.sin(orbit.pitch),
    center.z + orbit.dist * Math.cos(orbit.pitch) * Math.cos(orbit.yaw),
  )
  camera.lookAt(center)
}
applyCamera()

let dragging = false
let last = { x: 0, y: 0 }
renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; last = { x: e.clientX, y: e.clientY } })
window.addEventListener('pointerup', () => (dragging = false))
window.addEventListener('pointermove', (e) => {
  if (!dragging) return
  orbit.yaw -= (e.clientX - last.x) * 0.008
  orbit.pitch = Math.max(0.15, Math.min(1.4, orbit.pitch - (e.clientY - last.y) * 0.006))
  last = { x: e.clientX, y: e.clientY }
  applyCamera()
})
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault()
  orbit.dist = Math.max(radius * 0.3, Math.min(radius * 2.5, orbit.dist * (e.deltaY < 0 ? 0.9 : 1.1)))
  applyCamera()
}, { passive: false })

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

function loop(): void {
  renderer.render(scene, camera)
  requestAnimationFrame(loop)
}
loop()

// Signal the screenshot script once terrain + scatter models have settled.
void createScatterLayers(
  scene,
  def.terrain?.scatter ?? [],
  def.width,
  def.height,
  def.collision,
  new Set([...def.objects.map((o) => `${o.x},${o.z}`), ...(def.exits ?? []).map((e) => `${e.x},${e.z}`)]),
  (def.terrain?.procedural?.seed ?? 1) | 0,
  heightField.heightAt,
).finally(() => {
  setTimeout(() => { window.__previewReady = true }, 400)
})
