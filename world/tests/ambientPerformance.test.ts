import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createAmbient, createWalkerSampler, walkerFramesAt, type Walker } from '../client/src/ambient'

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    async loadAsync() {
      const scene = new THREE.Group()
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
      return { scene, animations: [
        new THREE.AnimationClip('idle', 1, [new THREE.NumberKeyframeTrack('.position[y]', [0, 1], [0, 0])]),
        new THREE.AnimationClip('walk', 1, [new THREE.NumberKeyframeTrack('.position[y]', [0, 1], [0, .2])]),
      ] }
    }
  },
}))
afterEach(() => vi.unstubAllGlobals())

describe('ambient waypoint work', () => {
  const grid = Array.from({ length: 32 }, () => '.'.repeat(32))
  const walkers: Walker[] = Array.from({ length: 12 }, (_, seed) => ({ seed, rect: { cx: 2, cz: 2, cw: 20, ch: 20 } }))
  it('reuses collision work within a leg while preserving deterministic positions', () => {
    let reads = 0
    const observed = new Proxy(grid, { get(target, key, receiver) {
      if (/^\d+$/.test(String(key))) reads++
      return Reflect.get(target, key, receiver)
    } })
    const sample = createWalkerSampler(observed, walkers)
    const first = sample(9.1)
    expect(first).toEqual(walkerFramesAt(grid, walkers, 9.1))
    const initialReads = reads
    const later = sample(9.2)
    expect(later).toEqual(walkerFramesAt(grid, walkers, 9.2))
    expect(later[0].x).not.toBe(first[0].x)
    expect(reads).toBe(initialReads)
  })
  it('remains correct across skipped legs and backwards wall-clock corrections', () => {
    const sample = createWalkerSampler(grid, walkers)
    for (const seconds of [0, 4.499, 4.5, 4.6, 90_001.5, 8, 0]) {
      expect(sample(seconds)).toEqual(walkerFramesAt(grid, walkers, seconds))
    }
  })
})

describe('ambient visibility', () => {
  const collision = Array.from({ length: 160 }, () => '.'.repeat(160))
  const ambient = { critters: [
    { model: 'villager_a', count: 1, x: 10, z: 10, w: 2, h: 2 },
    { model: 'villager_a', count: 1, x: 130, z: 130, w: 2, h: 2 },
  ] }
  it('shares loaded mesh geometry between specs while keeping independent instances', async () => {
    const scene = new THREE.Scene()
    const layer = createAmbient(scene, ambient, () => 0, collision, 'test')
    await layer.ready
    const meshes: THREE.Mesh[] = []
    scene.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o) })
    expect(meshes).toHaveLength(2)
    expect(meshes[0]).not.toBe(meshes[1])
    expect(meshes[0].geometry).toBe(meshes[1].geometry)
    layer.dispose()
  })
  it('pauses distant mixers and restores absolute positions when the camera moves', async () => {
    const scene = new THREE.Scene()
    const layer = createAmbient(scene, ambient, () => 0, collision, 'test')
    await layer.ready
    const camera = new THREE.PerspectiveCamera(40, 1, .1, 200)
    camera.position.set(11, 12, 20)
    camera.lookAt(11, 0, 11)
    layer.update(.1, 12, { camera, centre: { x: 11, z: 11 } })
    const near = scene.children[0], far = scene.children[1]
    expect(near.visible).toBe(true)
    expect(far.visible).toBe(false)
    const distantAnimationY = far.children[0].position.y
    layer.update(.3, 12.3, { camera, centre: { x: 11, z: 11 } })
    expect(far.children[0].position.y).toBe(distantAnimationY)
    camera.position.set(131, 12, 140)
    camera.lookAt(131, 0, 131)
    layer.update(.1, 40, { camera, centre: { x: 131, z: 131 } })
    expect(far.visible).toBe(true)
    const expected = walkerFramesAt(collision, [
      { seed: (await import('../client/src/ambient')).walkerSeed('test', 0, 0), rect: { cx: 10, cz: 10, cw: 2, ch: 2 } },
      { seed: (await import('../client/src/ambient')).walkerSeed('test', 1, 0), rect: { cx: 130, cz: 130, cw: 2, ch: 2 } },
    ], 40)[1]
    expect(far.position.x).toBe(expected.x)
    expect(far.position.z).toBe(expected.z)
    layer.dispose()
  })
  it('skips invisible chimney updates and resumes smoke near the camera', () => {
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({
      createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: null,
    }) }) })
    const scene = new THREE.Scene()
    const layer = createAmbient(scene, { smoke: [{ x: 130, z: 130 }] }, () => 0, collision, 'test')
    const smoke = scene.children[0] as THREE.Points
    const camera = new THREE.PerspectiveCamera(40, 1, .1, 200)
    camera.position.set(11, 12, 20); camera.lookAt(11, 0, 11)
    const before = [...smoke.geometry.attributes.position.array]
    layer.update(.1, 12, { camera, centre: { x: 11, z: 11 } })
    expect(smoke.visible).toBe(false)
    expect([...smoke.geometry.attributes.position.array]).toEqual(before)
    camera.position.set(131, 12, 140); camera.lookAt(131, 0, 131)
    layer.update(.1, 12.1, { camera, centre: { x: 131, z: 131 } })
    expect(smoke.visible).toBe(true)
    expect([...smoke.geometry.attributes.position.array]).not.toEqual(before)
    layer.dispose()
  })
})
