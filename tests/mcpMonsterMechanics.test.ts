// MCP must be able to explain *how* to fight a boss and where a crafted item
// comes from — not just echo the stat block. Without these, an assistant tells
// a player to bring a whip to a spear-gated boss.
import { describe, expect, it } from 'vitest'
import { monsterMechanics, itemSources } from '../functions/_lib/mcp/reference.js'
import monsters from '../src/data/monsters.json'

const monstersData = monsters as Record<string, any>

describe('monsterMechanics', () => {
  const mechanics = monsterMechanics(monstersData.corporeal_horror)

  it('explains the spear resistance in terms a client can act on', () => {
    const text = mechanics!.notes.join(' ')
    expect(text).toMatch(/50% of all damage/)
    expect(text).toMatch(/spear/)
    expect(text).toMatch(/weaponClass/)
  })

  it('lists the credit cost of skipping and the quest gate', () => {
    const text = mechanics!.notes.join(' ')
    expect(text).toMatch(/5 credits/)
    expect(text).toMatch(/the_heart_of_shadows/)
  })

  it('describes every form, its weakness and the Dread Core prayer burn', () => {
    const forms = mechanics!.forms!
    expect(forms.map((f: any) => f.id)).toEqual(['horror', 'dread_core'])
    const core = forms.find((f: any) => f.id === 'dread_core')!
    expect(core.prayerDrainPerHit).toBe(8)
    expect(core.weakness).toBe('stab')
    expect(core.maxHit).toBe(25)
    expect(mechanics!.notes.join(' ')).toMatch(/burns 8 prayer points/)
  })

  it('returns null for a monster with no special rules', () => {
    expect(monsterMechanics({ id: 'plain', name: 'Plain' })).toBeNull()
    expect(monsterMechanics(null)).toBeNull()
  })

  it('reports a slayer gate when one exists', () => {
    const cerberus = monsterMechanics(monstersData.threefang_cerberus)
    expect(cerberus!.notes.join(' ')).toMatch(/Slayer level 91/)
  })
})

describe('itemSources — combine recipes', () => {
  it('tells a client which two items make a crafted shield', () => {
    const sources = itemSources('aegis_wraithbone_shield')
    expect(sources!.combines).toBeDefined()
    const recipe = sources!.combines[0]
    expect(recipe.ingredients.map((i: any) => i.id).sort()).toEqual(['aegis_sigil', 'hallowed_wraithbone_shield'])
    expect(recipe.result.id).toBe('aegis_wraithbone_shield')
    expect(recipe.result.name).toBe('Aegis Wraithbone Shield')
  })

  it('tells a client what a dropped sigil turns into', () => {
    const sources = itemSources('aegis_sigil')
    expect(sources!.monsters.some((m: any) => m.id === 'corporeal_horror')).toBe(true)
    expect(sources!.combinesInto[0].result.id).toBe('aegis_wraithbone_shield')
  })

  it('covers pre-existing combine chains too, not just the new shields', () => {
    const staff = itemSources('umbral_duskmare_staff')
    expect(staff!.combines[0].ingredients.map((i: any) => i.id).sort()).toEqual(['duskmare_staff', 'umbral_orb'])
  })
})
