import { describe, expect, it } from 'vitest'
import items from '../src/data/items.json'
import gameIcons from '../src/data/gameIcons.json'
import { getItemIconKey } from '../src/utils/itemIcons.js'

const itemsData = items as Record<string, any>
const gameIconsData = gameIcons as Record<string, { body: string; viewBox: string | null }>

describe('itemIcons', () => {
  it('every item resolves to a present glyph', () => {
    const missing: string[] = []
    for (const item of Object.values(itemsData)) {
      const key = getItemIconKey(item)
      if (!gameIconsData[key]) {
        missing.push(`${item.id} → "${key}" (missing in gameIcons.json)`)
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `${missing.length} item(s) resolve to missing glyphs:\n${missing.join('\n')}`
      )
    }
  })

  it('every explicit iconId on an item exists in gameIcons.json', () => {
    const bad: string[] = []
    for (const item of Object.values(itemsData)) {
      if (item.iconId && !gameIconsData[item.iconId]) {
        bad.push(`${item.id} has iconId="${item.iconId}" which is not in gameIcons.json`)
      }
    }
    if (bad.length > 0) {
      throw new Error(bad.join('\n'))
    }
  })

  it('all glyph bodies are non-empty strings starting with SVG content', () => {
    for (const [key, entry] of Object.entries(gameIconsData)) {
      expect(typeof entry.body, `${key}.body should be a string`).toBe('string')
      expect(entry.body.length, `${key}.body should be non-empty`).toBeGreaterThan(0)
      // All game-icons bodies start with a < (SVG element)
      expect(entry.body.trimStart()[0], `${key}.body should start with '<'`).toBe('<')
    }
  })

  it('getItemIconKey returns "default" for null/undefined input', () => {
    expect(getItemIconKey(null)).toBe('default')
    expect(getItemIconKey(undefined)).toBe('default')
  })

  it('coins resolve to the coins glyph', () => {
    expect(getItemIconKey(itemsData.coins)).toBe('coins')
  })

  it('bones resolve to the bones glyph', () => {
    expect(getItemIconKey(itemsData.bones)).toBe('bones')
  })

  it('iron_ore resolves to the ore glyph', () => {
    expect(getItemIconKey(itemsData.iron_ore)).toBe('ore')
  })

  it('logs resolve to the log glyph', () => {
    expect(getItemIconKey(itemsData.logs)).toBe('log')
  })

  it('stab weapons resolve to the dagger glyph', () => {
    const dagger = itemsData.bronze_dagger
    expect(getItemIconKey(dagger)).toBe('dagger')
  })

  it('slash weapons (scimitars) resolve to the sword_spin glyph', () => {
    const scimitar = itemsData.bronze_scimitar
    expect(getItemIconKey(scimitar)).toBe('sword_spin')
  })

  it('crush weapons resolve to the mace glyph', () => {
    const mace = itemsData.bronze_mace
    expect(getItemIconKey(mace)).toBe('mace')
  })

  it('ranged weapons resolve to the bow glyph', () => {
    const bow = itemsData.shortbow
    expect(getItemIconKey(bow)).toBe('bow')
  })

  it('magic weapons resolve to the staff glyph', () => {
    const staff = itemsData.staff
    expect(getItemIconKey(staff)).toBe('staff')
  })

  it('head slot armour resolves to crested_helmet glyph', () => {
    const helm = itemsData.bronze_full_helm
    expect(getItemIconKey(helm)).toBe('crested_helmet')
  })

  it('body slot armour resolves to body glyph', () => {
    const platebody = itemsData.bronze_platebody
    expect(getItemIconKey(platebody)).toBe('body')
  })

  it('dragon_claws resolves to claws glyph', () => {
    expect(getItemIconKey(itemsData.dragon_claws)).toBe('claws')
  })

  it('scythe_of_vythar resolves to scythe glyph', () => {
    expect(getItemIconKey(itemsData.scythe_of_vythar)).toBe('scythe')
  })

  it('fishing_rod resolves to fishing_pole glyph', () => {
    expect(getItemIconKey(itemsData.fishing_rod)).toBe('fishing_pole')
  })

  it('charms and blessings resolve to the prayer glyph', () => {
    expect(getItemIconKey(itemsData.sacred_charm)).toBe('prayer')
    expect(getItemIconKey(itemsData.peace_blessing)).toBe('prayer')
    expect(getItemIconKey(itemsData.elder_charm)).toBe('prayer')
  })

  it('real arrows still resolve to the arrow glyph', () => {
    expect(getItemIconKey(itemsData.bronze_arrow)).toBe('arrow')
  })

  it('herblore resources (herbs, roots, weeds, secondaries) resolve to the herb glyph', () => {
    expect(getItemIconKey(itemsData.greenthorn_leaf)).toBe('herb')
    expect(getItemIconKey(itemsData.kingsherb)).toBe('herb')
    expect(getItemIconKey(itemsData.limpwurt_root)).toBe('herb')
    expect(getItemIconKey(itemsData.rynarr_weed)).toBe('herb')
    expect(getItemIconKey(itemsData.eye_of_newt)).toBe('herb')
  })

  it('herb-seed still resolves to the seed glyph (not herb)', () => {
    expect(getItemIconKey(itemsData.duskroot_seed)).toBe('seed')
  })

  it('skirts (chain/plate/robe/leather) resolve to the legs glyph', () => {
    expect(getItemIconKey(itemsData.zephyra_chainskirt)).toBe('legs')
    expect(getItemIconKey(itemsData.dragon_plateskirt)).toBe('legs')
    expect(getItemIconKey(itemsData.kaelor_s_leatherskirt)).toBe('legs')
    // Mislabelled as type:resource with no slot — still resolves via id pattern
    expect(getItemIconKey(itemsData.mithril_plateskirt)).toBe('legs')
  })

  it('boots and gloves slots resolve to their own glyphs (not body)', () => {
    expect(getItemIconKey(itemsData.leather_boots)).toBe('boots')
    expect(getItemIconKey(itemsData.dragon_boots)).toBe('boots')
    expect(getItemIconKey(itemsData.leather_gloves)).toBe('gloves')
  })

  it('dragonhide armour resolves by ranged bonus, raw hide by material', () => {
    // d-hide chaps are legs with ranged attackBonus → full ninja figure
    expect(getItemIconKey(itemsData.green_d_hide_chaps)).toBe('ninja_body')
    // boots slot is not subject to magic/ranged override
    expect(getItemIconKey(itemsData.lumira_d_hide_boots)).toBe('boots')
    // raw materials use id pattern
    expect(getItemIconKey(itemsData.cowhide)).toBe('animal_hide')
    expect(getItemIconKey(itemsData.green_dragon_leather)).toBe('animal_hide')
  })

  it('sanguine_staff resolves to wand glyph', () => {
    expect(getItemIconKey(itemsData.sanguine_staff)).toBe('wand')
  })

  it("durn_s_bulwark resolves to shield glyph despite crush attackStyle", () => {
    expect(getItemIconKey(itemsData.durn_s_bulwark)).toBe('shield')
  })

  it('magic armour (positive magic attackBonus highest) resolves to magic_robe', () => {
    expect(getItemIconKey(itemsData.wizard_hat)).toBe('magic_robe')
    expect(getItemIconKey(itemsData.wizard_robe_top)).toBe('magic_robe')
    expect(getItemIconKey(itemsData.kodai_robe_top)).toBe('magic_robe')
  })

  it('ranged head armour resolves to ninja (mask), body/legs to ninja_body', () => {
    expect(getItemIconKey(itemsData.leather_cowl)).toBe('ninja')
    expect(getItemIconKey(itemsData.zephyra_helmet)).toBe('ninja')
    expect(getItemIconKey(itemsData.leather_body)).toBe('ninja_body')
    expect(getItemIconKey(itemsData.leather_chaps)).toBe('ninja_body')
  })

  it('halo resolves to angel_outfit glyph', () => {
    expect(getItemIconKey(itemsData.halo)).toBe('angel_outfit')
  })

  it('Ava items resolve to quiver glyph', () => {
    expect(getItemIconKey(itemsData.ava_s_accumulator)).toBe('quiver')
    expect(getItemIconKey(itemsData.ava_s_assembler)).toBe('quiver')
  })

  it('party hats resolve to party_hat glyph', () => {
    expect(getItemIconKey(itemsData.red_partyhat)).toBe('party_hat')
    expect(getItemIconKey(itemsData.blue_partyhat)).toBe('party_hat')
  })

  it('mauls resolve to maul glyph (3d-hammer)', () => {
    expect(getItemIconKey(itemsData.ancient_maul)).toBe('maul')
    expect(getItemIconKey(itemsData.gargoyle_maul)).toBe('maul')
  })

  it('warhammers resolve to warhammer glyph', () => {
    expect(getItemIconKey(itemsData.dragon_warhammer)).toBe('warhammer')
  })

  it('scimitars resolve to sword_spin glyph', () => {
    expect(getItemIconKey(itemsData.dragon_scimitar)).toBe('sword_spin')
    expect(getItemIconKey(itemsData.mithril_scimitar)).toBe('sword_spin')
  })
})
