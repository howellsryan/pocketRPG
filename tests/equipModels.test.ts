import { describe, it, expect } from 'vitest'
import { getCharacterModel, getWeaponModel, hasWeaponModel, modelUrl } from '../src/utils/equipModels.js'
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
    expect(modelUrl('crimson_dagger.glb', '/public/3d-samples/')).toBe('/public/3d-samples/crimson_dagger.glb')
    expect(modelUrl('crimson_dagger.glb')).toBe(registry.modelBase + 'crimson_dagger.glb')
    expect(modelUrl('/already/abs.glb')).toBe('/already/abs.glb')
    expect(modelUrl('https://x/y.glb')).toBe('https://x/y.glb')
    expect(modelUrl(null)).toBeNull()
  })

  it('every registered weapon id exists in items.json (no dangling models)', async () => {
    const items = (await import('../src/data/items.json')).default as Record<string, unknown>
    for (const id of Object.keys(registry.weapons)) {
      expect(items[id], `weapon model '${id}' has no matching item`).toBeTruthy()
    }
  })
})
