import { describe, it, expect } from 'vitest'
import { validateCreatureSpec } from '../src/3d/creatures.js'
import { BLEND_SHELL_MAX_PARTS } from '../src/3d/blendShell.js'
import { heroComposeSpec } from '../src/3d/heroCompose.js'
import { composeHeroSpec3D, hasHeroSpec3D, hasHeroEquip3D, listHeroEquip3DIds, getHeroEquipEntry } from '../src/3d/heroCreature.js'
import hero3d from '../src/data/hero3d.json'
import itemsData from '../src/data/items.json'

const HERO_RIG_TARGETS = new Set(['head', 'armL', 'armR', 'handL', 'handR'])
const allEquipIds = () => Object.keys(hero3d.equipment || {})
// resolved entries: variantOf stubs expanded to their effective add/override
const resolvedEntries = () => allEquipIds().map((id) => [id, getHeroEquipEntry(id)] as const)

describe('hero3d registry', () => {
  it('the bare hero spec passes creature validation', () => {
    expect(hasHeroSpec3D()).toBe(true)
    expect(validateCreatureSpec(composeHeroSpec3D([]))).toEqual([])
  })

  it('every equipment entry names a real item and a slot', () => {
    for (const [id, entry] of Object.entries(hero3d.equipment)) {
      expect(itemsData[id], `hero3d.json equipment ${id} has no item in items.json`).toBeTruthy()
      expect(typeof entry.slot, `hero3d.json equipment ${id} needs a slot`).toBe('string')
    }
  })

  it('every variant entry names an existing non-variant base and resolves', () => {
    for (const [id, entry] of Object.entries(hero3d.equipment)) {
      if (!(entry as { variantOf?: string }).variantOf) continue
      const base = hero3d.equipment[(entry as { variantOf: string }).variantOf]
      expect(base, `equipment ${id} variantOf names a missing base`).toBeTruthy()
      expect((base as { variantOf?: string }).variantOf, `equipment ${id} chains variants`).toBeUndefined()
      expect(getHeroEquipEntry(id), `equipment ${id} must resolve`).toBeTruthy()
      expect(Array.isArray((entry as { palette?: string[] }).palette), `variant ${id} exists to recolor — it needs its own palette`).toBe(true)
    }
  })

  it('every added equipment part targets a known rig group when it declares one', () => {
    for (const [id, entry] of resolvedEntries()) {
      for (const p of entry.add || []) {
        if (p.rig !== undefined) {
          expect(HERO_RIG_TARGETS.has(p.rig), `equipment ${id} part ${p.id} rig ${p.rig}`).toBe(true)
        }
      }
    }
  })

  it('every override targets an existing hero part', () => {
    const heroIds = new Set(hero3d.hero.parts.map((p) => p.id))
    for (const [id, entry] of resolvedEntries()) {
      for (const partId of Object.keys(entry.override || {})) {
        expect(heroIds.has(partId), `equipment ${id} overrides unknown hero part ${partId}`).toBe(true)
      }
    }
  })

  it('the hero composed with each single item passes validation', () => {
    for (const id of allEquipIds()) {
      const spec = composeHeroSpec3D([id])
      expect(validateCreatureSpec(spec), `hero + ${id}`).toEqual([])
    }
  })

  // One item per slot is the wearable reality — stacking every registered
  // item (7 scimitars at once) is not a state the game can produce, so the
  // budget is asserted per full loadout instead.
  it('every full one-item-per-slot loadout validates and fits the shader part budget', () => {
    const bySlot = new Map<string, string[]>()
    for (const [id, entry] of resolvedEntries()) {
      const list = bySlot.get(entry.slot) || []
      list.push(id)
      bySlot.set(entry.slot, list)
    }
    const slots = [...bySlot.keys()]
    // worst case per slot = the entry adding the most parts; if that fits,
    // every other combination fits too
    const worst = slots.map((slot) => {
      const ids = bySlot.get(slot)!
      return ids.reduce((a, b) => ((getHeroEquipEntry(a)!.add || []).length >= (getHeroEquipEntry(b)!.add || []).length ? a : b))
    })
    const spec = composeHeroSpec3D(worst)
    expect(validateCreatureSpec(spec), `loadout ${worst.join(', ')}`).toEqual([])
    expect(spec.parts.length, `loadout ${worst.join(', ')}`).toBeLessThanOrEqual(BLEND_SHELL_MAX_PARTS)
  })

  it('every metal tier composes as a full matching set', () => {
    for (const tier of ['bronze', 'iron', 'steel', 'mithril', 'adamant', 'runeforged', 'dragon']) {
      const set = [`${tier}_scimitar`, `${tier}_full_helm`, `${tier}_platebody`, `${tier}_platelegs`].filter(hasHeroEquip3D)
      expect(set.length, `${tier} set is registered`).toBeGreaterThanOrEqual(3)
      const spec = composeHeroSpec3D(set)
      expect(validateCreatureSpec(spec), `${tier} set`).toEqual([])
      expect(spec.parts.length).toBeLessThanOrEqual(BLEND_SHELL_MAX_PARTS)
    }
  })

  it('a variant recolors its base geometry without reshaping it', () => {
    const bronze = composeHeroSpec3D(['bronze_scimitar'])
    const dragon = composeHeroSpec3D(['dragon_scimitar'])
    const bladeB = bronze.parts.find((p) => p.id === 'scimBlade')
    const bladeD = dragon.parts.find((p) => p.id === 'scimBlade')
    expect(bladeD).toBeTruthy()
    expect(bladeD.a).toEqual(bladeB.a)
    expect(bladeD.r1).toEqual(bladeB.r1)
    expect(bronze.palette[bladeB.color]).toBe('#dfa85c')
    expect(dragon.palette[bladeD.color]).toBe('#c8503f')
  })
})

describe('hero equipment composition', () => {
  it('weapon parts join the right-arm lower chain so they ride the swing', () => {
    const spec = composeHeroSpec3D(['bronze_scimitar'])
    const added = (hero3d.equipment.bronze_scimitar.add || []).map((p) => p.id)
    for (const id of added) {
      expect(spec.arms.right.lower, `weapon part ${id}`).toContain(id)
    }
  })

  it('equipment colors are remapped into the appended palette, never colliding with hero colors', () => {
    const bare = composeHeroSpec3D([])
    const spec = composeHeroSpec3D(['bronze_scimitar'])
    const addedIds = new Set((hero3d.equipment.bronze_scimitar.add || []).map((p) => p.id))
    for (const p of spec.parts) {
      if (addedIds.has(p.id)) expect(p.color).toBeGreaterThanOrEqual(bare.palette.length)
    }
  })

  it('removing a part purges it from every rig group', () => {
    const spec = composeHeroSpec3D(['bronze_full_helm'])
    const removed = Object.entries(hero3d.equipment.bronze_full_helm.override)
      .filter(([, patch]) => patch.remove).map(([id]) => id)
    expect(removed.length).toBeGreaterThan(0)
    const partIds = new Set(spec.parts.map((p) => p.id))
    for (const id of removed) {
      expect(partIds.has(id)).toBe(false)
      if (spec.head) expect(spec.head.parts).not.toContain(id)
    }
  })

  it('unregistered equipped items are skipped without breaking the spec', () => {
    const spec = composeHeroSpec3D(['dragon_dagger', 'not_an_item'])
    expect(validateCreatureSpec(spec)).toEqual([])
    expect(spec.parts.length).toBe(hero3d.hero.parts.length)
  })

  it('composition never mutates the registry data', () => {
    const before = JSON.stringify(hero3d)
    composeHeroSpec3D(allEquipIds())
    expect(JSON.stringify(hero3d)).toBe(before)
  })

  it('hasHeroEquip3D and listHeroEquip3DIds reflect the registry', () => {
    for (const id of listHeroEquip3DIds()) expect(hasHeroEquip3D(id)).toBe(true)
    expect(hasHeroEquip3D('not_an_item')).toBe(false)
  })

  it('heroComposeSpec returns null without an authored hero', () => {
    expect(heroComposeSpec({}, [])).toBeNull()
    expect(heroComposeSpec({ hero: { parts: [] } }, [])).toBeNull()
  })
})

describe('humanoid arms validation', () => {
  const humanoid = () => JSON.parse(JSON.stringify(hero3d.hero))

  it('accepts the humanoid archetype with a two-segment arms rig', () => {
    expect(validateCreatureSpec(humanoid())).toEqual([])
  })

  it('rejects arm segments referencing unknown parts', () => {
    const spec = humanoid()
    spec.arms.right.lower = ['nope']
    expect(validateCreatureSpec(spec).join(' ')).toMatch(/arms\.right.*nope/)
  })

  it('rejects arms without an anchor', () => {
    const spec = humanoid()
    delete spec.arms.left.anchor
    expect(validateCreatureSpec(spec).join(' ')).toMatch(/arms\.left.*anchor/)
  })
})
