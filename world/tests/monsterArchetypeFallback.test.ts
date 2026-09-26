// Most monsters have neither a bespoke GLB (shared/monsterModels.ts) nor a
// creatures3d spec of their own, and used to render as the literal cow
// regardless of species. resolveArchetypeFallback lets them borrow another
// monster's model/spec that shares their idle-game archetype instead. These
// use synthetic ids (matched only by monsterFigures.js's ARCHETYPE_RULES
// regexes, never the real bestiary) so the tests don't drift as content is
// added, and prove the resolver + the real render pipeline independently.
import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCowMesh, createMonsterMesh } from '../client/src/entities'
import { creatureSpecFor } from '../client/src/procCreature'
import { MONSTER_MODELS } from '../shared/monsterModels'
import { ARCHETYPE_FALLBACK, resolveArchetypeFallback } from '../shared/monsterArchetypeFallback'
import { monsterArchetypeFor, monsterPaletteNameFor } from '../../src/utils/monsterFigures.js'
import { hidePaletteHexFor } from '../../src/utils/hidePaletteHex.js'
import creatures3dData from '../../src/data/creatures3d.json'

const MODELS = path.join(__dirname, '../client/public/models')
const creatures3dMonsters = (creatures3dData as unknown as { monsters: Record<string, unknown> }).monsters

function stubModelFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input)
    const name = path.basename(new URL(url, 'http://localhost').pathname)
    const bytes = fs.readFileSync(path.join(MODELS, name))
    return new Response(bytes, { status: 200, headers: { 'content-type': 'model/gltf-binary' } })
  }))
  vi.stubGlobal('ProgressEvent', class { constructor(_type: string, _init?: unknown) {} })
  THREE.DefaultLoadingManager.setURLModifier((url) => (url.startsWith('/') ? `http://localhost${url}` : url))
}

function materialColors(mesh: THREE.Object3D): string[] {
  const out: string[] = []
  mesh.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.material) return
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const mm = m as THREE.MeshStandardMaterial
      if (mm.color) out.push(`#${mm.color.getHexString()}`)
    }
  })
  return out
}

afterEach(() => {
  THREE.DefaultLoadingManager.setURLModifier(null as unknown as (url: string) => string)
  vi.unstubAllGlobals()
})

describe('ARCHETYPE_FALLBACK table', () => {
  it('every GLB template names a real MONSTER_MODELS entry', () => {
    for (const [archetype, fb] of Object.entries(ARCHETYPE_FALLBACK)) {
      if (fb.kind !== 'glb') continue
      expect(MONSTER_MODELS[fb.templateId], `${archetype} -> ${fb.templateId}`).toBeDefined()
    }
  })

  it('every proc template names a real creatures3d spec', () => {
    for (const [archetype, fb] of Object.entries(ARCHETYPE_FALLBACK)) {
      if (fb.kind !== 'proc') continue
      expect(creatures3dMonsters[fb.templateId], `${archetype} -> ${fb.templateId}`).toBeDefined()
    }
  })
})

describe('resolveArchetypeFallback', () => {
  it('resolves a covered archetype to its template, tinted to the monster\'s own palette', () => {
    const id = 'test_swamp_toad'
    const archetype = monsterArchetypeFor({ id })
    expect(archetype).toBe('toad')
    expect(resolveArchetypeFallback(id)).toEqual({
      kind: 'glb',
      templateId: 'marshfen_toad',
      tintHex: hidePaletteHexFor(monsterPaletteNameFor({ id }, archetype)),
    })
  })

  it('resolves an uncovered archetype to nothing, so the caller keeps falling back to the cow', () => {
    const id = 'test_rockborn_golem'
    expect(monsterArchetypeFor({ id })).toBe('golem')
    expect(ARCHETYPE_FALLBACK.golem).toBeUndefined()
    expect(resolveArchetypeFallback(id)).toBeNull()
  })

  it('picks the demon template for a demon-archetype id', () => {
    const id = 'test_void_fiend'
    expect(monsterArchetypeFor({ id })).toBe('demon')
    expect(resolveArchetypeFallback(id)).toMatchObject({ kind: 'glb', templateId: 'lesser_fiend' })
  })

  it('picks a proc template for an archetype with no GLB coverage', () => {
    const id = 'test_marsh_serpent'
    expect(monsterArchetypeFor({ id })).toBe('serpent')
    expect(resolveArchetypeFallback(id)).toMatchObject({ kind: 'proc', templateId: 'cindermaw_serpent' })
  })
})

describe('createMonsterMesh archetype fallback', () => {
  it('a monster with no model or spec of its own borrows its archetype template, in its own colour', async () => {
    const id = 'test_void_fiend'
    expect(MONSTER_MODELS[id]).toBeUndefined()
    expect(creatureSpecFor(id)).toBeNull()
    stubModelFetch()
    const { mesh, animator } = await createMonsterMesh(id)
    expect(animator?.kind).toBe('gltf')
    const expectedHex = resolveArchetypeFallback(id)!.tintHex.toLowerCase()
    expect(materialColors(mesh)).toContain(expectedHex)
  })

  it('never overrides a monster that already has its own registered model', async () => {
    stubModelFetch()
    const green = materialColors((await createMonsterMesh('green_dragon')).mesh)
    expect(green).toContain(MONSTER_MODELS.green_dragon.tint!.Dragon_Main.toLowerCase())
  })

  it('a monster whose archetype has no template still renders as the cow', async () => {
    stubModelFetch()
    const cow = new THREE.Box3().setFromObject((await createCowMesh()).mesh).getSize(new THREE.Vector3())
    const golem = new THREE.Box3().setFromObject((await createMonsterMesh('test_rockborn_golem')).mesh).getSize(new THREE.Vector3())
    expect(golem.x / cow.x).toBeCloseTo(1, 2)
    expect(golem.y / cow.y).toBeCloseTo(1, 2)
    expect(golem.z / cow.z).toBeCloseTo(1, 2)
  })
})
