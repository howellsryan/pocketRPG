import { describe, expect, it } from 'vitest'
import items from '../src/data/items.json'
import gameIcons from '../src/data/gameIcons.json'
import minigames from '../src/data/minigames.json'
import { getItemIconKey, getItemIconTint } from '../src/utils/itemIcons.js'
import { SKILL_ART } from '../src/utils/skillArt.js'

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

  it('planks resolve to the planks glyph', () => {
    expect(getItemIconKey(itemsData.plank)).toBe('planks')
    expect(getItemIconKey(itemsData.oak_plank)).toBe('planks')
    expect(getItemIconKey(itemsData.teak_plank)).toBe('planks')
    expect(getItemIconKey(itemsData.mahogany_plank)).toBe('planks')
  })

  it('raw_beef and cooked_meat resolve to the meat glyph', () => {
    expect(getItemIconKey(itemsData.raw_beef)).toBe('meat')
    expect(getItemIconKey(itemsData.cooked_meat)).toBe('meat')
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

  it('battlestaff resolves to the staff glyph (not an ore)', () => {
    expect(getItemIconKey(itemsData.battlestaff)).toBe('staff')
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
    // Custom-named herbs (fantasy names without 'herb'/'weed'/'leaf'/'root')
    expect(getItemIconKey(itemsData.sunblossom)).toBe('herb')
    expect(getItemIconKey(itemsData.wyrmspice)).toBe('herb')
    expect(getItemIconKey(itemsData.snapdrake)).toBe('herb')
    expect(getItemIconKey(itemsData.cinderbloom)).toBe('herb')
    expect(getItemIconKey(itemsData.stonefern)).toBe('herb')
    expect(getItemIconKey(itemsData.mistvine)).toBe('herb')
    expect(getItemIconKey(itemsData.marshflax)).toBe('herb')
    expect(getItemIconKey(itemsData.thornspire)).toBe('herb')
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
    // d-hide body keeps the full ninja figure
    expect(getItemIconKey(itemsData.green_d_hide_body)).toBe('ninja_body')
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

  it('magic robe tops (positive magic attackBonus highest) resolve to magic_robe', () => {
    expect(getItemIconKey(itemsData.wizard_robe_top)).toBe('magic_robe')
    expect(getItemIconKey(itemsData.kodai_robe_top)).toBe('magic_robe')
  })

  it('ranged head armour resolves to ninja (mask), body to ninja_body', () => {
    expect(getItemIconKey(itemsData.leather_cowl)).toBe('ninja')
    expect(getItemIconKey(itemsData.zephyra_helmet)).toBe('ninja')
    expect(getItemIconKey(itemsData.leather_body)).toBe('ninja_body')
  })

  it('all chaps resolve to the legs glyph', () => {
    expect(getItemIconKey(itemsData.leather_chaps)).toBe('legs')
    expect(getItemIconKey(itemsData.green_d_hide_chaps)).toBe('legs')
    expect(getItemIconKey(itemsData.studded_chaps)).toBe('legs')
  })

  it('mitres resolve to the mitre glyph', () => {
    expect(getItemIconKey(itemsData.ancient_mitre)).toBe('mitre')
    expect(getItemIconKey(itemsData.zephyra_mitre)).toBe('mitre')
  })

  it('named mage hats/hoods resolve to the pointy_hat glyph', () => {
    expect(getItemIconKey(itemsData.morvyn_s_hood)).toBe('pointy_hat')
    expect(getItemIconKey(itemsData.kodai_hat)).toBe('pointy_hat')
    expect(getItemIconKey(itemsData.wizard_hat)).toBe('pointy_hat')
    expect(getItemIconKey(itemsData.black_wizard_hat)).toBe('pointy_hat')
    expect(getItemIconKey(itemsData.arcanist_hat)).toBe('pointy_hat')
    expect(getItemIconKey(itemsData['2nd_age_mage_hat'])).toBe('pointy_hat')
  })

  it('robe bottoms resolve to the magic_robe_bottom glyph', () => {
    expect(getItemIconKey(itemsData.black_wizard_robe)).toBe('magic_robe_bottom')
    expect(getItemIconKey(itemsData.void_king_robe)).toBe('magic_robe_bottom')
    expect(getItemIconKey(itemsData.kodai_robe_bottom)).toBe('magic_robe_bottom')
    expect(getItemIconKey(itemsData.arcanist_robe_bottom)).toBe('magic_robe_bottom')
    expect(getItemIconKey(itemsData.wizard_robe_skirt)).toBe('magic_robe_bottom')
    expect(getItemIconKey(itemsData.morvyn_s_robeskirt)).toBe('magic_robe_bottom')
  })

  it('the herblore cape resolves to the cape glyph (not a herb)', () => {
    expect(getItemIconKey(itemsData.herblore_cape)).toBe('cape')
  })

  it('ghraxis_rapier resolves to the rapier glyph and cryptbound tint', () => {
    expect(getItemIconKey(itemsData.ghraxis_rapier)).toBe('rapier')
    expect(getItemIconTint(itemsData.ghraxis_rapier)).toBe('var(--tier-cryptbound)')
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

  it('every minigame iconKey resolves to a present glyph', () => {
    const mg = minigames as { tasks: any[]; minigames: any[] }
    const bad: string[] = []
    for (const t of mg.tasks) {
      if (t.iconKey && !gameIconsData[t.iconKey]) bad.push(`task ${t.id} → "${t.iconKey}"`)
    }
    for (const m of mg.minigames) {
      if (m.iconKey && !gameIconsData[m.iconKey]) bad.push(`minigame ${m.id} → "${m.iconKey}"`)
    }
    expect(bad).toEqual([])
  })
})

describe('getItemIconTint — tier colouring', () => {
  const cases: [string, string][] = [
    ['runeforged_platebody', 'var(--tier-runeforged)'],
    ['dragon_scimitar',      'var(--tier-dragon)'],
    ['dragon_full_helm',     'var(--tier-dragon)'],
    ['bronze_dagger',        'var(--tier-bronze)'],
    ['iron_platebody',       'var(--tier-iron)'],
    ['steel_scimitar',       'var(--tier-steel)'],
    ['mithril_kiteshield',   'var(--tier-mithril)'],
    ['adamant_platelegs',    'var(--tier-adamant)'],
    ['adamantite_ore',       'var(--tier-adamant)'],
    ['cryptbound_gloves',    'var(--tier-cryptbound)'],
    ['torvek_s_helm',        'var(--tier-cryptbound)'],
    ['torvek_s_hammers',     'var(--tier-cryptbound)'],
    ['morvyn_s_staff',       'var(--tier-cryptbound)'],
    ['dravok_s_greataxe',    'var(--tier-cryptbound)'],
    ['gorath_s_warspear',    'var(--tier-cryptbound)'],
    ['kaelor_s_crossbow',    'var(--tier-cryptbound)'],
    ['verin_s_flail',        'var(--tier-cryptbound)'],
    ['robin_hood_hat',       'var(--tier-ranger)'],
    ['rangers_tunic',        'var(--tier-ranger)'],
    ['pathfinder_boots',     'var(--tier-ranger)'],
    ['red_d_hide_body',      'var(--tier-dhide-red)'],
    ['green_d_hide_body',    'var(--tier-dhide-green)'],
    ['green_d_hide_chaps',   'var(--tier-dhide-green)'],
    ['black_d_hide_body',    'var(--tier-dhide-black)'],
    ['black_d_hide_chaps',   'var(--tier-dhide-black)'],
    ['fire_cape',            'var(--tier-fire-cape)'],
    ['infernal_cape',        'var(--tier-infernal-cape)'],
    ['red_partyhat',         'var(--tier-partyhat-red)'],
    ['blue_partyhat',        'var(--tier-partyhat-blue)'],
    ['green_partyhat',       'var(--tier-partyhat-green)'],
    ['yellow_partyhat',      'var(--tier-partyhat-yellow)'],
    ['white_partyhat',       'var(--tier-partyhat-white)'],
    ['purple_partyhat',      'var(--tier-partyhat-purple)'],
    ['copper_ore',           'var(--tier-bronze)'],
    ['gold_ore',             'var(--tier-gold)'],
    ['gold_bar',             'var(--tier-gold)'],
    ['2nd_age_platebody',    'var(--tier-2nd-age)'],
    ['2nd_age_bow',          'var(--tier-2nd-age)'],
    ['2nd_age_druidic_staff','var(--tier-2nd-age)'],
    ['shardglass_helmet',    'var(--tier-shardglass)'],
    ['shardglass_bow',       'var(--tier-shardglass)'],
    ['shardglass_shards',    'var(--tier-shardglass)'],
    ['amulet_of_torment',    'var(--tier-jewel-red)'],
    ['necklace_of_agony',    'var(--tier-jewel-green)'],
    ['afflicted_bracelet',   'var(--tier-jewel-blue)'],
    ['zaryth_vambraces',     'var(--tier-jewel-purple)'],
    ['ring_of_affliction',   'var(--tier-cryptbound)'],
    ['berserker_ring',       'var(--tier-jewel-red)'],
    ['archers_ring',         'var(--tier-jewel-green)'],
    ['seers_ring',           'var(--tier-jewel-blue)'],
    ['arcanist_hat',         'var(--tier-jewel-blue)'],
    ['arcanist_robe_top',    'var(--tier-jewel-blue)'],
    ['arcanist_robe_bottom', 'var(--tier-jewel-blue)'],
    ['arcanist_gloves',      'var(--tier-jewel-blue)'],
    ['arcanist_boots',       'var(--tier-jewel-blue)'],
    ['kodai_hat',            'var(--tier-jewel-purple)'],
    ['kodai_robe_top',       'var(--tier-jewel-purple)'],
    ['kodai_robe_bottom',    'var(--tier-jewel-purple)'],
    ['magic_shortbow',       'var(--tier-jewel-blue)'],
    ['magic_shortbow_u',     'var(--tier-jewel-blue)'],
    ['magic_logs',           'var(--tier-jewel-blue)'],
    ['staff_of_water',       'var(--tier-jewel-blue)'],
    ['sanguine_staff',       'var(--tier-jewel-red)'],
    ['staff_of_fire',        'var(--tier-jewel-red)'],
    ['staff_of_earth',       'var(--tier-jewel-green)'],
    ['staff_of_the_dead',    'var(--tier-cryptbound)'],
    ['red_dragon_leather',   'var(--tier-dhide-red)'],
    ['green_dragon_leather', 'var(--tier-dhide-green)'],
    ['black_dragon_leather', 'var(--tier-dhide-black)'],
    ['blue_dragon_leather',  'var(--color-mana-light)'],
    ['green_dragonhide',     'var(--tier-dhide-green)'],
    // Jewellery & uniques batch
    ['amulet_of_fury',       'var(--tier-cryptbound)'],
    ['amulet_of_glory',      'var(--tier-jewel-purple)'],
    ['amulet_of_strength',   'var(--tier-jewel-red)'],
    ['arcane_necklace',      'var(--tier-jewel-blue)'],
    ['occult_necklace',      'var(--tier-jewel-purple)'],
    ['ava_s_assembler',      'var(--tier-jewel-green)'],
    ['ava_s_accumulator',    'var(--tier-jewel-green)'],
    ['colossal_ballista',    'var(--tier-cryptbound)'],
    ['venom_blowpipe',       'var(--tier-jewel-green)'],
    ['trident_of_venom',     'var(--tier-jewel-purple)'],
    ['serpentine_helm',      'var(--tier-jewel-green)'],
    ['arcane_kiteshield',    'var(--tier-orange)'],
    ['eagle_eyed_kiteshield','var(--tier-jewel-green)'],
    ['twisted_longbow',      'var(--tier-cryptbound)'],
    ['gargoyle_maul',        'var(--tier-cryptbound)'],
    ['spiked_manacles',      'var(--tier-cryptbound)'],
    ['ancient_maul',         'var(--tier-jewel-purple)'],
    ['visage_shield',        'var(--tier-cryptbound)'],
    ['evermore_boots',       'var(--tier-jewel-blue)'],
    ['primeval_boots',       'var(--tier-jewel-red)'],
    ['skyfury_boots',        'var(--tier-jewel-green)'],
    ['nightfang_bow',        'var(--tier-cryptbound)'],
    ['warped_buckler',       'var(--tier-jewel-purple)'],
    ['durn_s_bulwark',       'var(--tier-jewel-purple)'],
    ['imbued_god_cape',      'var(--tier-cryptbound)'],
    ['black_wizard_hat',     'var(--tier-cryptbound)'],
    ['black_wizard_robe',    'var(--tier-cryptbound)'],
    ['ferocious_gloves',     'var(--tier-cryptbound)'],
    ['gloves_of_slaughter',  'var(--tier-cryptbound)'],
    ['slayer_defender',      'var(--tier-cryptbound)'],
    ['avernal_defender',     'var(--tier-cryptbound)'],
    ['slayer_helmet',        'var(--tier-cryptbound)'],
    ['scythe_of_vythar',     'var(--tier-cryptbound)'],
    ['nether_demon_whip',    'var(--tier-cryptbound)'],
    ['abyssal_tentacle',     'var(--tier-cryptbound)'],
    ['ancestral_wand',       'var(--tier-jewel-blue)'],
    // God sets by prefix
    ['ancient_stole',        'var(--tier-jewel-purple)'],
    ['lumira_godsword',      'var(--tier-jewel-blue)'],
    ['grondar_chestplate',   'var(--tier-bronze)'],
    ['krylth_spear',         'var(--tier-jewel-red)'],
    ['verdant_d_hide_body',  'var(--tier-jewel-green)'],
    ['ancient_mitre',        'var(--tier-jewel-purple)'],
    // Potions
    ['attack_potion',        'var(--potion-attack)'],
    ['strength_potion',      'var(--potion-strength)'],
    ['combat_potion',        'var(--potion-combat)'],
    ['prayer_potion',        'var(--potion-prayer)'],
    ['super_attack',         'var(--potion-super-attack)'],
    ['super_strength',       'var(--potion-super-strength)'],
    ['super_defence',        'var(--potion-super-defence)'],
    ['super_restore',        'var(--potion-super-restore)'],
    ['ranging_potion',       'var(--potion-ranging)'],
    ['super_combat',         'var(--potion-super-combat)'],
    ['lumira_brew',          'var(--potion-strength)'],
    // Runes — per-element colours
    ['air_rune',             '#ffffff'],
    ['water_rune',           '#3b82f6'],
    ['earth_rune',           '#8b5a2b'],
    ['fire_rune',            '#ef4444'],
    ['chaos_rune',           '#eab308'],
    ['death_rune',           '#f5f5f5'],
    ['blood_rune',           '#b3221d'],
    ['soul_rune',            '#9fd0ff'],
    ['law_rune',             '#2a3f8f'],
    ['cosmic_rune',          '#eab308'],
    ['wrath_rune',           '#ef4444'],
    ['mind_rune',            '#f08a24'],
    ['body_rune',            '#5aa0e0'],
    ['astral_rune',          '#f5f5f5'],
    ['nature_rune',          '#3fae5a'],
  ]

  for (const [id, expected] of cases) {
    it(`${id} resolves to ${expected}`, () => {
      expect(getItemIconTint(itemsData[id])).toBe(expected)
    })
  }

  it('dragon_bones keeps its bone-grey tint (not dragon red)', () => {
    expect(getItemIconTint(itemsData.dragon_bones)).toBe('#a0a0a0')
  })

  it('dragonstone (a gem) is NOT coloured as dragon tier', () => {
    expect(getItemIconTint(itemsData.dragonstone)).not.toBe('var(--tier-dragon)')
  })

  it('returns the parchment fallback for null input', () => {
    expect(getItemIconTint(null)).toBe('var(--color-parchment)')
  })

  it('skill capes inherit their skill accent colour', () => {
    expect(getItemIconTint(itemsData.attack_cape)).toBe(SKILL_ART.attack.accent)
    expect(getItemIconTint(itemsData.magic_cape)).toBe(SKILL_ART.magic.accent)
    expect(getItemIconTint(itemsData.prayer_cape)).toBe(SKILL_ART.prayer.accent)
  })

  it('non-skill capes keep their own tint (not a skill accent)', () => {
    expect(getItemIconTint(itemsData.fire_cape)).toBe('var(--tier-fire-cape)')
    expect(getItemIconTint(itemsData.imbued_god_cape)).toBe('var(--tier-cryptbound)')
  })
})
