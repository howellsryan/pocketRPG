import * as THREE from 'three'
import { tileToWorld } from './scene'
import type { ExitMarker } from '../../shared/protocol'
import type { Pickable } from './picking'

// Zone exits render as pulsing gold pads. Clicking one ('exit' pick kind) is
// handled client-side as a plain walk to the tile — stepping on it is what
// transitions, server-side.
export type ExitLayer = {
  pickables: THREE.Object3D[]
  tiles: Map<string, { x: number; z: number }>
  update: (now: number) => void
}

export function createExitMarkers(scene: THREE.Scene, exits: ExitMarker[]): ExitLayer {
  const pickables: THREE.Object3D[] = []
  const tiles = new Map<string, { x: number; z: number }>()
  const pulsing: THREE.MeshBasicMaterial[] = []

  for (const exit of exits) {
    const wrapper = new THREE.Group()
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.04, 24),
      new THREE.MeshBasicMaterial({ color: 0xd9a94a, transparent: true, opacity: 0.55 })
    )
    pad.position.y = 0.02
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.44, 0.55, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xf3d27e, transparent: true, opacity: 0.8 })
    )
    ring.position.y = 0.03
    wrapper.add(pad, ring)
    wrapper.position.copy(tileToWorld(exit.x, exit.z))
    wrapper.userData.pick = {
      kind: 'exit', id: exit.id, name: exit.label,
      actions: [{ label: 'Go-to', action: 'go' }],
      examine: 'The path leads onward.',
    } satisfies Pickable
    scene.add(wrapper)
    pickables.push(wrapper)
    tiles.set(exit.id, { x: exit.x, z: exit.z })
    pulsing.push(pad.material as THREE.MeshBasicMaterial, ring.material as THREE.MeshBasicMaterial)
  }

  function update(now: number): void {
    const pulse = 0.65 + 0.35 * Math.sin(now / 400)
    for (let i = 0; i < pulsing.length; i += 2) {
      pulsing[i].opacity = 0.35 + 0.3 * pulse
      pulsing[i + 1].opacity = 0.5 + 0.4 * pulse
    }
  }

  return { pickables, tiles, update }
}
