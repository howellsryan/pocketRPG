import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'
import { analyzeDps } from '../functions/_lib/mcp/dps.js'
import { CHAT_MAX_TOOL_RESULT_CHARS } from '../functions/_lib/chat/prompt.js'
import { getXPForLevel } from '../src/engine/experience.js'

const items = itemsData as Record<string, any>
const monsters = monstersData as Record<string, any>

function saveAt(level: number, bankIds: string[], over: Record<string, any> = {}) {
  const stats: Record<string, any> = {}
  for (const skill of ['attack', 'strength', 'defence', 'ranged', 'magic', 'hitpoints', 'prayer', 'slayer']) {
    stats[skill] = { xp: getXPForLevel(level) }
  }
  const bank: Record<string, any> = {}
  for (const id of bankIds) bank[id] = { quantity: 1000 }
  return {
    stats,
    equipment: { weapon: { itemId: 'bronze_scimitar' } },
    inventory: [],
    bank,
    settings: { combatStance: 'accurate', completedQuests: [] },
    ...over,
  }
}

// A modest, realistic kit rather than "every item in the game", so the owned
// search has something to leave on the table for the upgrade path to find.
const MODEST_KIT = [
  'runeforged_scimitar', 'runeforged_platebody', 'runeforged_platelegs', 'runeforged_full_helm',
  'runeforged_kiteshield', 'runeforged_boots', 'magic_shortbow', 'runeforged_arrow',
]

describe('analyzeDps default answer', () => {
  const out = analyzeDps(saveAt(70, MODEST_KIT))

  it('rates the worn setup and the best owned setup', () => {
    expect(out.current.gear.weapon).toBe('Bronze Scimitar')
    expect(out.current.dps).toBeGreaterThan(0)
    expect(out.bestOwned!.dps).toBeGreaterThan(out.current.dps)
    expect(out.bestOwned!.improvementPercent).toBeGreaterThan(0)
  })

  it('names the swaps to make, not just the finished loadout', () => {
    const weaponSwap = out.bestOwned!.swaps.find((s: any) => s.slot === 'weapon')
    expect(weaponSwap).toBeTruthy()
    expect(weaponSwap.instead).toBe('Bronze Scimitar')
  })

  it('compares every style the kit can field', () => {
    expect(out.byStyle.melee.dps).toBeGreaterThan(0)
    expect(out.byStyle.ranged.dps).toBeGreaterThan(0)
    expect(out.bestOwned!.style).toBe(
      out.byStyle.melee.dps >= out.byStyle.ranged.dps ? 'melee' : 'ranged',
    )
  })

  it('says which prayer the numbers assume', () => {
    expect(out.byStyle.melee.prayer).toBeTruthy()
  })

  it('explains the target it measured against', () => {
    expect(out.target.basis).toMatch(/average of \d+ monsters/)
  })

  it('declares what the model does not cover', () => {
    expect(out.notes.join(' ')).toMatch(/bolt/i)
    expect(out.notes.join(' ')).toMatch(/[Ss]pecial attacks/)
  })

  it('fits the chat tool-result budget, which truncates mid-JSON', () => {
    expect(JSON.stringify(out).length).toBeLessThan(CHAT_MAX_TOOL_RESULT_CHARS)
  })

  it('recommends nothing the character does not own', () => {
    const owned = new Set([...MODEST_KIT, 'bronze_scimitar'])
    for (const style of Object.keys(out.byStyle)) {
      const gear = out.byStyle[style].gear || {}
      for (const name of Object.values(gear) as string[]) {
        const id = Object.entries(items).find(([, it]: any) => it.name === name)?.[0]
        expect(owned.has(id!)).toBe(true)
      }
    }
  })

  it('reads a spell-less staff as the melee swing it actually makes, not as zero', () => {
    const staffId = Object.entries(items).find(([, it]: any) =>
      it.slot === 'weapon' && it.attackStyle === 'magic' && !it.poweredStaff && (it.otherBonus?.meleeStrength || 0) > 0)?.[0]
    if (!staffId) return
    const save = saveAt(70, MODEST_KIT, { equipment: { weapon: { itemId: staffId } } })
    const out = analyzeDps(save)
    expect(out.current.style).toBe('melee')
    expect(out.current.dps).toBeGreaterThan(0)
  })

  it('reports a style it cannot field rather than inventing one', () => {
    const out2 = analyzeDps(saveAt(70, ['runeforged_scimitar']))
    expect(out2.byStyle.magic.available).toBe(false)
    expect(out2.byStyle.magic.reason).toMatch(/magic weapon/i)
  })
})

describe('analyzeDps against a named monster', () => {
  const out = analyzeDps(saveAt(90, MODEST_KIT), { monsterId: 'krylth_the_defiler' })

  it('reports the monster it measured, with its defences', () => {
    expect(out.target.monsterId).toBe('krylth_the_defiler')
    expect(out.target.defenceLevel).toBe(monsters.krylth_the_defiler.stats.defence)
  })

  it('reports time to kill per style', () => {
    expect(out.byStyle.melee.timeToKillSeconds).toBeGreaterThan(0)
  })

  it('reports what the monster hits for and which prayer answers it', () => {
    expect(out.target.threat.maxHit).toBeGreaterThan(0)
    expect(out.target.threat.protectionPrayer).toBe('Protect from Melee')
  })

  it('splits a multi-form boss into its forms rather than reading only the first', () => {
    const multi = Object.entries(monsters).find(([, m]: any) => m.multiForm && Object.keys(m.forms || {}).length > 1)
    const [id] = multi as [string, any]
    const formed = analyzeDps(saveAt(90, MODEST_KIT), { monsterId: id })
    expect(formed.target.forms!.length).toBeGreaterThan(1)
    expect(formed.target.defenceBonus).toBe('varies by form')
  })

  it('times a phased boss against every phase, not just the opening bar', () => {
    const out = analyzeDps(saveAt(99, MODEST_KIT), { monsterId: 'verzik_vitur' })
    expect(out.target.hitpoints).toBeGreaterThan(monsters.verzik_vitur.hitpoints)
  })

  it('counts a double-kill boss twice', () => {
    const out = analyzeDps(saveAt(99, MODEST_KIT), { monsterId: 'the_great_olm' })
    expect(out.target.hitpoints).toBe(monsters.the_great_olm.hitpoints * 2)
  })

  it('warns when a boss is immune to the style for part of the fight', () => {
    const out = analyzeDps(saveAt(99, MODEST_KIT), { monsterId: 'hellbound_gorilla' })
    expect(out.byStyle.melee.immuneFormShare).toBeGreaterThan(0)
    expect(out.byStyle.melee.immuneNote).toMatch(/switch style/i)
  })

  it('refuses an unknown combat style rather than crashing on it', () => {
    expect(() => analyzeDps(saveAt(70, MODEST_KIT), { style: 'ranger' as any })).toThrow(/Unknown combat style/)
  })

  it('refuses an unknown monster instead of guessing one', () => {
    expect(() => analyzeDps(saveAt(70, MODEST_KIT), { monsterId: 'not_a_monster' })).toThrow(/No monster/)
  })

  it('says when slayer-task gear bonuses are in the numbers', () => {
    const save = saveAt(90, MODEST_KIT, {
      settings: { combatStance: 'accurate', completedQuests: [], slayerTask: { monsterId: 'krylth_the_defiler', remaining: 5 } },
    })
    const tasked = analyzeDps(save, { monsterId: 'krylth_the_defiler' })
    expect(tasked.notes[0]).toMatch(/Slayer-task gear bonuses/)
  })
})

describe('analyzeDps extras', () => {
  it('names gear the character does not own, with where it comes from', () => {
    const out = analyzeDps(saveAt(90, MODEST_KIT), { include: ['upgrades'] })
    expect(out.upgrades!.gainOverOwnedPercent).toBeGreaterThan(0)
    expect(out.upgrades!.items.length).toBeGreaterThan(0)
    const owned = new Set(MODEST_KIT)
    for (const item of out.upgrades!.items) expect(owned.has(item.itemId)).toBe(false)
    expect(out.upgrades!.items.some((i: any) => i.sources)).toBe(true)
  })

  it('searches every style for upgrades, so new gear can flip the recommendation', () => {
    const out = analyzeDps(saveAt(90, MODEST_KIT), { include: ['upgrades'] })
    expect(Object.keys(out.upgrades!.dpsByStyle).sort()).toEqual(['magic', 'melee', 'ranged'])
    for (const dps of Object.values(out.upgrades!.dpsByStyle) as number[]) {
      expect(out.upgrades!.dps).toBeGreaterThanOrEqual(dps)
    }
  })

  it('reports what more combat levels are worth', () => {
    const out = analyzeDps(saveAt(80, MODEST_KIT), { include: ['levels'] })
    expect(out.levelGains!.length).toBeGreaterThan(0)
    expect(out.levelGains![0].currentLevel).toBe(80)
    expect(out.levelGains![0].steps.at(-1)!.dpsGainPercent).toBeGreaterThan(0)
  })

  it('projects a target level without being asked for the level breakdown', () => {
    const out = analyzeDps(saveAt(80, MODEST_KIT), { atLevel: 99 })
    expect(out.atLevel!.level).toBe(99)
    expect(out.atLevel!.gainPercent).toBeGreaterThan(0)
    expect(out.levelGains).toBeUndefined()
  })

  it('holds a single style when one is named', () => {
    const out = analyzeDps(saveAt(70, MODEST_KIT), { style: 'ranged' })
    expect(Object.keys(out.byStyle)).toEqual(['ranged'])
  })
})

describe('analyzeDps on a character with nothing', () => {
  it('answers a brand-new character without inventing a setup', () => {
    const out = analyzeDps({ stats: {}, equipment: {}, inventory: [], bank: {}, settings: {} } as any)
    expect(out.bestOwned).toBeNull()
    expect(out.current.dps).toBe(0)
    for (const style of Object.keys(out.byStyle)) expect(out.byStyle[style].available).toBe(false)
  })

  it('survives an empty save object', () => {
    const out = analyzeDps({} as any)
    expect(out.playerLevels.attack).toBe(1)
    expect(out.target.name).toBeTruthy()
  })

  it('rates bare fists as zero rather than as a weapon', () => {
    const out = analyzeDps(saveAt(70, MODEST_KIT, { equipment: {} }))
    expect(out.current.dps).toBe(0)
    // …but the gear in the bank is still found.
    expect(out.bestOwned!.dps).toBeGreaterThan(0)
  })
})

describe('analyzeDps owns its own gates', () => {
  it('will not recommend gear the character has no levels for', () => {
    const out = analyzeDps(saveAt(20, Object.keys(items).filter((id) => items[id].slot)))
    const weaponName = out.byStyle.melee.gear.weapon
    const weaponId = Object.entries(items).find(([, it]: any) => it.name === weaponName)![0]
    const required = items[weaponId].requirements || {}
    for (const level of Object.values(required) as number[]) expect(level).toBeLessThanOrEqual(20)
  })

  it('will not let a prayer boost unlock gear the character cannot equip', () => {
    // Piety-class boosts push a level-90 stat over 99, and those boosted
    // numbers are what the swings are scored with — they must never reach the
    // equip gate.
    const out = analyzeDps(saveAt(90, Object.keys(items).filter((id) => items[id].slot)))
    const stats = { attack: 90, strength: 90, defence: 90, ranged: 90, magic: 90 }
    for (const style of Object.keys(out.byStyle)) {
      for (const name of Object.values(out.byStyle[style].gear || {}) as string[]) {
        const id = Object.entries(items).find(([, it]: any) => it.name === name)![0]
        for (const [skill, level] of Object.entries(items[id].requirements || {}) as [string, number][]) {
          if (skill in stats) expect(level).toBeLessThanOrEqual(90)
        }
      }
    }
  })

  it('will not build a spell setup the character has no runes for', () => {
    const staffId = Object.entries(items).find(([, it]: any) => it.slot === 'weapon' && it.attackStyle === 'magic' && !it.poweredStaff && !(it.requirements?.magic > 40))![0]
    const noRunes = analyzeDps(saveAt(70, [staffId]), { style: 'magic' })
    expect(noRunes.byStyle.magic.available).toBe(false)
  })
})
