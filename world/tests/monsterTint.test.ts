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
import { MONSTER_ANIM_CLIPS, applyFormTint, createCowMesh, createMonsterMesh, loadTemplate, prepareFormTint } from '../client/src/entities'
import { MONSTER_MODELS, formTintColor } from '../shared/monsterModels'

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
  // still renders, frozen in bind pose, with nothing failing loudly. The attack
  // clip is the one that shipped missing: the server pulses an 'attack' anim on
  // every monster swing, and a GLB without the clip stands still while its hit
  // splat lands on the player.
  it.each(['lesser_fiend', 'green_dragon', 'pasture_bull'])('%s animates its idle, walk, death AND attack', async (id) => {
    stubModelFetch()
    const { animator } = await createMonsterMesh(id)
    expect(animator?.kind).toBe('gltf')
    const actions = (animator as { actions: Record<string, unknown> }).actions
    expect(Object.keys(actions).sort()).toEqual(['attack', 'die', 'idle', 'walk'])
  })

  it.each(['lesser_fiend', 'green_dragon', 'pasture_bull'])('%s delays its swing so the impact frame lands on the splat', async (id) => {
    stubModelFetch()
    const { animator } = await createMonsterMesh(id)
    // Derived from attackImpactSec; 0 would mean the clip fires on the tick
    // edge and the blow visibly lands early.
    expect((animator as { swingDelayMs?: number }).swingDelayMs).toBeGreaterThan(0)
  })
})

describe('a multi-form boss wears its phase', () => {
  const ZARYTH = 'zaryth_the_empty_lord'
  const forms = MONSTER_MODELS[ZARYTH].formTint!

  /** A stand-in for a loaded model: two meshes sharing ONE material, the way a
   * cached GLTF's clones do — which is the whole reason the tint has to clone
   * before it paints. Zaryth's own GLB is textured, so it can't be parsed in
   * this Node harness (the loader reaches for ImageBitmap); the clip and asset
   * invariants for it are structural instead. */
  function fakeModel(): { group: THREE.Object3D; model: THREE.Object3D; shared: THREE.MeshStandardMaterial } {
    const shared = new THREE.MeshStandardMaterial({ color: '#8899aa' })
    shared.name = 'Body'
    const model = new THREE.Group()
    model.add(new THREE.Mesh(new THREE.BoxGeometry(), shared))
    model.add(new THREE.Mesh(new THREE.BoxGeometry(), shared))
    const group = new THREE.Group()
    group.add(model)
    return { group, model, shared }
  }

  it('paints a different colour per phase and puts the original back on the way out', () => {
    const { group, model, shared } = fakeModel()
    prepareFormTint(group, model)
    const untinted = materialColors(group)

    const seen = new Set<string>()
    for (const form of Object.keys(forms)) {
      applyFormTint(group, formTintColor(ZARYTH, form))
      const painted = materialColors(group)
      expect(painted).not.toEqual(untinted)
      seen.add(JSON.stringify(painted))
    }
    expect(seen.size).toBe(Object.keys(forms).length)

    // A respawned boss is its own colour again — the ORIGINAL, not the last
    // phase blended over one more time.
    applyFormTint(group, null)
    expect(materialColors(group)).toEqual(untinted)
    // And the material every other clone of this model shares was never touched.
    expect(`#${shared.color.getHexString()}`).toBe('#8899aa')
  })

  it('leaves a phase tint on one boss alone', () => {
    const a = fakeModel()
    const b = fakeModel()
    prepareFormTint(a.group, a.model)
    prepareFormTint(b.group, b.model)

    applyFormTint(a.group, formTintColor(ZARYTH, 'melee'))

    expect(materialColors(b.group)).not.toEqual(materialColors(a.group))
  })

  it('has no colour for a form it does not tint, or a monster that does not phase', () => {
    expect(formTintColor(ZARYTH, 'not_a_form')).toBeNull()
    expect(formTintColor(ZARYTH, null)).toBeNull()
    expect(formTintColor('green_dragon', 'melee')).toBeNull()
  })
})

describe('every clip a shipped rig carries is one the animator binds', () => {
  // The bug this pins: Zaryth's GLB ships attack_ranged and attack_magic and the
  // monster animator asked for neither, so both fell back to the melee swing —
  // invisible from the asset side, invisible from the code side, only visible
  // where the two meet. Structural over every registered model, so a rebuild
  // that adds a clip nothing plays fails here.
  it.each(Object.entries(MONSTER_MODELS))('%s ships no clip the animator ignores', (_id, spec) => {
    const glb = fs.readFileSync(path.join(MODELS, path.basename(spec.url)))
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'))
    for (const clip of (json.animations ?? []) as { name: string }[]) {
      expect(MONSTER_ANIM_CLIPS, `clip '${clip.name}'`).toContain(clip.name)
    }
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
