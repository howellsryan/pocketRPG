// A monster can opt out of the sun's shadow pass (MonsterModel.noShadow —
// Warlord Grondar uses it). The opt-out has to run AFTER disableFrustumCulling,
// which forces castShadow on every object it walks; get that order wrong and
// the flag silently does nothing.
//
// Driven with cave_goblin for the reason pickProxy.test.ts gives: it takes the
// same createMonsterMesh registry branch Grondar takes, and its GLB carries no
// textures, so the real production loader parses it under Node.
import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMonsterMesh } from '../client/src/entities'
import { MONSTER_MODELS } from '../shared/monsterModels'

const MONSTER = 'cave_goblin'
const MODEL_PATH = path.join(__dirname, '../client/public/models/goblin.glb')

function stubModelFetch(): void {
  const bytes = fs.readFileSync(MODEL_PATH)
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(bytes, { status: 200, headers: { 'content-type': 'model/gltf-binary' } }),
  ))
  vi.stubGlobal('ProgressEvent', class { constructor(_type: string, _init?: unknown) {} })
  THREE.DefaultLoadingManager.setURLModifier((url) => (url.startsWith('/') ? `http://localhost${url}` : url))
}

/** Every object in the mesh that would be drawn into the shadow map. */
function shadowCasters(mesh: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = []
  mesh.traverse((o) => { if (o.castShadow) out.push(o) })
  return out
}

afterEach(() => {
  THREE.DefaultLoadingManager.setURLModifier(null as unknown as (url: string) => string)
  vi.unstubAllGlobals()
  delete MONSTER_MODELS[MONSTER].noShadow
})

describe('monster shadow opt-out', () => {
  it('casts shadows by default', async () => {
    stubModelFetch()
    const { mesh } = await createMonsterMesh(MONSTER)
    expect(shadowCasters(mesh).length).toBeGreaterThan(0)
  })

  it('casts none when the registry opts the monster out', async () => {
    stubModelFetch()
    MONSTER_MODELS[MONSTER].noShadow = true
    const { mesh } = await createMonsterMesh(MONSTER)
    expect(shadowCasters(mesh)).toEqual([])
  })
})
