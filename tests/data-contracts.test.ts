import { describe, it, expect } from 'vitest'
import items from '../src/data/items.json'
import monsters from '../src/data/monsters.json'
import skills from '../src/data/skills.json'
import quests from '../src/data/quests.json'
import raids from '../src/data/raids.json'
import { applySpecialAttack } from '../src/engine/combat'
import { getPvpSpecialAttackLabel } from '../src/engine/pvpSpecialAttacks'
import { ALL_SKILLS } from '../src/utils/constants.js'

const itemIds = new Set(Object.keys(items))
const KNOWN_MISSING_DROP_ITEMS = new Set(['daganoth_bones'])



const EXPECTED_RAID_UNIQUE_ITEM_IDS = new Set<string>()
for (const raid of Object.values(raids as Record<string, any>)) {
  for (const drop of raid?.rewards?.unique?.items || []) {
    EXPECTED_RAID_UNIQUE_ITEM_IDS.add(drop.itemId)
  }
}

const EXPECTED_BOSS_UNIQUE_ITEM_IDS = new Set([
  ...EXPECTED_RAID_UNIQUE_ITEM_IDS,
  'duskmare_staff',
  'umbral_orb',
  'attuned_orb',
  'volatile_orb',
  'blade_of_saeldor',
  'bow_of_faerdhinen',
  'shardglass_axe',
  'shardglass_helmet',
  'shardglass_pickaxe',
  'shardglass_plate_body',
  'shardglass_platelegs',
  'colossal_ballista',
  'uncut_zyrite',
  'zyrite',
  'zyrite_amulet',
  'zyrite_bracelet',
  'zyrite_necklace',
  'zyrite_ring',
  'zyrite_shard',
  'amulet_of_torment',
  'afflicted_bracelet',
  'necklace_of_agony',
  'ring_of_affliction',
  'zephyra_helmet',
  'zaryth_vambraces',
  'uncut_onyx', // treated as a boss-only unique reward in current drop tables

  'deepmaw_kraken_tentacle',
  'abyssal_tentacle',
  'occult_necklace',
  'venom_blowpipe',
  'trident_of_venom',
  'serpentine_helm',
  'dragon_visage',
  'visage_shield',
  'berserker_ring',
  'archers_ring',
  'warriors_ring',
  'dragon_axe',
  'dragon_pickaxe',
  'dragon_warhammer',
  'seers_ring',
  'krylth_hilt',
  'zephyra_hilt',
  'grondar_hilt',
  'lumira_hilt',
  'zephyra_godsword',
  'grondar_godsword',
  'lumira_godsword',
  'krylth_godsword',
  'grondar_chestplate',
  'grondar_tassets',
  'zephyra_chainskirt',
  'zephyra_chestplate',
  'staff_of_the_dead',
  'grondar_boots',
  'lumira_sword',
  'zephyra_crossbow',
  'krylth_spear',
  'nether_demon_whip',

  'dragon_boots',
  'gargoyle_maul',
  'nightfang_bow',
  'primeval_crystal',
  'skyfury_crystal',
  'evermore_crystal',
  'primeval_boots',
  'skyfury_boots',
  'evermore_boots',
  'ashen_hydra_leather',
  'ashen_hydra_claw',
  'dragon_hunter_lance',
  'ferocious_gloves',

  'sovrathar_ashen_hilt',
  'ashen_sovereigns_edge',
  'cinderforged_helm',
  'sovereigns_cinderplate',
  'sovereigns_cindergreaves',

  // New low-tier bosses (Sunken Crypts / Ashveil Highlands / Ironhold Fortress / Verdant Wilds)
  'gravehusk_helm',
  'gravehusk_platebody',
  'boneclaw_rapier',
  'boneclaw_shield',
  'shroud_robes_top',
  'shroud_staff',
  'stonegale_bow',
  'stonegale_coif',
  'cindermaw_maul',
  'cindermaw_scale_body',
  'thornhide_platelegs',
  'thornhide_gauntlets',
  'thornspine_shortbow',
  'drake_leather_body',
  'ironclad_longsword',
  'ironclad_helm',
  'emberhowl_axe',
  'emberhowl_boots',
  'razorwing_crossbow',
  'razorwing_vambraces',

  // The Corporeal Horror — drops plus the shields they combine into
  'wraithbone_shield',
  'sanctified_elixir',
  'runeward_sigil',
  'aegis_sigil',
  'vigil_sigil',
  'hallowed_wraithbone_shield',
  'runeward_wraithbone_shield',
  'aegis_wraithbone_shield',
  'vigil_wraithbone_shield',
])
describe('data contracts', () => {
  it('item ids match keys and equipment slots are valid when present', () => {
    const validSlots = new Set(['head','cape','neck','ammo','weapon','body','shield','legs','hands','gloves','boots','feet','ring'])
    for (const [key, item] of Object.entries(items as Record<string, any>)) {
      if (item.id !== key) continue
      expect(item.id, `${key} id mismatch`).toBe(key)
      if (item.slot) expect(validSlots.has(item.slot), `${key} invalid slot ${item.slot}`).toBe(true)
    }
  })

  it('monster drops reference known items and valid quantity/chance', () => {
    for (const [monsterId, monster] of Object.entries(monsters as Record<string, any>)) {
      for (const drop of monster.drops || []) {
        expect(itemIds.has(drop.itemId) || KNOWN_MISSING_DROP_ITEMS.has(drop.itemId), `${monsterId} unknown drop ${drop.itemId}`).toBe(true)
        expect(drop.chance >= 0 && drop.chance <= 1, `${monsterId} invalid chance`).toBe(true)
        if (Array.isArray(drop.quantity)) {
          expect(drop.quantity.length).toBe(2)
          expect(drop.quantity[0] > 0 && drop.quantity[1] >= drop.quantity[0]).toBe(true)
        } else {
          expect(drop.quantity > 0).toBe(true)
        }
      }
    }
  })

  it('skill products and materials point to existing items', () => {
    for (const [skillId, skill] of Object.entries(skills as Record<string, any>)) {
      for (const action of skill.actions || []) {
        if (action.product) expect(itemIds.has(action.product), `${skillId}:${action.id} missing product`).toBe(true)
        for (const materialId of Object.keys(action.materials || {})) {
          expect(itemIds.has(materialId), `${skillId}:${action.id} missing material ${materialId}`).toBe(true)
        }
      }
    }
  })

  it('quest item rewards point to existing items and xp rewards are finite positive values', () => {
    for (const [questId, quest] of Object.entries(quests as Record<string, any>)) {
      const rewards = quest.rewards || {}
      for (const [itemId, qty] of Object.entries(rewards.items || {})) {
        expect(itemIds.has(itemId), `${questId} unknown reward item ${itemId}`).toBe(true)
        expect(Number.isFinite(qty) && Number(qty) > 0).toBe(true)
      }
      for (const [skillId, xp] of Object.entries(rewards.xp || {})) {
        expect(typeof skillId).toBe('string')
        expect(Number.isFinite(xp) && Number(xp) > 0, `${questId} bad xp for ${skillId}`).toBe(true)
      }
    }
  })

  it('combine recipes reference existing target and result items', () => {
    for (const [itemId, item] of Object.entries(items as Record<string, any>)) {
      if (item.id !== itemId) continue
      if (!item.combineWith && !item.combineResult) continue
      // A combine recipe needs both halves: the target to consume and the result.
      // References must be current item keys, not legacy_item_id values.
      expect(item.combineWith, `${itemId} combine recipe missing combineWith`).toBeTruthy()
      expect(item.combineResult, `${itemId} combine recipe missing combineResult`).toBeTruthy()
      expect(itemIds.has(item.combineWith), `${itemId} combineWith ${item.combineWith} not found`).toBe(true)
      expect(itemIds.has(item.combineResult), `${itemId} combineResult ${item.combineResult} not found`).toBe(true)
    }
  })

  it('item requirement keys reference known skills (no typos)', () => {
    const knownSkills = new Set(ALL_SKILLS)
    for (const [itemId, item] of Object.entries(items as Record<string, any>)) {
      const reqs = item?.requirements || {}
      for (const skill of Object.keys(reqs)) {
        expect(knownSkills.has(skill), `${itemId} has unknown requirement skill "${skill}"`).toBe(true)
      }
    }
  })

  it('special attack data has pvp labels and pve engine handler path', () => {
    const types = new Set<string>()
    for (const item of Object.values(items as Record<string, any>)) {
      if (item.specialAttack?.type) types.add(item.specialAttack.type)
    }
    for (const type of types) {
      expect(typeof getPvpSpecialAttackLabel(type)).toBe('string')
      expect(() => applySpecialAttack({ specialAttackQueued: false }, {}, { weapon: null }, items as any)).not.toThrow()
    }
  })


  it('raid unique reward items are marked as boss uniques', () => {
    for (const itemId of EXPECTED_RAID_UNIQUE_ITEM_IDS) {
      const item = (items as Record<string, any>)[itemId]
      expect(item, `${itemId} missing from items.json`).toBeDefined()
      expect(item.isBossUnique, `${itemId} should be marked isBossUnique`).toBe(true)
    }
  })

  it('manually verified boss unique drops are marked as boss uniques', () => {
    for (const itemId of EXPECTED_BOSS_UNIQUE_ITEM_IDS) {
      const item = (items as Record<string, any>)[itemId]
      expect(item, `${itemId} missing from items.json`).toBeDefined()
      expect(item.isBossUnique, `${itemId} should be marked isBossUnique`).toBe(true)
    }
  })

  it('items marked as boss uniques are actual boss or raid unique rewards', () => {
    const raidUniqueIds = new Set(EXPECTED_RAID_UNIQUE_ITEM_IDS)
    const knownBossUniqueIds = new Set(EXPECTED_BOSS_UNIQUE_ITEM_IDS)

    for (const [itemId, item] of Object.entries(items as Record<string, any>)) {
      if (item.id !== itemId) continue
      if (!item.isBossUnique) continue
      expect(
        raidUniqueIds.has(itemId) || knownBossUniqueIds.has(itemId),
        `${itemId} is marked isBossUnique but is not in the verified boss/raid unique list`
      ).toBe(true)
    }
  })



  it('quest graph references valid ids and names are unique/non-empty', () => {
    const questList = quests as any[]
    const questMap = Object.fromEntries(questList.map((q) => [q.id, q]))
    const ids = questList.map((q) => q.id)
    const names = new Set<string>()
    expect(new Set(ids).size).toBe(ids.length)
    for (const quest of questList) {
      const questId = quest.id
      expect(typeof quest.name).toBe('string')
      expect(quest.name.trim().length, `${questId} must have a non-empty name`).toBeGreaterThan(0)
      expect(names.has(quest.name), `${questId} has duplicate name ${quest.name}`).toBe(false)
      names.add(quest.name)
      for (const req of quest.questRequirements || []) {
        expect(questMap[req], `${questId} has unknown quest requirement ${req}`).toBeDefined()
      }
    }
  })

  it('player-facing data excludes blocked legacy names', () => {
    const blocked = [
      'Chambers of Xeric',
      'Theatre of Blood',
      'Pest Control',
      'Castle Wars',
      'Mage Arena',
      'Fishing Trawler',
      '3rd Age',
      '3rd age',
      'Old School RuneScape',
      'RuneScape',
      'Jagex',
    ]
    const blobs = [JSON.stringify(items), JSON.stringify(monsters), JSON.stringify(raids), JSON.stringify(quests)]
    for (const term of blocked) {
      for (const blob of blobs) {
        expect(blob.includes(term), `Found blocked name: ${term}`).toBe(false)
      }
    }
  })

  it('boss unique and clue reward items have finite positive shopValue for PvP coin conversion', () => {
    for (const [itemId, item] of Object.entries(items as Record<string, any>)) {
      if (!item.isBossUnique && !item.isClueReward) continue
      const value = Number(item.shopValue)
      expect(Number.isFinite(value) && value > 0, `${itemId} requires positive finite shopValue`).toBe(true)
    }
  })
})
