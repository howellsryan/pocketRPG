import * as THREE from 'three'
import type { ZoneDef } from '../../../shared/zone'
import { createScene, createLights, tileToWorld } from '../scene'
import { createTerrain } from '../terrain'
import { createScatterLayers } from '../scatter'
import { createStatics } from '../statics'
import { createProps } from '../props'
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
  const { heightField } = createTerrain(scene, def.collision, def.width, def.height, def.palette, def.terrain)
  void createProps(scene, def.props ?? [])
  void createStatics(scene, def.objects)
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

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(width, height)
  host.appendChild(renderer.domElement)

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 500)
  const center = new THREE.Vector3(def.width / 2, 0, def.height / 2)
  const radius = Math.max(def.width, def.height)
  const orbit = { yaw: Math.PI / 4, pitch: 0.9, dist: radius * 1.1 }

  const applyCamera = () => {
    const x = center.x + orbit.dist * Math.cos(orbit.pitch) * Math.sin(orbit.yaw)
    const y = orbit.dist * Math.sin(orbit.pitch)
    const z = center.z + orbit.dist * Math.cos(orbit.pitch) * Math.cos(orbit.yaw)
    camera.position.set(x, y, z)
    camera.lookAt(center)
  }
  applyCamera()

  let dragging = false
  let last = { x: 0, y: 0 }
  const onDown = (e: PointerEvent) => { dragging = true; last = { x: e.clientX, y: e.clientY } }
  const onMove = (e: PointerEvent) => {
    if (!dragging) return
    orbit.yaw -= (e.clientX - last.x) * 0.008
    orbit.pitch = Math.max(0.2, Math.min(1.4, orbit.pitch - (e.clientY - last.y) * 0.006))
    last = { x: e.clientX, y: e.clientY }
    applyCamera()
  }
  const onUp = () => (dragging = false)
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    orbit.dist = Math.max(radius * 0.4, Math.min(radius * 2.5, orbit.dist * (e.deltaY < 0 ? 0.9 : 1.1)))
    applyCamera()
  }
  renderer.domElement.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

  let raf = 0
  const loop = () => {
    renderer.render(scene, camera)
    raf = requestAnimationFrame(loop)
  }
  loop()

  current = {
    dispose: () => {
      cancelAnimationFrame(raf)
      heightField.dispose()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('wheel', onWheel)
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

export function closePreview3D(): void {
  current?.dispose()
  current = null
}
