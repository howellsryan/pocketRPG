import * as THREE from 'three'
import type { ZoneDef } from '../../../shared/zone'
import { createScene, createLights, tileToWorld } from '../scene'
import { createTerrain } from '../terrain'
import { createScatterLayers } from '../scatter'
import { createStatics } from '../statics'
import { createProps } from '../props'
import { createAmbient } from '../ambient'
import { createMonsterMesh } from '../entities'

// Read-only 3D preview of a zone using the REAL game renderer — the displaced
// terrain (or flat checker when the zone has no `terrain` block) + palette,
// ambience sky/lighting, actual rock/tree/chest/prop models, decorative scatter
// and monster meshes players see. Lazy-loaded (three.js stays out of the main
// editor bundle) and torn down cleanly on close. Simple orbit + zoom camera.

type Preview = { dispose: () => void }
let current: Preview | null = null

export async function openPreview3D(def: ZoneDef): Promise<void> {
  closePreview3D()
  const host = document.getElementById('preview3dHost')!
  const title = document.getElementById('preview3dTitle')!
  title.textContent = `3D preview — ${def.name}`
  const modal = document.getElementById('preview3dModal')!
  modal.style.display = 'flex'

  const width = host.clientWidth || 800
  const height = host.clientHeight || 560

  const scene = createScene(def.ambience)
  createLights(scene, def.ambience)
  const { heightField } = createTerrain(scene, def.collision, def.width, def.height, def.palette, def.terrain, def.ground)
  void createProps(scene, def.props ?? [])
  void createStatics(scene, def.objects)
  const ambient = createAmbient(scene, def.ambient, heightField.heightAt)
  if (def.terrain?.scatter?.length) {
    const occupied = new Set<string>([
      ...def.objects.map((o) => `${o.x},${o.z}`),
      ...(def.exits ?? []).map((e) => `${e.x},${e.z}`),
    ])
    void createScatterLayers(scene, def.terrain.scatter, def.width, def.height, def.collision, occupied, (def.terrain.procedural?.seed ?? 1) | 0, heightField.heightAt)
  }

  // Monster meshes at their spawn tiles (async; ignore failures).
  for (const npc of def.npcs) {
    void createMonsterMesh(npc.monsterId).then(({ mesh }) => {
      mesh.position.copy(tileToWorld(npc.x, npc.z))
      scene.add(mesh)
    }).catch(() => {})
  }

  // preserveDrawingBuffer lets Review read the canvas back with toDataURL after
  // a render (the rAF loop clears between frames otherwise).
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(width, height)
  host.appendChild(renderer.domElement)

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 500)
  const center = new THREE.Vector3(def.width / 2, 0, def.height / 2)
  const radius = Math.max(def.width, def.height)
  const orbit = { yaw: Math.PI / 4, pitch: 0.9, dist: radius * 1.1 }

  let mode: 'orbit' | 'walk' = 'orbit'
  // Ground-level free camera: eye position + look yaw/pitch, WASD to move.
  const walk = { pos: tileToWorld(def.spawn.x, def.spawn.z), yaw: Math.PI / 4, pitch: -0.1 }
  walk.pos.y = heightField.heightAt(walk.pos.x, walk.pos.z) + 1.6
  const keys = new Set<string>()

  const applyCamera = () => {
    if (mode === 'walk') {
      camera.position.copy(walk.pos)
      const dir = new THREE.Vector3(Math.sin(walk.yaw) * Math.cos(walk.pitch), Math.sin(walk.pitch), Math.cos(walk.yaw) * Math.cos(walk.pitch))
      camera.lookAt(camera.position.clone().add(dir))
      return
    }
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
  const onDown = (e: PointerEvent) => { dragging = true; last = { x: e.clientX, y: e.clientY } }
  const onMove = (e: PointerEvent) => {
    if (!dragging) return
    const dx = e.clientX - last.x
    const dy = e.clientY - last.y
    last = { x: e.clientX, y: e.clientY }
    if (mode === 'walk') {
      walk.yaw -= dx * 0.005
      walk.pitch = Math.max(-1.3, Math.min(1.3, walk.pitch - dy * 0.005))
    } else {
      orbit.yaw -= dx * 0.008
      orbit.pitch = Math.max(0.2, Math.min(1.4, orbit.pitch - dy * 0.006))
    }
    applyCamera()
  }
  const onUp = () => (dragging = false)
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    if (mode === 'walk') return
    orbit.dist = Math.max(radius * 0.4, Math.min(radius * 2.5, orbit.dist * (e.deltaY < 0 ? 0.9 : 1.1)))
    applyCamera()
  }
  const onKeyDown = (e: KeyboardEvent) => { if (mode === 'walk') keys.add(e.key.toLowerCase()) }
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase())
  renderer.domElement.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

  const stepWalk = (dt: number) => {
    if (mode !== 'walk' || keys.size === 0) return
    const speed = 12 * dt
    const fwd = new THREE.Vector3(Math.sin(walk.yaw), 0, Math.cos(walk.yaw))
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x)
    if (keys.has('w')) walk.pos.addScaledVector(fwd, speed)
    if (keys.has('s')) walk.pos.addScaledVector(fwd, -speed)
    if (keys.has('a')) walk.pos.addScaledVector(right, -speed)
    if (keys.has('d')) walk.pos.addScaledVector(right, speed)
    walk.pos.x = Math.max(0, Math.min(def.width, walk.pos.x))
    walk.pos.z = Math.max(0, Math.min(def.height, walk.pos.z))
    walk.pos.y = heightField.heightAt(walk.pos.x, walk.pos.z) + 1.6
    applyCamera()
  }

  const walkBtn = document.getElementById('preview3dWalk') as HTMLButtonElement
  const reviewBtn = document.getElementById('preview3dReview') as HTMLButtonElement
  const strip = document.getElementById('preview3dReviewStrip')!
  const onWalkClick = () => {
    mode = mode === 'walk' ? 'orbit' : 'walk'
    walkBtn.classList.toggle('active', mode === 'walk')
    applyCamera()
  }
  const onReviewClick = () => reviewCapture(renderer, scene, camera, def, center, radius, strip)
  walkBtn.addEventListener('click', onWalkClick)
  reviewBtn.addEventListener('click', onReviewClick)

  let raf = 0
  const clock = new THREE.Clock()
  const loop = () => {
    const dt = clock.getDelta()
    stepWalk(dt)
    ambient.update(dt)
    renderer.render(scene, camera)
    raf = requestAnimationFrame(loop)
  }
  loop()

  current = {
    dispose: () => {
      cancelAnimationFrame(raf)
      ambient.dispose()
      heightField.dispose()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('wheel', onWheel)
      walkBtn.removeEventListener('click', onWalkClick)
      reviewBtn.removeEventListener('click', onReviewClick)
      walkBtn.classList.remove('active')
      strip.innerHTML = ''
      renderer.dispose()
      renderer.domElement.remove()
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat?.dispose()
      })
      modal.style.display = 'none'
    },
  }
}

// Captures the screenshot-gate angles (spawn, an overview that frames the
// landmark, and one looking in through each exit) into labelled thumbnails —
// the in-editor version of scripts/shoot-zone.mjs, a click instead of a build.
function reviewCapture(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  def: ZoneDef,
  center: THREE.Vector3,
  radius: number,
  strip: HTMLElement,
): void {
  const shots: { label: string; eye: THREE.Vector3; look: THREE.Vector3 }[] = []
  const spawn = tileToWorld(def.spawn.x, def.spawn.z)
  shots.push({ label: 'Spawn', eye: new THREE.Vector3(spawn.x, radius * 0.28, spawn.z + radius * 0.32), look: spawn })
  shots.push({ label: 'Overview', eye: new THREE.Vector3(center.x + radius * 0.55, radius * 0.7, center.z + radius * 0.72), look: center })
  for (const ex of def.exits ?? []) {
    const at = tileToWorld(ex.x, ex.z)
    const inward = center.clone().sub(at).setY(0).normalize()
    const eye = at.clone().addScaledVector(inward, -radius * 0.12)
    eye.y = radius * 0.2
    shots.push({ label: `Exit: ${ex.label}`, eye, look: at })
  }
  strip.innerHTML = ''
  for (const s of shots) {
    camera.position.copy(s.eye)
    camera.lookAt(s.look)
    renderer.render(scene, camera)
    const url = renderer.domElement.toDataURL('image/png')
    const fig = document.createElement('figure')
    fig.style.margin = '0'
    const img = document.createElement('img')
    img.src = url
    img.width = 150
    img.style.cssText = 'border-radius:4px;display:block'
    const cap = document.createElement('figcaption')
    cap.textContent = s.label
    cap.className = 'hint'
    cap.style.cssText = 'text-align:center;margin-top:2px'
    fig.appendChild(img)
    fig.appendChild(cap)
    strip.appendChild(fig)
  }
}

export function closePreview3D(): void {
  current?.dispose()
  current = null
}
