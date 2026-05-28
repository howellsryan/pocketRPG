import gameIconsData from '../data/gameIcons.json'

// ─── Fallback tables ──────────────────────────────────────────────────────────

const SLOT_KEY = {
  head: 'helmet', body: 'body', legs: 'legs', feet: 'boots',
  hands: 'gloves', cape: 'cape', neck: 'amulet', ring: 'ring',
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
  if (id.includes('_ore') || id === 'ore') return 'ore'
  if (id.endsWith('_bar') || id === 'bar') return 'metal_bar'
  if (id.endsWith('_logs') || id === 'logs') return 'log'
  if (id.startsWith('raw_')) return 'raw_fish'
  if (id.startsWith('uncut_')) return 'gem'
  if (id.includes('_hide') || id.includes('_leather') || id === 'cowhide') return 'animal_hide'
  if (id.endsWith('_seed') || id.endsWith('_sapling')) return 'seed'
  if (id.endsWith('_rune') || id === 'rune') return 'rune'
  if (id.endsWith('_potion') || id.endsWith('_brew') || id === 'prayer_potion' || id.endsWith('_restore') || id === 'super_combat') return 'potion'
  if (id.includes('_crossbow')) return 'crossbow'
  if (id.includes('_axe')) return 'axe'
  if (id.includes('_pickaxe')) return 'pickaxe'
  if (id.includes('_shortbow') || id.endsWith('_shortbow_u')) return 'bow'
  if (id.includes('_longbow') || id === 'longbow') return 'bow'
  if (id.includes('_staff') || id.endsWith('_staff')) return 'staff'
  if (id.includes('_wand')) return 'wand'
  if (id.includes('_spear') || id.includes('_lance')) return 'spear'
  if (id.includes('_halberd')) return 'halberd'
  if (id.includes('_rapier')) return 'rapier'
  if (id.includes('_maul') || id.includes('_warhammer') || id.includes('_hammers') || id.includes('_flail')) return 'mace'
  if (id.includes('_dagger')) return 'dagger'
  if (id.includes('_scimitar')) return 'sword'
  if (id.includes('_sword') || id.includes('_longsword') || id.includes('_godsword')) return 'sword'
  if (id.includes('_mace')) return 'mace'
  if (id.includes('_bow')) return 'bow'
  if (id.includes('_gem') || id === 'dragonstone' || id === 'sapphire' || id === 'emerald' || id === 'ruby' || id === 'diamond' || id === 'onyx' || id === 'zyrite') return 'gem'
  if (id.includes('greens') || id.includes('herb') || id.includes('grimy_') || id.includes('leaf') || id === 'nettle') return 'herb'
  if (id === 'vial' || id === 'unpowered_orb') return 'vial'
  if (id === 'shrimp' || id === 'shark' || id === 'lobster' || id === 'swordfish' || id === 'trout' || id === 'anglerfish' || id === 'cooked_chicken' || id === 'cooked_meat') return 'cooked_fish'
  return null
}

// ─── Main resolver ────────────────────────────────────────────────────────────

export function getItemIconKey(item) {
  if (!item) return 'default'

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

  // 4. Armour/equipment slot fallback
  if (item.slot) {
    const bySlot = SLOT_KEY[item.slot]
    if (bySlot && gameIconsData[bySlot]) return bySlot
  }

  // 5. Type fallback
  const byType = TYPE_KEY[item.type]
  if (byType && gameIconsData[byType]) return byType

  return 'default'
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
  // Special overrides
  if (item.type === 'currency') return 'var(--color-gold)'
  if (item.id === 'bones' || item.id?.endsWith('_bones')) return '#a0a0a0'
  if (item.type === 'rune' || item.id?.endsWith('_rune')) return 'var(--color-mana-light)'
  if (item.type === 'seed' || item.id?.endsWith('_seed') || item.id?.endsWith('_sapling')) return 'var(--color-emerald-light)'
  if (item.type === 'potion' || item.id?.endsWith('_potion')) return 'var(--color-mana-light)'
  return TYPE_TINT[item.type] || 'var(--color-parchment)'
}
