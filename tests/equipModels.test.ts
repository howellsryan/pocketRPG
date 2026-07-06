import { describe, it, expect } from 'vitest'
import { getCharacterModel, getWeaponModel, hasWeaponModel, modelUrl, getCharacterAssetPath, getWeaponPlacement } from '../src/utils/equipModels.js'
import registry from '../src/data/equipmentModels.json'

describe('equipModels resolver', () => {
  it('returns the character model spec', () => {
    const c = getCharacterModel()
    expect(c).toBeTruthy()
    expect(typeof c.model).toBe('string')
  })

  it('returns null for an unregistered weapon (icon-UI fallback)', () => {
    expect(getWeaponModel('bronze_dagger')).toBeNull()
    expect(getWeaponModel(undefined)).toBeNull()
    expect(hasWeaponModel('bronze_dagger')).toBe(false)
  })

  it('resolves a registered weapon with a full placement spec', () => {
    const [id] = Object.keys(registry.weapons)
    const spec = getWeaponModel(id)
    expect(spec).toBeTruthy()
    expect(spec!.model).toBe(registry.weapons[id].model)
    expect(spec!.position).toHaveLength(3)
    expect(spec!.rotationDeg).toHaveLength(3)
    expect(typeof spec!.scale).toBe('number')
    expect(hasWeaponModel(id)).toBe(true)
  })

  it('falls back to the default hand bone when an entry omits one', () => {
    const [id] = Object.keys(registry.weapons)
    const spec = getWeaponModel(id)
    // sample entry has bone:null → resolver substitutes the default hand bone
    if (registry.weapons[id].bone == null) {
      expect(spec!.bone).toBe(registry.defaults.handBone)
    }
  })

  it('builds fetchable model URLs and leaves absolute ones untouched', () => {
    // explicit base wins
    expect(modelUrl('crimson_dagger.glb', '/public/3d-samples/')).toBe('/public/3d-samples/crimson_dagger.glb')
    // default: assetBase ('/' in Node, no injected global) + registry.modelBase
    expect(modelUrl('crimson_dagger.glb')).toBe('/' + registry.modelBase + 'crimson_dagger.glb')
    expect(modelUrl('/already/abs.glb')).toBe('/already/abs.glb')
    expect(modelUrl('https://x/y.glb')).toBe('https://x/y.glb')
    expect(modelUrl(null)).toBeNull()
  })

  it('exposes prefix-agnostic asset paths for the viewer', () => {
    expect(getCharacterAssetPath()).toBe(registry.modelBase + registry.character.model)
    const [id] = Object.keys(registry.weapons)
    const placement = getWeaponPlacement(id)
    expect(placement).toBeTruthy()
    expect(placement!.path).toBe(registry.modelBase + registry.weapons[id].model)
    expect(placement!.path.startsWith('/')).toBe(false) // relative, resolved at runtime
    expect(getWeaponPlacement('bronze_dagger')).toBeNull()
  })

  it('every registered weapon id exists in items.json (no dangling models)', async () => {
    const items = (await import('../src/data/items.json')).default as Record<string, unknown>
    for (const id of Object.keys(registry.weapons)) {
      expect(items[id], `weapon model '${id}' has no matching item`).toBeTruthy()
    }
  })

  it('every registered model file exists on disk (no dangling paths)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const base = path.resolve(__dirname, '../public', registry.modelBase)
    const models = [registry.character.model, ...Object.values(registry.weapons).map((w) => w.model)]
    for (const m of models) {
      if (/^(https?:)?\/\//.test(m) || m.startsWith('/')) continue // remote/absolute — not repo-served
      expect(fs.existsSync(path.join(base, m)), `${registry.modelBase}${m} missing from public/`).toBe(true)
    }
  })

  it('the character idleClip (when set) exists in the hero GLB', async () => {
    const idle = (registry.character as { idleClip?: string }).idleClip
    if (!idle) return
    const fs = await import('node:fs')
    const path = await import('node:path')
    const glb = path.resolve(__dirname, '../public', registry.modelBase, registry.character.model)
    // GLB chunk 0 is JSON; animation names live in it as plain strings.
    const buf = fs.readFileSync(glb)
    const jsonLen = buf.readUInt32LE(12)
    const json = buf.subarray(20, 20 + jsonLen).toString('utf8')
    expect(json.includes(`"${idle}"`), `clip '${idle}' not found in ${registry.character.model}`).toBe(true)
  })
})
