import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'
import { analyzeDps, itemAcquisition } from '../functions/_lib/mcp/dps.js'
import { isCollectionLogLineageItem } from '../functions/_lib/collectionLog.js'
import { CHAT_MAX_TOOL_RESULT_CHARS } from '../functions/_lib/chat/prompt.js'
import { getXPForLevel } from '../src/engine/experience.js'
import { ALL_SKILLS } from '../src/utils/constants.js'

const items = itemsData as Record<string, any>
const monsters = monstersData as Record<string, any>

function allSkillsAt(level: number) {
  const stats: Record<string, any> = {}
  for (const skill of ALL_SKILLS) stats[skill] = { xp: getXPForLevel(level) }
  return stats
}

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
    // The widest realistic answer: a funded account (so the shopping list is
    // present) against a boss, with both opt-in extras asked for.
    const widest = analyzeDps(saveAt(90, MODEST_KIT, { coins: 100_000_000 }), {
      monsterId: 'krylth_the_defiler', include: ['upgrades', 'levels'], atLevel: 99,
    })
    expect(widest.bestBuyable).toBeTruthy()
    expect(JSON.stringify(widest).length).toBeLessThan(CHAT_MAX_TOOL_RESULT_CHARS)
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

describe('itemAcquisition respects the account type', () => {
  const item = (id: string) => ({ ...items[id], id })

  it('sells General Store stock through the shop to anyone', () => {
    expect(itemAcquisition(item('bronze_arrow'), {})).toMatchObject({ acquirable: true, via: 'shop' })
    expect(itemAcquisition(item('bronze_arrow'), { isIronman: true })).toMatchObject({ acquirable: true, via: 'shop' })
  })

  it('routes ordinary tradeables to the trading post', () => {
    expect(itemAcquisition(item('steel_arrow'), {})).toMatchObject({ acquirable: true, via: 'trading_post' })
  })

  it('offers a boss unique on the trading post even though the shop refuses it', () => {
    const unique = Object.keys(items).find((id) => items[id].isBossUnique && items[id].slot && !isCollectionLogLineageItem(id))
      || Object.keys(items).find((id) => items[id].isBossUnique && items[id].slot)!
    expect(itemAcquisition(item(unique), {}).via).toBe('trading_post')
  })

  it('shuts an Ironman out of everything but the shop', () => {
    expect(itemAcquisition(item('steel_arrow'), { isIronman: true }).acquirable).toBe(false)
  })

  it('refuses a Grindman a collection-log unique and anything built from one', () => {
    const lineage = Object.keys(items).find((id) => items[id].slot && isCollectionLogLineageItem(id)
      && itemAcquisition(item(id), {}).acquirable)!
    expect(lineage).toBeTruthy()
    expect(itemAcquisition(item(lineage), { isGrindman: true }).acquirable).toBe(false)
  })

  it('still sells a Grindman an ordinary tradeable', () => {
    expect(itemAcquisition(item('steel_arrow'), { isGrindman: true })).toMatchObject({ acquirable: true, via: 'trading_post' })
  })

  it('holds the Max Cape behind being maxed, which is not an equip requirement', () => {
    const maxCape = Object.keys(items).find((id) => items[id].isMaxCape)!
    expect(itemAcquisition(item(maxCape), {}).acquirable).toBe(false)
    expect(itemAcquisition(item(maxCape), { isMaxed: true }).acquirable).toBe(true)
  })
})

describe('analyzeDps buys what the account is allowed to buy', () => {
  // The reported bug: a bow in the bank and nothing to fire from it. Arrows
  // need no Fletching to USE — they are a few gp on the trading post — but the
  // answer only ever looked in the player's own bank.
  it('buys ammo for a bow the character already owns', () => {
    const save = saveAt(60, ['magic_shortbow'], { coins: 100000 })
    const out = analyzeDps(save, { style: 'ranged' })
    expect(out.byStyle.ranged.available).toBe(false)
    expect(out.bestBuyable!.gear.weapon).toBe('Magic Shortbow')
    const ammo = out.bestBuyable!.buy.find((b: any) => b.slot === 'ammo')
    expect(ammo).toBeTruthy()
    expect(ammo.via).toBe('Trading Post')
    expect(ammo.roughCost).toBeGreaterThan(0)
  })

  it('reports the account type and whether the trading post is open', () => {
    expect(analyzeDps(saveAt(70, MODEST_KIT)).account).toMatchObject({ mode: 'standard', canUseTradingPost: true })
    const iron = analyzeDps(saveAt(70, MODEST_KIT, { player: { is_ironman: true } })).account
    expect(iron).toMatchObject({ mode: 'ironman', canUseTradingPost: false })
    expect(iron.note).toMatch(/no trading post/i)
    expect(analyzeDps(saveAt(70, MODEST_KIT, { player: { is_grindman: true } })).account.mode).toBe('grindman')
  })

  it('never suggests the trading post to an Ironman', () => {
    const out = analyzeDps(saveAt(70, MODEST_KIT, { coins: 100_000_000, player: { is_ironman: true } }))
    for (const buy of out.bestBuyable?.buy || []) expect(buy.via).toBe('General Store')
  })

  it('never puts a collection-log unique on a Grindman shopping list', () => {
    const out = analyzeDps(saveAt(70, MODEST_KIT, { coins: 100_000_000, player: { is_grindman: true } }))
    for (const buy of out.bestBuyable?.buy || []) expect(isCollectionLogLineageItem(buy.itemId)).toBe(false)
  })

  it('only offers gear the character can pay for', () => {
    const poor = analyzeDps(saveAt(70, MODEST_KIT, { coins: 500 }))
    for (const buy of poor.bestBuyable?.buy || []) expect(buy.roughCost).toBeLessThanOrEqual(500)
    const rich = analyzeDps(saveAt(70, MODEST_KIT, { coins: 100_000_000 }))
    expect(rich.bestBuyable!.dps).toBeGreaterThan(poor.bestBuyable?.dps ?? 0)
  })

  it('flags when the whole shopping list costs more than they hold', () => {
    const out = analyzeDps(saveAt(70, MODEST_KIT, { coins: 20000 }))
    if (out.bestBuyable && out.bestBuyable.roughTotalCost > out.bestBuyable.coins) {
      expect(out.bestBuyable.affordAllPieces).toBe(false)
    }
  })

  it('takes the account type from the server, not the save, when both are given', () => {
    const save = saveAt(70, MODEST_KIT, { coins: 100_000_000, player: { is_ironman: false } })
    const out = analyzeDps(save, { accountModes: { isIronman: true, isOneLife: false, isGrindman: false } })
    expect(out.account.mode).toBe('ironman')
    for (const buy of out.bestBuyable?.buy || []) expect(buy.via).toBe('General Store')
  })

  it('kits out a character who owns nothing but has coins', () => {
    const out = analyzeDps({
      stats: {}, equipment: {}, inventory: [], bank: {}, coins: 50000, settings: {}, player: {},
    } as any)
    expect(out.bestOwned).toBeNull()
    expect(out.bestBuyable!.buy.length).toBeGreaterThan(0)
    expect(out.bestBuyable!.gainOverOwnedPercent).toBeNull()
  })

  it('leaves bestBuyable off when buying changes nothing', () => {
    const out = analyzeDps(saveAt(70, MODEST_KIT, { coins: 0 }))
    expect(out.bestBuyable).toBeUndefined()
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

describe('gear gated on a non-combat skill', () => {
  // Reported: the Arcane Necklace was rated worse than an Amulet of Fury at
  // Grondar. It was never in the search at all — it needs Dungeoneering 65, and
  // the level map handed to the equip gate held only combat skills, so every
  // non-combat requirement read as level 1. Dungeoneering, Slayer, Woodcutting,
  // Mining, Fishing and Agility all gate real combat gear.
  const NON_COMBAT_GATED = Object.entries(items).filter(([, it]: any) =>
    it.slot && Object.keys(it.requirements || {}).some((skill) =>
      !['attack', 'strength', 'defence', 'ranged', 'magic', 'hitpoints', 'prayer'].includes(skill)))

  it('exists in the item data, so this is worth guarding', () => {
    expect(NON_COMBAT_GATED.length).toBeGreaterThan(10)
    expect(items.arcane_necklace.requirements.dungeoneering).toBe(65)
  })

  it('is offered to a character who has the levels', () => {
    const maxed = allSkillsAt(99)
    const out = analyzeDps({
      stats: maxed, coins: 0, equipment: {}, inventory: [],
      bank: Object.fromEntries(NON_COMBAT_GATED.map(([id]) => [id, { quantity: 1 }])),
      settings: { completedQuests: [] }, player: {},
    } as any)
    // With every gated item in the bank and every skill at 99, at least one of
    // them has to reach a loadout — before the fix none of them could.
    const worn = Object.values(out.byStyle).flatMap((s: any) => Object.values(s.gear || {}))
    expect(worn.length).toBeGreaterThan(0)
  })

  it('picks the Arcane Necklace over an Amulet of Fury for magic at Grondar', () => {
    // Grondar carries 0 magic defence bonus, so magic is the style there, and
    // the necklace's +40 magic attack and +15% magic damage decide the slot.
    expect(monsters.warlord_grondar.defenceBonus.magic).toBe(0)
    const save = {
      stats: allSkillsAt(99), coins: 0, equipment: {}, inventory: [],
      bank: { arcane_necklace: { quantity: 1 }, amulet_of_fury: { quantity: 1 }, shadow_of_tumaken: { quantity: 1 } },
      settings: { completedQuests: [] }, player: {},
    }
    const out = analyzeDps(save as any, { style: 'magic', monsterId: 'warlord_grondar' })
    expect(out.byStyle.magic.gear.neck).toBe('Arcane Necklace')
  })

  it('still refuses it to a character without the Dungeoneering level', () => {
    const stats = allSkillsAt(99)
    stats.dungeoneering = { xp: 0 }
    const save = {
      stats, coins: 0, equipment: {}, inventory: [],
      bank: { arcane_necklace: { quantity: 1 }, amulet_of_fury: { quantity: 1 }, shadow_of_tumaken: { quantity: 1 } },
      settings: { completedQuests: [] }, player: {},
    }
    const out = analyzeDps(save as any, { style: 'magic', monsterId: 'warlord_grondar' })
    expect(out.byStyle.magic.gear.neck).toBe('Amulet of Fury')
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
