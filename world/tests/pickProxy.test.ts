// Regression: hovering or clicking a monster must never raycast its rendered
// model. three.js resolves a SkinnedMesh hit by bone-transforming every vertex
// of every triangle, for any ray that merely clips the bind-pose bounding
// sphere — measured at 40–50 ms for Warlord Grondar's 39 k-triangle mesh
// against 0.009 ms for a ray that misses it. Hover raycasts once per animation
// frame (input.ts) and every click raycasts again, so with the cursor parked on
// the boss — i.e. the whole time you are attacking him — that cost landed on
// every frame and tanked the frame rate. entities.ts gives each entity an
// invisible 12-triangle pick proxy and main.ts's getPickables hands those to
// the raycaster instead of the models.
//
// Driven with arcane_adept: it is the same createMonsterMesh registry branch
// Grondar takes, and its GLB carries no textures, so the real production
// loader parses it under Node (webp-textured models need a browser).
import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { PICK_PROXY, createMonsterMesh, pickProxyOf } from '../client/src/entities'
import { MONSTER_MODELS } from '../shared/monsterModels'

const MONSTER = 'arcane_adept'
const SPEC = MONSTER_MODELS[MONSTER]
const MODEL_PATH = path.join(__dirname, '../client/public/models/wizard.glb')

/** Serves the real committed GLB to entities.ts's production loader. */
function stubModelFetch(): void {
  const bytes = fs.readFileSync(MODEL_PATH)
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(bytes, { status: 200, headers: { 'content-type': 'model/gltf-binary' } }),
  ))
  // three's FileLoader reports download progress via a browser ProgressEvent
  // that doesn't exist in Node — test-only shim (same as entitiesGear.test.ts).
  vi.stubGlobal('ProgressEvent', class { constructor(_type: string, _init?: unknown) {} })
  // The registry's site-absolute model URLs ('/models/…') are fine in a browser
  // but Node's Request rejects them — give them an origin instead of changing
  // production code for the test.
  THREE.DefaultLoadingManager.setURLModifier((url) => (url.startsWith('/') ? `http://localhost${url}` : url))
}

function restoreModelFetch(): void {
  THREE.DefaultLoadingManager.setURLModifier(null as unknown as (url: string) => string)
  vi.unstubAllGlobals()
}

describe('entity pick proxy', () => {
  it('resolves a pick through the proxy box, never the skinned model', async () => {
    stubModelFetch()
    try {
      const { mesh } = await createMonsterMesh(MONSTER)
      const proxy = pickProxyOf(mesh)
      expect(proxy.name).toBe(PICK_PROXY)
      // Never rendered: no draw call, and out of the shadow pass.
      expect(proxy.visible).toBe(false)
      expect(proxy.castShadow).toBe(false)

      const skinned: THREE.SkinnedMesh[] = []
      mesh.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh) })
      expect(skinned.length).toBeGreaterThan(0)
      const spies = skinned.map((s) => vi.spyOn(s, 'raycast'))

      mesh.position.set(0, 0, 0)
      mesh.updateMatrixWorld(true)
      const raycaster = new THREE.Raycaster()
      // Straight through the body — the ray input.ts casts with the cursor on it.
      raycaster.set(new THREE.Vector3(0, SPEC.targetHeight / 2, 6), new THREE.Vector3(0, 0, -1))
      const hits = raycaster.intersectObjects([proxy], true)

      expect(hits.length).toBeGreaterThan(0)
      // Walking up from the hit reaches the entity group, so pickTargetOf still
      // finds the Pickable main.ts stamps on it.
      expect(hits[0].object.parent).toBe(mesh)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      restoreModelFetch()
    }
  })

  it('spans the registry render height, on a footprint near the tile', async () => {
    stubModelFetch()
    try {
      const { mesh } = await createMonsterMesh(MONSTER)
      mesh.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(pickProxyOf(mesh), true)
      expect(box.min.y).toBeCloseTo(0, 3)
      expect(box.max.y).toBeCloseTo(SPEC.targetHeight + (SPEC.hover ?? 0), 3)
      // Capped so a 2.8-tile boss can't swallow clicks on everything beside him.
      expect(box.max.x - box.min.x).toBeLessThanOrEqual(1.6)
      expect(box.max.x - box.min.x).toBeGreaterThanOrEqual(0.6)
    } finally {
      restoreModelFetch()
    }
  })
})
