// Exit markers are the pulsing gold pads on an exit tile. A zone can opt an
// exit out of them (Grondar's lair leaves through a door prop, and a glowing
// pad on a barrow floor breaks the mood) — but the tile must keep working,
// since stepping on it is what transitions, server-side.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createExitMarkers } from '../client/src/exits'
import { ZONES } from '../server/zones'

describe('createExitMarkers', () => {
  it('renders a pad and a click target for an ordinary exit', () => {
    const scene = new THREE.Scene()
    const layer = createExitMarkers(scene, [{ id: 'e1', x: 3, z: 4, label: 'Somewhere' }])
    expect(layer.pickables).toHaveLength(1)
    expect(layer.tiles.get('e1')).toEqual({ x: 3, z: 4 })
    expect(scene.children).toHaveLength(1)
  })

  it('renders nothing at all for an exit that opted out', () => {
    const scene = new THREE.Scene()
    const layer = createExitMarkers(scene, [{ id: 'e1', x: 3, z: 4, label: 'Somewhere', hideMarker: true }])
    expect(layer.pickables).toHaveLength(0)
    expect(layer.tiles.has('e1')).toBe(false)
    expect(scene.children).toHaveLength(0)
  })

  it('hides only the exits that asked to be hidden', () => {
    const scene = new THREE.Scene()
    const layer = createExitMarkers(scene, [
      { id: 'shown', x: 1, z: 1, label: 'A' },
      { id: 'hidden', x: 2, z: 2, label: 'B', hideMarker: true },
    ])
    expect(layer.pickables).toHaveLength(1)
    expect([...layer.tiles.keys()]).toEqual(['shown'])
  })

  it('does not throw its update loop off when every marker is hidden', () => {
    const scene = new THREE.Scene()
    const layer = createExitMarkers(scene, [{ id: 'e1', x: 1, z: 1, label: 'A', hideMarker: true }])
    expect(() => layer.update(1234)).not.toThrow()
  })
})

describe("Grondar's lair", () => {
  it('still has a walkable way out, just no pad on it', () => {
    const lair = ZONES.grondar_lair
    const exit = lair.exits?.[0]
    expect(exit?.hideMarker).toBe(true)
    expect(exit?.toZone).toBe('overworld')
    // The tile the player steps on has to stay walkable or the door is sealed.
    expect(lair.collision[exit!.z][exit!.x]).toBe('.')
  })
})
