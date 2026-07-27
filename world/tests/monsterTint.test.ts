// The three dragons share one GLB (/models/dragon.glb) and differ only by
// MonsterModel.tint. loadTemplate caches the parsed GLTF and cloneSkeleton keeps
// its materials, so tinting in place would repaint every dragon already on the
// map — including the one whose colour was set first. These tests drive the real
// production loader against the committed GLB (untextured, so it parses under
// Node) and assert each variant gets its own materials.
import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCowMesh, createMonsterMesh, loadTemplate } from '../client/src/entities'
import { MONSTER_MODELS } from '../shared/monsterModels'

const MODELS = path.join(__dirname, '../client/public/models')

/** Serves whichever committed GLB the loader asks for. */
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

function materialColors(mesh: THREE.Object3D): Record<string, string> {
  const out: Record<string, string> = {}
  mesh.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.material) return
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const mm = m as THREE.MeshStandardMaterial
      if (mm.color) out[mm.name] = `#${mm.color.getHexString()}`
    }
  })
  return out
}

afterEach(() => {
  THREE.DefaultLoadingManager.setURLModifier(null as unknown as (url: string) => string)
  vi.unstubAllGlobals()
})

describe('monster model tint', () => {
  it('gives each dragon its own hide from the shared GLB', async () => {
    stubModelFetch()
    const green = materialColors((await createMonsterMesh('green_dragon')).mesh)
    const red = materialColors((await createMonsterMesh('red_dragon')).mesh)
    const black = materialColors((await createMonsterMesh('black_dragon')).mesh)

    expect(green.Dragon_Main).toBe(MONSTER_MODELS.green_dragon.tint!.Dragon_Main)
    expect(red.Dragon_Main).toBe(MONSTER_MODELS.red_dragon.tint!.Dragon_Main)
    expect(black.Dragon_Main).toBe(MONSTER_MODELS.black_dragon.tint!.Dragon_Main)
    expect(new Set([green.Dragon_Main, red.Dragon_Main, black.Dragon_Main]).size).toBe(3)
  })

  it('leaves the cached template untinted, so a later dragon is not pre-painted', async () => {
    stubModelFetch()
    await createMonsterMesh('red_dragon')
    const template = await loadTemplate(MONSTER_MODELS.red_dragon.url)
    const cached = materialColors(template.scene)
    expect(cached.Dragon_Main).not.toBe(MONSTER_MODELS.red_dragon.tint!.Dragon_Main)
  })

  it('recolours only the named materials', async () => {
    stubModelFetch()
    const template = await loadTemplate(MONSTER_MODELS.green_dragon.url)
    const untinted = materialColors(template.scene)
    const green = materialColors((await createMonsterMesh('green_dragon')).mesh)
    for (const name of Object.keys(untinted)) {
      if (name in MONSTER_MODELS.green_dragon.tint!) continue
      expect(green[name]).toBe(untinted[name])
    }
  })
})

describe('newly registered monster models', () => {
  // A rebuild that loses a clip leaves makeAnimator returning null — the monster
  // still renders, frozen in bind pose, with nothing failing loudly.
  it.each(['lesser_fiend', 'green_dragon', 'pasture_bull'])('%s animates from its GLB', async (id) => {
    stubModelFetch()
    const { animator } = await createMonsterMesh(id)
    expect(animator?.kind).toBe('gltf')
    const actions = (animator as { actions: Record<string, unknown> }).actions
    expect(Object.keys(actions).sort()).toEqual(['die', 'idle', 'walk'])
  })
})

describe('pasture_bull registry entry', () => {
  // The bull used to render through createCowMesh (which scales by body length,
  // not height); moving it into the registry must not resize it on the map.
  it('renders at the size the cow fallback rendered it', async () => {
    stubModelFetch()
    const registered = new THREE.Box3().setFromObject((await createMonsterMesh('pasture_bull')).mesh)
    const fallback = new THREE.Box3().setFromObject((await createCowMesh()).mesh)
    const a = registered.getSize(new THREE.Vector3())
    const b = fallback.getSize(new THREE.Vector3())
    // Relative, not absolute: the bind-pose box is tens of units across, so an
    // absolute tolerance would wave through a visible resize.
    expect(a.x / b.x).toBeCloseTo(1, 2)
    expect(a.y / b.y).toBeCloseTo(1, 2)
    expect(a.z / b.z).toBeCloseTo(1, 2)
  })
})
