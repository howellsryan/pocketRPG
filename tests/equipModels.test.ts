import { describe, it, expect } from 'vitest'
import { getCharacterModel, getWeaponModel, hasWeaponModel, modelUrl, getCharacterAssetPath, getWeaponPlacement, getMonsterModel, hasMonsterModel, getGearModel, getGearPlacement, getGearPlacements, getDefaultHeadGearModel, getDefaultHeadGearPlacement, resolveHeadGearModel, resolveHeadGearPlacement, getDefaultBootsModels, getDefaultBootsPlacements } from '../src/utils/equipModels.js'
import registry from '../src/data/equipmentModels.json'

describe('equipModels resolver', () => {
  it('returns the character model spec', () => {
    const c = getCharacterModel()
    expect(c).toBeTruthy()
    expect(typeof c.model).toBe('string')
  })

  it('returns null for an unregistered weapon (icon-UI fallback)', () => {
    expect(getWeaponModel('unregistered_weapon')).toBeNull()
    expect(getWeaponModel(undefined)).toBeNull()
    expect(hasWeaponModel('unregistered_weapon')).toBe(false)
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

  it('distinguishes absent bone (default hand) from explicit null (model root)', () => {
    for (const [id, w] of Object.entries(registry.weapons) as [string, { bone?: string | null }][]) {
      const spec = getWeaponModel(id)
      if (w.bone === undefined) expect(spec!.bone, `${id}: absent bone → default hand bone`).toBe(registry.defaults.handBone)
      else expect(spec!.bone, `${id}: explicit bone honoured verbatim`).toBe(w.bone)
    }
  })

  it('fills omitted transform fields from defaults.weapon (canonical grip)', () => {
    const dw = (registry.defaults as { weapon?: { position: number[]; rotationDeg: number[]; scale: number } }).weapon
    if (!dw) return
    const bare = Object.entries(registry.weapons).find(([, w]) => {
      const ww = w as { position?: number[]; scale?: number }
      return !ww.position && typeof ww.scale !== 'number'
    })
    if (!bare) return
    const spec = getWeaponModel(bare[0])
    expect(spec!.position).toEqual(dw.position)
    expect(spec!.rotationDeg).toEqual(dw.rotationDeg)
    expect(spec!.scale).toBe(dw.scale)
  })

  it('builds fetchable model URLs and leaves absolute ones untouched', () => {
    // explicit base wins
    expect(modelUrl('weapons/q_sword.glb', '/public/3d-samples/')).toBe('/public/3d-samples/weapons/q_sword.glb')
    // default: assetBase ('/' in Node, no injected global) + registry.modelBase
    expect(modelUrl('weapons/q_sword.glb')).toBe('/' + registry.modelBase + 'weapons/q_sword.glb')
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
    expect(getWeaponPlacement('unregistered_weapon')).toBeNull()
  })

  it('resolves registered gear with slot defaults filled in', () => {
    for (const [id, g] of Object.entries(registry.gear || {}) as [string, { model: string; slot: string; scale?: number }][]) {
      const spec = getGearModel(id)
      expect(spec).toBeTruthy()
      expect(spec!.model).toBe(g.model)
      expect(spec!.slot).toBe(g.slot)
      const d = (registry.defaults as { gear?: Record<string, { bone?: string }> }).gear?.[g.slot]
      if (d?.bone) expect(spec!.bone).toBe(d.bone)
      expect(spec!.position).toHaveLength(3)
      expect(spec!.rotationDeg).toHaveLength(3)
      expect(typeof spec!.scale).toBe('number')
      expect(spec!.hideHead).toBe(Boolean((g as { hideHead?: boolean }).hideHead))
      expect(getGearPlacement(id)!.hideHead).toBe(spec!.hideHead)
      expect(spec!.hideBody).toBe(Boolean((g as { hideBody?: boolean }).hideBody))
      expect(getGearPlacement(id)!.hideBody).toBe(spec!.hideBody)
      expect(spec!.hideLegs).toBe(Boolean((g as { hideLegs?: boolean }).hideLegs))
      expect(getGearPlacement(id)!.hideLegs).toBe(spec!.hideLegs)
    }
  })

  it('neck and cape slots have a bone-anchored default transform (rigid props, not skinned)', () => {
    const gd = (registry.defaults as { gear?: Record<string, { bone?: string; scale?: number }> }).gear || {}
    for (const slot of ['neck', 'cape']) {
      expect(gd[slot], `defaults.gear.${slot} required for amulet/cape placement`).toBeTruthy()
      expect(typeof gd[slot].bone, `defaults.gear.${slot}.bone`).toBe('string')
    }
  })

  it('amulet/cape gear tints are concrete hex (the 3D attach path cannot resolve CSS vars)', () => {
    for (const [id, g] of Object.entries(registry.gear || {}) as [string, { slot: string; tint?: string }][]) {
      if (g.slot !== 'neck' && g.slot !== 'cape') continue
      expect(g.tint, `${id} needs a tint`).toBeTruthy()
      expect(/^#[0-9a-fA-F]{6}$/.test(g.tint!), `${id} tint '${g.tint}' must be a hex colour, not a CSS var`).toBe(true)
    }
  })

  it('every repo-served monster model exists on disk (no dangling boss paths)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const base = path.resolve(__dirname, '../public', registry.modelBase)
    for (const [id, m] of Object.entries(registry.monsters || {}) as [string, { model: string }][]) {
      if (/^(https?:)?\/\//.test(m.model) || m.model.startsWith('/')) continue // remote (Tripo/R2)
      expect(fs.existsSync(path.join(base, m.model)), `${id} model ${m.model} missing from public/`).toBe(true)
    }
  })

  it('fully-enclosing head gear hides the head (snug fit relies on it)', () => {
    for (const [id, g] of Object.entries(registry.gear || {}) as [string, { slot: string; hideHead?: boolean }][]) {
      if (g.slot === 'head' && /full_helm/.test(id)) expect(g.hideHead, `${id} must set hideHead`).toBe(true)
    }
  })

  it('covering plate gear hides the body region beneath it (snug bake relies on it)', () => {
    for (const [id, g] of Object.entries(registry.gear || {}) as [string, { slot: string; hideBody?: boolean; hideLegs?: boolean }][]) {
      if (g.slot === 'body' && /platebody/.test(id)) expect(g.hideBody, `${id} must set hideBody`).toBe(true)
      if (g.slot === 'legs' && /platelegs/.test(id)) expect(g.hideLegs, `${id} must set hideLegs`).toBe(true)
    }
  })

  it('returns null for unregistered gear (icon-UI fallback)', () => {
    expect(getGearModel('horned_full_helm')).toBeNull()
    expect(getGearModel(undefined)).toBeNull()
    expect(getGearPlacement('horned_full_helm')).toBeNull()
  })

  it('resolves the generic default head model from defaults.gear.head.fallbackModel', () => {
    const d = (registry.defaults as { gear: Record<string, { bone?: string; fallbackModel?: string }> }).gear.head
    expect(d.fallbackModel, 'defaults.gear.head.fallbackModel required for unimplemented helmets').toBeTruthy()
    const spec = getDefaultHeadGearModel()
    expect(spec).toBeTruthy()
    expect(spec!.model).toBe(d.fallbackModel)
    expect(spec!.slot).toBe('head')
    expect(spec!.bone).toBe(d.bone)
    expect(spec!.hideHead).toBe(true)
  })

  it('the default head model file exists on disk', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const d = (registry.defaults as { gear: Record<string, { fallbackModel?: string }> }).gear.head
    const base = path.resolve(__dirname, '../public', registry.modelBase)
    expect(fs.existsSync(path.join(base, d.fallbackModel!))).toBe(true)
  })

  it('collects placements for equipped registered gear, skipping the rest', () => {
    const [id] = Object.keys(registry.gear || {})
    if (!id) return
    const slot = (registry.gear as Record<string, { slot: string }>)[id].slot
    const equipment = {
      [slot]: { itemId: id },
      weapon: { itemId: id },        // weapon slot ignored even if id matches
      cape: { itemId: 'no_such_item' },
      legs: null,
    }
    const placements = getGearPlacements(equipment)
    expect(placements).toHaveLength(1)
    expect(placements[0].slot).toBe(slot)
    expect(typeof placements[0].path).toBe('string')
    expect(getGearPlacements(null)).toEqual([])
  })

  it('renders the default helm shell for a full helm, overriding its registered per-tier model', () => {
    const headId = Object.entries(registry.gear || {}).find(([id, g]) => (g as { slot: string }).slot === 'head' && /full_helm/.test(id))?.[0]
    expect(headId, 'a registered full helm is needed to prove the override').toBeTruthy()
    const fallbackModel = (registry.defaults as { gear: Record<string, { fallbackModel: string }> }).gear.head.fallbackModel
    const dflt = getDefaultHeadGearPlacement()
    expect(dflt).toBeTruthy()
    expect(dflt!.path).toBe(registry.modelBase + fallbackModel)
    const placements = getGearPlacements({ head: { itemId: headId } })
    expect(placements).toHaveLength(1)
    expect(placements[0].slot).toBe('head')
    // default shell path (not the registered per-tier model) proves the override
    expect(placements[0].path).toBe(dflt!.path)
    expect(placements[0].path).not.toBe(registry.modelBase + (registry.gear as Record<string, { model: string }>)[headId!].model)
    expect(placements[0].hideHead).toBe(true)
  })

  it('open headwear (no hideHead) renders its own model on top of the head, not the default helm', () => {
    // A wizard hat sits ON the head (head stays visible) — it must resolve to
    // its OWN registry art, unlike a full helm which overrides the head with the
    // shared default shell. Regression: the head branch used to force EVERY head
    // item to the default helm, so a hat rendered as a metal helm.
    const g = getGearModel('wizard_hat')
    expect(g, 'wizard_hat must be a registered head gear entry').toBeTruthy()
    expect(g!.slot).toBe('head')
    expect(g!.hideHead).toBe(false)
    const dflt = getDefaultHeadGearPlacement()
    const placements = getGearPlacements({ head: { itemId: 'wizard_hat' } })
    expect(placements).toHaveLength(1)
    expect(placements[0].path).toBe(registry.modelBase + 'wizard_hat.glb')
    expect(placements[0].path).not.toBe(dflt!.path) // NOT the default helm
    expect(placements[0].hideHead).toBe(false)
    // model-form resolver agrees with the placement-form resolver
    expect(resolveHeadGearModel('wizard_hat')!.model).toBe('wizard_hat.glb')
    expect(resolveHeadGearPlacement('wizard_hat')!.path).toBe(placements[0].path)
  })

  it('a full helm still resolves to the shared default shell (override), not per-tier art', () => {
    const helmId = Object.entries(registry.gear || {}).find(([id, g]) => (g as { slot: string }).slot === 'head' && /full_helm/.test(id))?.[0]
    expect(helmId, 'a registered full helm is needed').toBeTruthy()
    expect(resolveHeadGearModel(helmId)!.model).toBe((registry.defaults as { gear: Record<string, { head: { fallbackModel: string } }> }).gear.head.fallbackModel)
    expect(resolveHeadGearPlacement(helmId)!.hideHead).toBe(true)
  })

  it('boots resolve to a single skinned piece that hides the feet', () => {
    const b = (registry.defaults as { gear: Record<string, unknown> }).gear.boots
    expect(b, 'defaults.gear.boots required for boots placement').toBeTruthy()
    const models = getDefaultBootsModels()
    expect(models).toHaveLength(1)
    // skinned rebind (shares the hero skeleton, deforms with the leg), NOT a
    // rigid bone-attach — so no bone and hideFeet cuts the base footwear.
    expect(models[0].bone).toBeNull()
    expect(models[0].hideFeet).toBe(true)
    const placements = getDefaultBootsPlacements()
    expect(placements).toHaveLength(1)
    expect(placements[0].slot).toBe('boots')
    expect(placements[0].path.startsWith(registry.modelBase)).toBe(true)
    expect(placements[0].hideHead).toBe(false)
    expect(placements[0].hideFeet).toBe(true)
    // any equipped boots item → the shared default skinned boots (like helms → default helm)
    const viaEquip = getGearPlacements({ boots: { itemId: 'leather_boots' } })
    expect(viaEquip).toHaveLength(1)
    expect(viaEquip[0].slot).toBe('boots')
    expect(viaEquip[0].hideFeet).toBe(true)
  })

  it('the default boot model files exist on disk', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const base = path.resolve(__dirname, '../public', registry.modelBase)
    for (const m of getDefaultBootsModels()) {
      expect(fs.existsSync(path.join(base, m.model)), `${m.model} missing from public/`).toBe(true)
    }
  })

  it('every registered gear id exists in items.json with a matching slot', async () => {
    const items = (await import('../src/data/items.json')).default as Record<string, { slot?: string }>
    for (const [id, g] of Object.entries(registry.gear || {}) as [string, { slot: string }][]) {
      expect(items[id], `gear model '${id}' has no matching item`).toBeTruthy()
      expect(items[id].slot, `gear model '${id}' slot mismatch`).toBe(g.slot)
    }
  })

  it('resolves a registered monster to a combat-arena spec', () => {
    const ids = Object.keys(registry.monsters || {})
    if (ids.length === 0) return
    const spec = getMonsterModel(ids[0])
    expect(spec).toBeTruthy()
    expect(typeof spec!.path).toBe('string')
    expect(typeof spec!.height).toBe('number')
    expect(spec!.rotationDeg).toHaveLength(3)
    expect(hasMonsterModel(ids[0])).toBe(true)
  })

  it('returns null for an unregistered monster (classic combat UI)', () => {
    expect(getMonsterModel('goblin')).toBeNull()
    expect(getMonsterModel(undefined)).toBeNull()
    expect(hasMonsterModel('goblin')).toBe(false)
  })

  it('every registered monster id exists in monsters.json (no dangling models)', async () => {
    const monsters = (await import('../src/data/monsters.json')).default as Record<string, unknown>
    for (const id of Object.keys(registry.monsters || {})) {
      expect(monsters[id], `monster model '${id}' has no matching monster`).toBeTruthy()
    }
  })

  it('every registered weapon id exists in items.json (no dangling models)', async () => {
    const items = (await import('../src/data/items.json')).default as Record<string, unknown>
    for (const id of Object.keys(registry.weapons)) {
      expect(items[id], `weapon model '${id}' has no matching item`).toBeTruthy()
    }
  })

  it('every mining pickaxe item has a registered 3D weapon model', async () => {
    const items = (await import('../src/data/items.json')).default as Record<string, { toolFor?: string }>
    for (const [id, item] of Object.entries(items)) {
      if (item.toolFor !== 'mining') continue
      expect(hasWeaponModel(id), `pickaxe '${id}' has no registered weapon model`).toBe(true)
    }
  })

  it('every registered model file exists on disk (no dangling paths)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const base = path.resolve(__dirname, '../public', registry.modelBase)
    const models = [
      registry.character.model,
      ...Object.values(registry.weapons).map((w) => w.model),
      ...Object.values(registry.gear || {}).map((g) => g.model),
    ]
    for (const m of models) {
      if (/^(https?:)?\/\//.test(m) || m.startsWith('/')) continue // remote/absolute — not repo-served
      expect(fs.existsSync(path.join(base, m)), `${registry.modelBase}${m} missing from public/`).toBe(true)
    }
  })

  it('every named character clip (idle/combatIdle/attack/special/hit/death) exists in the hero GLB', async () => {
    const c = registry.character as { idleClip?: string; combatIdleClip?: string; attackClip?: string; specialClip?: string; hitClip?: string; deathClip?: string }
    const clips = [c.idleClip, c.combatIdleClip, c.attackClip, c.specialClip, c.hitClip, c.deathClip].filter(Boolean) as string[]
    if (clips.length === 0) return
    const fs = await import('node:fs')
    const path = await import('node:path')
    const glb = path.resolve(__dirname, '../public', registry.modelBase, registry.character.model)
    // GLB chunk 0 is JSON; animation names live in it as plain strings.
    const buf = fs.readFileSync(glb)
    const jsonLen = buf.readUInt32LE(12)
    const json = buf.subarray(20, 20 + jsonLen).toString('utf8')
    for (const clip of clips) {
      expect(json.includes(`"${clip}"`), `clip '${clip}' not found in ${registry.character.model}`).toBe(true)
    }
  })

  it('every body/legs gear model is skinned to the hero skeleton (deforms with it, not a rigid bone-attach)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const base = path.resolve(__dirname, '../public', registry.modelBase)
    const readGlbJson = (file: string) => {
      const buf = fs.readFileSync(file)
      const jsonLen = buf.readUInt32LE(12)
      return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'))
    }
    // the runtime rebind maps piece skinIndex values onto the hero skeleton's
    // bone array, so every skinned piece must carry the same joint count in
    // the same order as the hero build
    const heroJoints = readGlbJson(path.join(base, registry.character.model)).skins[0].joints.length
    for (const [id, g] of Object.entries(registry.gear || {}) as [string, { model: string; slot: string }][]) {
      if (g.slot !== 'body' && g.slot !== 'legs') continue
      const json = readGlbJson(path.join(base, g.model))
      expect(json.skins?.length, `${id} (${g.model}) has no skin — attachGearList rigid-attaches it to one bone instead of deforming with the body`).toBeGreaterThan(0)
      expect(json.skins[0].joints?.length, `${id} skin joint count must match the hero skeleton`).toBe(heroJoints)
    }
  })

  it('the hero and every weapon/gear model are repo-served Quaternius builds (no Tripo/R2 URLs)', () => {
    const models = [
      registry.character.model,
      ...Object.values(registry.weapons).map((w) => w.model),
      ...Object.values(registry.gear || {}).map((g) => g.model),
    ]
    for (const m of models) {
      expect(/tripo-assets/.test(m), `${m} still points at the Tripo asset store`).toBe(false)
      expect(/^(https?:)?\/\//.test(m), `${m} should be repo-served`).toBe(false)
    }
  })
})
