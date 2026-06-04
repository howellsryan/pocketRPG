import gameIconsData from '../data/gameIcons.json'
import collectionLogData from '../data/collectionLog.json'
import { SKILL_ART } from './skillArt'

// The "Cryptbound Champions" raid set (the six named champions: morvyn, dravok,
// gorath, kaelor, torvek, verin) is defined authoritatively in the collection
// log — none of the item ids contain "cryptbound", so pull the list straight
// from the content data to stay in sync. `cryptbound_gloves` is the matching
// quest reward and is included too.
const CRYPTBOUND_CHAMPION_IDS = (() => {
  const ids = new Set(['cryptbound_gloves'])
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node && typeof node === 'object') {
      if (node.id === 'cryptbound_champions' && Array.isArray(node.items)) {
        node.items.forEach((id) => ids.add(id))
      }
      Object.values(node).forEach(walk)
    }
  }
  walk(collectionLogData)
  return ids
})()

export function isCryptboundChampion(id) {
  return !!id && CRYPTBOUND_CHAMPION_IDS.has(id)
}

// ─── Fallback tables ──────────────────────────────────────────────────────────

const SLOT_KEY = {
  head: 'crested_helmet', body: 'body', legs: 'legs', boots: 'boots',
  gloves: 'gloves', cape: 'cape', neck: 'amulet', ring: 'ring',
  shield: 'shield', ammo: 'arrow', weapon: 'sword'
}

const STYLE_KEY = {
  stab: 'dagger', slash: 'sword', crush: 'mace', ranged: 'bow', magic: 'staff'
}

const TYPE_KEY = {
  currency: 'coins', resource: 'ore', food: 'cooked_fish',
  ammo: 'arrow', weapon: 'sword', armour: 'body', armor: 'body',
  seed: 'seed', potion: 'potion', rune: 'rune', tool: 'hatchet',
  quest: 'scroll', derived_item: 'default', junk: 'default',
  drop: 'default', monster_drop: 'bones'
}

// ─── ID pattern matching ──────────────────────────────────────────────────────

// Pointy "wizard hat" silhouette for mage headgear that isn't a literal *_mitre.
const POINTY_HAT_IDS = new Set([
  'morvyn_s_hood', 'kodai_hat', 'wizard_hat', 'black_wizard_hat',
  'arcanist_hat', '2nd_age_mage_hat',
])

// Magic "robe bottom" silhouette. Named tops that read as robe bottoms plus any
// magic robe leg piece (skirt/bottom/legs whose id mentions a robe).
const ROBE_BOTTOM_IDS = new Set(['black_wizard_robe', 'void_king_robe'])
function isRobeBottom(id) {
  if (ROBE_BOTTOM_IDS.has(id)) return true
  return id.includes('robe') &&
    (id.includes('bottom') || id.includes('skirt') || id.includes('legs'))
}

function keyFromId(id) {
  if (!id) return null
  if (id === 'coins') return 'coins'
  if (id === 'bones' || id.endsWith('_bones') || id === 'ashes') return 'bones'
  if (id === 'feather') return 'feather'
  if (id === 'coal') return 'coal'
  if (id === 'thread') return 'thread'
  if (id === 'needle') return 'default'
  if (id === 'tinderbox') return 'default'
  if (id === 'fishing_rod') return 'fishing_pole'
  if (id === 'fishing_net' || id === 'lobster_cage' || id === 'angler_net') return 'fishing_net'
  if (id === 'harpoon') return 'spear'
  if (id === 'gold_spade') return 'spade'
  if (id === 'dragon_claws') return 'claws'
  if (id === 'scythe_of_vythar') return 'scythe'
  if (id === 'abyssal_tentacle' || id === 'nether_demon_whip') return 'whip'
  if (id === 'anti_dragon_shield' || id === 'dragon_kiteshield') return 'dragon_shield'
  if (id === 'durn_s_bulwark') return 'shield'
  if (id === 'sanguine_staff') return 'wand'
  if (id === 'halo') return 'angel_outfit'
  if (id === 'ava_s_accumulator' || id === 'ava_s_assembler') return 'quiver'
  if (id.endsWith('_cape')) return 'cape'
  if (id.endsWith('_partyhat') || id === 'partyhat') return 'party_hat'
  if (id.includes('charm') || id.includes('blessing')) return 'prayer'
  if (id.endsWith('_mitre') || POINTY_HAT_IDS.has(id)) return 'pointy_hat'
  if (isRobeBottom(id)) return 'magic_robe_bottom'
  if (id.includes('skirt') || id.includes('chaps')) return 'legs'
  if (id.includes('_ore') || id === 'ore') return 'ore'
  if (id.endsWith('_bar') || id === 'bar') return 'metal_bar'
  if (id.endsWith('_logs') || id === 'logs') return 'log'
  if (id.startsWith('raw_')) return 'raw_fish'
  if (id.startsWith('uncut_')) return 'gem'
  // Raw hide/leather materials only — *_d_hide_body/chaps/boots resolve by slot.
  if (id.endsWith('hide') || id.endsWith('_leather') || id === 'cowhide') return 'animal_hide'
  if (id.endsWith('_seed') || id.endsWith('_sapling')) return 'seed'
  if (id.endsWith('_rune') || id === 'rune') return 'rune'
  if (id.endsWith('_potion') || id.endsWith('_brew') || id === 'prayer_potion' || id.endsWith('_restore') || id === 'super_combat') return 'potion'
  if (id.includes('_crossbow')) return 'crossbow'
  if (id.includes('_axe')) return 'axe'
  if (id.includes('_pickaxe')) return 'pickaxe'
  if (id.includes('_shortbow') || id.endsWith('_shortbow_u')) return 'bow'
  if (id.includes('_longbow') || id === 'longbow') return 'bow'
  if (id.includes('_staff') || id.endsWith('_staff') || id === 'battlestaff') return 'staff'
  if (id.includes('_wand')) return 'wand'
  if (id.includes('_spear') || id.includes('_lance')) return 'spear'
  if (id.includes('_halberd')) return 'halberd'
  if (id.includes('_rapier')) return 'rapier'
  if (id.includes('_warhammer')) return 'warhammer'
  if (id.includes('_maul') || id.includes('_hammers') || id.includes('_flail')) return 'maul'
  if (id.includes('_dagger')) return 'dagger'
  if (id.includes('_scimitar')) return 'sword_spin'
  if (id.includes('_sword') || id.includes('_longsword') || id.includes('_godsword')) return 'sword'
  if (id.includes('_mace')) return 'mace'
  if (id.includes('_bow')) return 'bow'
  if (id.includes('_gem') || id === 'dragonstone' || id === 'sapphire' || id === 'emerald' || id === 'ruby' || id === 'diamond' || id === 'onyx' || id === 'zyrite') return 'gem'
  if (id.includes('greens') || id.includes('herb') || id.includes('grimy_') || id.includes('leaf') ||
      id.includes('root') || id.includes('weed') || id === 'nettle' || id === 'eye_of_newt' || id === 'goat_horn_dust') return 'herb'
  if (id === 'vial' || id === 'unpowered_orb') return 'vial'
  if (id === 'shrimps' || id === 'shark' || id === 'lobster' || id === 'swordfish' || id === 'trout' || id === 'anglerfish' || id === 'cooked_chicken' || id === 'cooked_meat') return 'cooked_fish'
  return null
}

// ─── Main resolver ────────────────────────────────────────────────────────────

export function getItemIconKey(item) {
  if (!item) return 'default'
  // gameIconsData ships in the lazily-loaded game chunk in the single-file
  // build; bail to a safe key if it hasn't loaded yet (see GameIcon).
  if (typeof gameIconsData === 'undefined') return item.iconId || 'default'

  // 1. Explicit curated iconId set in items.json
  if (item.iconId && gameIconsData[item.iconId]) return item.iconId

  // 2. ID pattern matching — handles most resources without per-item iconId
  const fromId = keyFromId(item.id)
  if (fromId && gameIconsData[fromId]) return fromId

  // 3. Weapon attack-style fallback
  if (item.slot === 'weapon' || item.type === 'weapon') {
    const byStyle = STYLE_KEY[item.attackStyle]
    if (byStyle && gameIconsData[byStyle]) return byStyle
    return 'sword'
  }

  // 4. Armour/equipment slot fallback — magic/ranged overrides for head/body/legs
  if (item.slot && (item.slot === 'head' || item.slot === 'body' || item.slot === 'legs')) {
    const ab = item.attackBonus
    if (ab) {
      const meleeBest = Math.max(ab.stab || 0, ab.slash || 0, ab.crush || 0)
      if ((ab.magic || 0) > 0 && (ab.magic || 0) > meleeBest && (ab.magic || 0) >= (ab.ranged || 0)) {
        return 'magic_robe'
      }
      if ((ab.ranged || 0) > 0 && (ab.ranged || 0) > meleeBest) {
        return item.slot === 'head' ? 'ninja' : 'ninja_body'
      }
    }
  }
  if (item.slot) {
    const bySlot = SLOT_KEY[item.slot]
    if (bySlot && gameIconsData[bySlot]) return bySlot
  }

  // 5. Type fallback
  const byType = TYPE_KEY[item.type]
  if (byType && gameIconsData[byType]) return byType

  return 'default'
}

// ─── Tier-based equipment tint ────────────────────────────────────────────────

// Explicit per-item tints (named uniques: jewellery, magic gear, boss weapons,
// boots, gloves, etc.). One id → one CSS colour.
const ITEM_TINT = {
  // Jewellery
  amulet_of_torment:  'var(--tier-jewel-red)',
  necklace_of_agony:  'var(--tier-jewel-green)',
  afflicted_bracelet: 'var(--tier-jewel-blue)',
  zaryth_vambraces:   'var(--tier-jewel-purple)',
  ring_of_affliction: 'var(--tier-cryptbound)',
  berserker_ring:     'var(--tier-jewel-red)',
  archers_ring:       'var(--tier-jewel-green)',
  seers_ring:         'var(--tier-jewel-blue)',
  amulet_of_fury:     'var(--tier-cryptbound)',
  amulet_of_glory:    'var(--tier-jewel-purple)',
  amulet_of_glory_t:  'var(--tier-jewel-purple)',
  amulet_of_strength: 'var(--tier-jewel-red)',
  arcane_necklace:    'var(--tier-jewel-blue)',
  occult_necklace:    'var(--tier-jewel-purple)',
  // Kodai set
  kodai_hat:          'var(--tier-jewel-purple)',
  kodai_robe_top:     'var(--tier-jewel-purple)',
  kodai_robe_bottom:  'var(--tier-jewel-purple)',
  // Ranger uniques
  robin_hood_hat:     'var(--tier-ranger)',
  rangers_tunic:      'var(--tier-ranger)',
  pathfinder_boots:   'var(--tier-ranger)',
  // Special capes (skill capes are handled separately by accent colour)
  fire_cape:          'var(--tier-fire-cape)',
  infernal_cape:      'var(--tier-infernal-cape)',
  imbued_god_cape:    'var(--tier-cryptbound)',
  ava_s_assembler:    'var(--tier-jewel-green)',
  ava_s_accumulator:  'var(--tier-jewel-green)',
  // Magic gear / materials
  magic_shortbow:     'var(--tier-jewel-blue)',
  magic_shortbow_u:   'var(--tier-jewel-blue)',
  magic_logs:         'var(--tier-jewel-blue)',
  staff_of_water:     'var(--tier-jewel-blue)',
  sanguine_staff:     'var(--tier-jewel-red)',
  staff_of_fire:      'var(--tier-jewel-red)',
  staff_of_earth:     'var(--tier-jewel-green)',
  staff_of_the_dead:  'var(--tier-cryptbound)',
  ancestral_wand:     'var(--tier-jewel-blue)',
  black_wizard_hat:   'var(--tier-cryptbound)',
  black_wizard_robe:  'var(--tier-cryptbound)',
  // Shields / bucklers / defenders
  arcane_kiteshield:     'var(--tier-orange)',
  eagle_eyed_kiteshield: 'var(--tier-jewel-green)',
  visage_shield:         'var(--tier-cryptbound)',
  warped_buckler:        'var(--tier-jewel-purple)',
  durn_s_bulwark:        'var(--tier-jewel-purple)',
  slayer_defender:       'var(--tier-cryptbound)',
  avernal_defender:      'var(--tier-cryptbound)',
  slayer_helmet:         'var(--tier-cryptbound)',
  // Weapons
  colossal_ballista:  'var(--tier-cryptbound)',
  twisted_longbow:    'var(--tier-cryptbound)',
  gargoyle_maul:      'var(--tier-cryptbound)',
  nightfang_bow:      'var(--tier-cryptbound)',
  scythe_of_vythar:   'var(--tier-cryptbound)',
  nether_demon_whip:  'var(--tier-cryptbound)',
  abyssal_tentacle:   'var(--tier-cryptbound)',
  ghraxis_rapier:     'var(--tier-cryptbound)',
  // Venom gear
  venom_blowpipe:     'var(--tier-jewel-green)',
  trident_of_venom:   'var(--tier-jewel-green)',
  serpentine_helm:    'var(--tier-jewel-green)',
  // Boots & accessories
  spiked_manacles:    'var(--tier-cryptbound)',
  evermore_boots:     'var(--tier-jewel-blue)',
  primeval_boots:     'var(--tier-jewel-red)',
  skyfury_boots:      'var(--tier-jewel-green)',
  // Gloves
  ferocious_gloves:   'var(--tier-cryptbound)',
  gloves_of_slaughter:'var(--tier-cryptbound)',
  // Potions
  attack_potion:      'var(--potion-attack)',
  strength_potion:    'var(--potion-strength)',
  combat_potion:      'var(--potion-combat)',
  prayer_potion:      'var(--potion-prayer)',
  super_attack:       'var(--potion-super-attack)',
  super_strength:     'var(--potion-super-strength)',
  super_defence:      'var(--potion-super-defence)',
  super_restore:      'var(--potion-super-restore)',
  ranging_potion:     'var(--potion-ranging)',
  super_combat:       'var(--potion-super-combat)',
  lumira_brew:        'var(--potion-strength)',
}

// "God" armour/weapon sets — every item sharing the prefix takes one colour.
const GOD_TINT = {
  'ancient_': 'var(--tier-jewel-purple)',
  'lumira_':  'var(--tier-jewel-blue)',
  'grondar_': 'var(--tier-bronze)',
  'krylth_':  'var(--tier-jewel-red)',
  'verdant_': 'var(--tier-jewel-green)',
}

// An item's metal/material tier decides its icon colour so the inventory reads
// at a glance. The FIRST matching rule wins, so the most specific (named
// uniques, then god sets) are checked before the generic metal-prefix rules.
// Returns a CSS color string, or null if the item has no tier (so the caller
// falls back to the type-based tint).
function getTierTint(item) {
  const id = item.id || ''

  if (isCryptboundChampion(id)) return 'var(--tier-cryptbound)'

  // Skill capes inherit their skill's accent colour (matches the skill icons).
  if (id.endsWith('_cape')) {
    const art = SKILL_ART[id.slice(0, -5)]
    if (art) return art.accent
  }

  // Explicit per-item tints
  if (ITEM_TINT[id]) return ITEM_TINT[id]
  if (id.startsWith('arcanist_')) return 'var(--tier-jewel-blue)'

  // God armour/weapon sets by prefix
  for (const prefix in GOD_TINT) {
    if (id.startsWith(prefix)) return GOD_TINT[prefix]
  }

  // Dragonhide / dragon leather crafting materials — match the d-hide armour colours
  if (id.includes('dragon_leather') || id.includes('dragonhide')) {
    if (id.startsWith('red_'))   return 'var(--tier-dhide-red)'
    if (id.startsWith('green_')) return 'var(--tier-dhide-green)'
    if (id.startsWith('black_')) return 'var(--tier-dhide-black)'
    if (id.startsWith('blue_'))  return 'var(--color-mana-light)'
  }
  if (id.startsWith('2nd_age_'))   return 'var(--tier-2nd-age)'
  if (id.startsWith('shardglass_')) return 'var(--tier-shardglass)'

  // Party hats by colour
  if (id === 'red_partyhat')       return 'var(--tier-partyhat-red)'
  if (id === 'blue_partyhat')      return 'var(--tier-partyhat-blue)'
  if (id === 'green_partyhat')     return 'var(--tier-partyhat-green)'
  if (id === 'yellow_partyhat')    return 'var(--tier-partyhat-yellow)'
  if (id === 'white_partyhat')     return 'var(--tier-partyhat-white)'
  if (id === 'purple_partyhat')    return 'var(--tier-partyhat-purple)'

  // Gold items (ore, bar, tools, amulet)
  if (id.startsWith('gold_'))      return 'var(--tier-gold)'

  // Dragonhide armour by colour
  if (id.includes('_d_hide_')) {
    if (id.startsWith('red_'))     return 'var(--tier-dhide-red)'
    if (id.startsWith('green_'))   return 'var(--tier-dhide-green)'
    if (id.startsWith('black_'))   return 'var(--tier-dhide-black)'
    if (id.startsWith('blue_'))    return 'var(--color-mana-light)'
  }

  // Metal / material tier prefixes. Each rule matches ids whose first segment is
  // the tier word (e.g. "bronze_dagger"). `dragon_bones` is excluded so it keeps
  // its bone-grey tint; "dragonstone*" ids never match because they begin with
  // "dragonstone_", not "dragon_".
  if (id.startsWith('runeforged_')) return 'var(--tier-runeforged)'
  if (id.startsWith('dragon_') && id !== 'dragon_bones') return 'var(--tier-dragon)'
  if (id.startsWith('bronze_') || id === 'copper_ore') return 'var(--tier-bronze)'
  if (id.startsWith('iron_'))    return 'var(--tier-iron)'
  if (id.startsWith('steel_'))   return 'var(--tier-steel)'
  if (id.startsWith('mithril_')) return 'var(--tier-mithril)'
  if (id.startsWith('adamant_') || id === 'adamantite_ore') return 'var(--tier-adamant)'

  return null
}

// ─── Tint by type ─────────────────────────────────────────────────────────────

const TYPE_TINT = {
  currency:     'var(--color-gold)',
  weapon:       'var(--color-parchment)',
  armour:       'var(--color-parchment)',
  armor:        'var(--color-parchment)',
  food:         'var(--color-emerald-light)',
  resource:     'var(--color-parchment-dark)',
  ammo:         'var(--color-parchment)',
  seed:         'var(--color-emerald-light)',
  potion:       'var(--color-mana-light)',
  rune:         'var(--color-mana-light)',
  tool:         'var(--color-parchment-dark)',
  quest:        'var(--color-gold)',
  derived_item: 'var(--color-parchment-dark)',
}

export function getItemIconTint(item) {
  if (!item) return 'var(--color-parchment)'
  // Tier colouring takes priority over the type-based tint below.
  const tierTint = getTierTint(item)
  if (tierTint) return tierTint
  // Special overrides
  if (item.type === 'currency') return 'var(--color-gold)'
  if (item.id?.includes('charm') || item.id?.includes('blessing')) return 'var(--color-gold)'
  if (item.id?.includes('leaf') || item.id?.includes('herb') || item.id?.includes('root') || item.id?.includes('weed')) return 'var(--color-emerald-light)'
  if (item.id === 'bones' || item.id?.endsWith('_bones')) return '#a0a0a0'
  if (item.type === 'rune' || item.id?.endsWith('_rune')) return 'var(--color-mana-light)'
  if (item.type === 'seed' || item.id?.endsWith('_seed') || item.id?.endsWith('_sapling')) return 'var(--color-emerald-light)'
  if (item.type === 'potion' || item.id?.endsWith('_potion')) return 'var(--color-mana-light)'
  return TYPE_TINT[item.type] || 'var(--color-parchment)'
}
