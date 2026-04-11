import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { countItem, removeItem, addItem, freeSlots } from '../engine/inventory.js'
import { getLevelFromXP } from '../engine/experience.js'

// ── UNLOCK DEFINITIONS ───────────────────────────────────────────────────────

const UNLOCKS = [
  {
    id: 'skip_hour',
    name: 'Skip 1 Hour',
    icon: '⏭️',
    price: 10_000_000,
    desc: 'Instantly simulate 1 hour of active task progress. Repeatable. Does not work during boss fights.',
  },
]

const UNLOCK_TAB = { id: 'unlocks', label: '🔓', title: 'Unlocks', desc: 'Permanent features & upgrades. One-time purchases.' }

// ── SLAYER SHOP ──────────────────────────────────────────────────────────────
const SLAYER_SHOP_TAB = { id: 'slayer', label: '💀', title: 'Slayer Reward Shop', desc: 'Spend slayer points earned from completing tasks. Requires slayer level to purchase.' }

const SLAYER_SHOP_ITEMS = [
  {
    id: 'slayer_helmet',
    name: 'Slayer helmet',
    icon: '💀',
    cost: 400,
    stackable: false,
    slayerReq: 20,
    desc: 'Combines the black mask effect. +15% melee accuracy & strength while on a slayer task. Requires Slayer 20.',
  },
]

// ── SHOP DEFINITIONS ────────────────────────────────────────────────────────
// All prices match OSRS NPC shop buy prices (cheapest source when multiple exist).

const SHOPS = [
  {
    id: 'general',
    label: '🏪',
    title: 'General Store',
    desc: 'Everyday tools and supplies.',
    items: [
      { id: 'needle',    name: 'Needle',    icon: '🪡', price: 1,   stackable: false, desc: 'Used for crafting leather armour.' },
      { id: 'thread',    name: 'Thread',    icon: '🧵', price: 1,   stackable: true,  desc: 'Used alongside a needle for leather crafting.' },
      { id: 'tinderbox', name: 'Tinderbox', icon: '🔥', price: 1,   stackable: false, desc: 'Used to light fires.' },
      { id: 'chisel',    name: 'Chisel',    icon: '🔧', price: 1,   stackable: false, desc: 'Used to cut gems and craft items.' },
      { id: 'hammer',    name: 'Hammer',    icon: '🔨', price: 1,   stackable: false, desc: 'Required for smithing at an anvil.' },
      { id: 'fishing_net',  name: 'Fishing net',  icon: '🕸️', price: 50,  stackable: false, desc: 'Net for catching shrimps. Fishing 1. 2-handed.' },
      { id: 'fishing_rod',  name: 'Fishing rod',  icon: '🎣', price: 100, stackable: false, desc: 'Rod for catching trout. Fishing 20. 2-handed.' },
      { id: 'lobster_cage', name: 'Lobster cage', icon: '🪤', price: 200, stackable: false, desc: 'Cage for catching lobsters. Fishing 40. 2-handed.' },
      { id: 'harpoon',      name: 'Harpoon',      icon: '🔱', price: 500, stackable: false, desc: 'Harpoon for swordfish & sharks. Fishing 50. 2-handed.' },
      { id: 'feathers',     name: 'Feathers',     icon: '🪶', price: 3,   stackable: true,  desc: 'Used for crafting arrows and fletching.' },
    ],
  },
  {
    id: 'weapons',
    label: '⚔️',
    title: 'Weapon Shop',
    desc: 'Daggers, swords, longswords, scimitars & maces.',
    items: [
      { id: 'bronze_dagger',    name: 'Bronze dagger',    icon: '🗡️', price: 26,    stackable: false, desc: 'Fast stab weapon. Atk 1. Str +3.' },
      { id: 'iron_dagger',      name: 'Iron dagger',      icon: '🗡️', price: 45,    stackable: false, desc: 'Iron stab weapon. Atk 1. Str +7.' },
      { id: 'steel_dagger',     name: 'Steel dagger',     icon: '🗡️', price: 175,   stackable: false, desc: 'Steel stab weapon. Atk 5. Str +12.' },
      { id: 'mithril_dagger',   name: 'Mithril dagger',   icon: '🗡️', price: 585,   stackable: false, desc: 'Mithril stab weapon. Atk 20. Str +20.' },
      { id: 'adamant_dagger',   name: 'Adamant dagger',   icon: '🗡️', price: 1248,  stackable: false, desc: 'Adamant stab weapon. Atk 30. Str +31.' },
      { id: 'bronze_sword',     name: 'Bronze sword',     icon: '⚔️', price: 26,    stackable: false, desc: 'Bronze sword. Atk 1. Str +5.' },
      { id: 'iron_sword',       name: 'Iron sword',       icon: '⚔️', price: 91,    stackable: false, desc: 'Iron sword. Atk 1. Str +10.' },
      { id: 'steel_sword',      name: 'Steel sword',      icon: '⚔️', price: 325,   stackable: false, desc: 'Steel sword. Atk 5. Str +17.' },
      { id: 'mithril_sword',    name: 'Mithril sword',    icon: '⚔️', price: 845,   stackable: false, desc: 'Mithril sword. Atk 20. Str +28.' },
      { id: 'adamant_sword',    name: 'Adamant sword',    icon: '⚔️', price: 2080,  stackable: false, desc: 'Adamant sword. Atk 30. Str +42.' },
      { id: 'bronze_longsword', name: 'Bronze longsword', icon: '⚔️', price: 40,    stackable: false, desc: 'Long bronze blade. Atk 1. Str +8.' },
      { id: 'iron_longsword',   name: 'Iron longsword',   icon: '⚔️', price: 140,   stackable: false, desc: 'Long iron blade. Atk 1. Str +14.' },
      { id: 'steel_longsword',  name: 'Steel longsword',  icon: '⚔️', price: 500,   stackable: false, desc: 'Long steel blade. Atk 5. Str +24.' },
      { id: 'mithril_longsword',name: 'Mithril longsword',icon: '⚔️', price: 1300,  stackable: false, desc: 'Long mithril blade. Atk 20. Str +40.' },
      { id: 'adamant_longsword',name: 'Adamant longsword',icon: '⚔️', price: 3200,  stackable: false, desc: 'Long adamant blade. Atk 30. Str +58.' },
      { id: 'bronze_scimitar',  name: 'Bronze scimitar',  icon: '⚔️', price: 32,    stackable: false, desc: 'Best slash speed. Atk 1. Str +3.' },
      { id: 'iron_scimitar',    name: 'Iron scimitar',    icon: '⚔️', price: 112,   stackable: false, desc: 'Iron scimitar. Atk 1. Str +14.' },
      { id: 'steel_scimitar',   name: 'Steel scimitar',   icon: '⚔️', price: 400,   stackable: false, desc: 'Steel scimitar. Atk 5. Str +24.' },
      { id: 'mithril_scimitar', name: 'Mithril scimitar', icon: '⚔️', price: 1040,  stackable: false, desc: 'Mithril scimitar. Atk 20. Str +40.' },
      { id: 'adamant_scimitar', name: 'Adamant scimitar', icon: '⚔️', price: 2560,  stackable: false, desc: 'Adamant scimitar. Atk 30. Str +67.' },
      { id: 'rune_scimitar',    name: 'Rune scimitar',    icon: '⚔️', price: 20480,  stackable: false, desc: 'Best F2P scimitar. Atk 40. Str +75.' },
      { id: 'dragon_dagger',    name: 'Dragon dagger',    icon: '🗡️', price: 30000,  stackable: false, desc: 'Fast dragon stab weapon. Atk 60. Str +40.' },
      { id: 'dragon_scimitar',  name: 'Dragon scimitar',  icon: '⚔️', price: 59776,  stackable: false, desc: 'Best slash weapon. Atk 60. Str +66.' },
      { id: 'bronze_mace',  name: 'Bronze mace',  icon: '🔱', price: 18,   stackable: false, desc: 'Crush + prayer bonus. Atk 1. Str +5.' },
      { id: 'iron_mace',    name: 'Iron mace',    icon: '🔱', price: 50,   stackable: false, desc: 'Iron crush weapon. Atk 1. Str +10.' },
      { id: 'steel_mace',   name: 'Steel mace',   icon: '🔱', price: 260,  stackable: false, desc: 'Steel crush weapon. Atk 5. Str +17.' },
      { id: 'mithril_mace', name: 'Mithril mace', icon: '🔱', price: 650,  stackable: false, desc: 'Mithril crush weapon. Atk 20. Str +29.' },
      { id: 'adamant_mace', name: 'Adamant mace', icon: '🔱', price: 1664, stackable: false, desc: 'Adamant crush weapon. Atk 30. Str +44.' },
    ],
  },
  {
    id: 'armour',
    label: '🛡️',
    title: 'Armour Shop',
    desc: 'Melee armour from bronze to rune.',
    items: [
      { id: 'bronze_full_helm',   name: 'Bronze full helm',   icon: '⛑️', price: 42,    stackable: false, desc: 'Def: stab+4 slash+5 crush+3. Def 1.' },
      { id: 'bronze_platebody',   name: 'Bronze platebody',   icon: '🧥', price: 160,   stackable: false, desc: 'Def: stab+15 slash+14 crush+9. Def 1.' },
      { id: 'bronze_platelegs',   name: 'Bronze platelegs',   icon: '🦵', price: 80,    stackable: false, desc: 'Def: stab+7 slash+8 crush+6. Def 1.' },
      { id: 'bronze_kiteshield',  name: 'Bronze kiteshield',  icon: '🛡️', price: 54,    stackable: false, desc: 'Def: stab+6 slash+8 crush+7. Def 1.' },
      { id: 'iron_full_helm',     name: 'Iron full helm',     icon: '⛑️', price: 84,    stackable: false, desc: 'Def: stab+7 slash+8 crush+5. Def 1.' },
      { id: 'iron_platebody',     name: 'Iron platebody',     icon: '🧥', price: 280,   stackable: false, desc: 'Def: stab+22 slash+21 crush+16. Def 1.' },
      { id: 'iron_platelegs',     name: 'Iron platelegs',     icon: '🦵', price: 224,   stackable: false, desc: 'Def: stab+9 slash+11 crush+9. Def 1.' },
      { id: 'iron_kiteshield',    name: 'Iron kiteshield',    icon: '🛡️', price: 112,   stackable: false, desc: 'Def: stab+9 slash+11 crush+10. Def 1.' },
      { id: 'steel_full_helm',    name: 'Steel full helm',    icon: '⛑️', price: 400,   stackable: false, desc: 'Def: stab+9 slash+11 crush+8. Def 5.' },
      { id: 'steel_platebody',    name: 'Steel platebody',    icon: '🧥', price: 1200,  stackable: false, desc: 'Def: stab+28 slash+27 crush+22. Def 5.' },
      { id: 'steel_platelegs',    name: 'Steel platelegs',    icon: '🦵', price: 650,   stackable: false, desc: 'Def: stab+17 slash+19 crush+16. Def 5.' },
      { id: 'steel_kiteshield',   name: 'Steel kiteshield',   icon: '🛡️', price: 320,   stackable: false, desc: 'Def: stab+15 slash+18 crush+17. Def 5.' },
      { id: 'mithril_full_helm',  name: 'Mithril full helm',  icon: '⛑️', price: 1040,  stackable: false, desc: 'Def: stab+14 slash+17 crush+13. Def 20.' },
      { id: 'mithril_platebody',  name: 'Mithril platebody',  icon: '🧥', price: 3900,  stackable: false, desc: 'Def: stab+44 slash+42 crush+37. Def 20.' },
      { id: 'mithril_platelegs',  name: 'Mithril platelegs',  icon: '🦵', price: 1950,  stackable: false, desc: 'Def: stab+28 slash+31 crush+26. Def 20.' },
      { id: 'mithril_kiteshield', name: 'Mithril kiteshield', icon: '🛡️', price: 1040,  stackable: false, desc: 'Def: stab+24 slash+27 crush+26. Def 20.' },
      { id: 'adamant_full_helm',  name: 'Adamant full helm',  icon: '⛑️', price: 2304,  stackable: false, desc: 'Def: stab+19 slash+23 crush+17. Def 30.' },
      { id: 'adamant_platebody',  name: 'Adamant platebody',  icon: '🧥', price: 9600,  stackable: false, desc: 'Def: stab+63 slash+61 crush+55. Def 30.' },
      { id: 'adamant_platelegs',  name: 'Adamant platelegs',  icon: '🦵', price: 5312,  stackable: false, desc: 'Def: stab+40 slash+45 crush+38. Def 30.' },
      { id: 'adamant_kiteshield', name: 'Adamant kiteshield', icon: '🛡️', price: 2496,  stackable: false, desc: 'Def: stab+33 slash+38 crush+36. Def 30.' },
      { id: 'rune_med_helm',      name: 'Rune med helm',      icon: '⛑️', price: 11000, stackable: false, desc: 'Rune medium helm. Def 40.' },
      { id: 'anti_dragon_shield', name: 'Anti-dragon shield', icon: '🛡️', price: 800,   stackable: false, desc: '🔥 Blocks dragonfire attacks from dragons. Def 1.' },
      { id: 'berserker_helm',     name: 'Berserker helm',     icon: '⛑️', price: 78000, stackable: false, desc: 'Str bonus helmet. Def 45 + Str 45. Str +3.' },
    ],
  },
  {
    id: 'ranged',
    label: '🏹',
    title: 'Ranged Shop',
    desc: 'Bows, arrows, bolts & ranged armour.',
    items: [
      { id: 'shortbow',          name: 'Shortbow',          icon: '🏹', price: 50,   stackable: false, desc: 'Uses bronze-iron arrows. Rng 1.' },
      { id: 'longbow',           name: 'Longbow',           icon: '🏹', price: 80,   stackable: false, desc: 'Longer range, uses bronze. Rng 1.' },
      { id: 'oak_shortbow',      name: 'Oak shortbow',      icon: '🏹', price: 100,  stackable: false, desc: 'Uses up to iron arrows. Rng 5.' },
      { id: 'oak_longbow',       name: 'Oak longbow',       icon: '🏹', price: 160,  stackable: false, desc: 'Oak longbow. Rng 5.' },
      { id: 'willow_shortbow',   name: 'Willow shortbow',   icon: '🏹', price: 200,  stackable: false, desc: 'Uses up to steel arrows. Rng 20.' },
      { id: 'willow_longbow',    name: 'Willow longbow',    icon: '🏹', price: 320,  stackable: false, desc: 'Willow longbow. Rng 20.' },
      { id: 'maple_shortbow',    name: 'Maple shortbow',    icon: '🏹', price: 400,  stackable: false, desc: 'Uses up to mithril arrows. Rng 30.' },
      { id: 'maple_longbow',     name: 'Maple longbow',     icon: '🏹', price: 640,  stackable: false, desc: 'Maple longbow. Rng 30.' },
      { id: 'yew_shortbow',      name: 'Yew shortbow',      icon: '🏹', price: 640,  stackable: false, desc: 'Uses up to adamant arrows. Rng 40.' },
      { id: 'magic_shortbow',    name: 'Magic shortbow',    icon: '🏹', price: 1800, stackable: false, desc: 'Uses up to rune arrows. Rng 50.' },
      { id: 'crossbow',          name: 'Crossbow',          icon: '🏹', price: 70,   stackable: false, desc: 'One-handed. Uses bolts. Rng 1.' },
      { id: 'bronze_bolts',      name: 'Bronze bolts',      icon: '🔩', price: 1,    stackable: true,  desc: 'Crossbow ammo. RngStr +10.' },
      { id: 'iron_bolts',        name: 'Iron bolts',        icon: '🔩', price: 4,    stackable: true,  desc: 'Crossbow ammo. RngStr +16.' },
      { id: 'bronze_arrow',      name: 'Bronze arrow',      icon: '🎯', price: 1,    stackable: true,  desc: 'Basic arrow. RngStr +7.' },
      { id: 'iron_arrow',        name: 'Iron arrow',        icon: '🎯', price: 3,    stackable: true,  desc: 'Iron arrow. RngStr +10.' },
      { id: 'steel_arrow',       name: 'Steel arrow',       icon: '🎯', price: 12,   stackable: true,  desc: 'Steel arrow. RngStr +16.' },
      { id: 'mithril_arrow',     name: 'Mithril arrow',     icon: '🎯', price: 32,   stackable: true,  desc: 'Mithril arrow. RngStr +22.' },
      { id: 'adamant_arrow',     name: 'Adamant arrow',     icon: '🎯', price: 80,   stackable: true,  desc: 'Adamant arrow. RngStr +31.' },
      { id: 'leather_coif',      name: 'Leather cowl',      icon: '🪖', price: 9,    stackable: false, desc: 'Def 1. Ranged head slot.' },
      { id: 'leather_body',      name: 'Leather body',      icon: '🧥', price: 21,   stackable: false, desc: 'Def 1. Ranged body slot.' },
      { id: 'leather_chaps',     name: 'Leather chaps',     icon: '🩲', price: 18,   stackable: false, desc: 'Def 1. Ranged leg slot.' },
      { id: 'leather_gloves',    name: 'Leather gloves',    icon: '🧤', price: 6,    stackable: false, desc: 'Def 1. Ranged glove slot.' },
      { id: 'leather_boots',     name: 'Leather boots',     icon: '👢', price: 6,    stackable: false, desc: 'Def 1. Ranged boot slot.' },
      { id: 'hard_leather_body', name: 'Hard leather body', icon: '🧥', price: 132,  stackable: false, desc: 'Def 10. Better ranged body.' },
      { id: 'studded_body',      name: 'Studded body',      icon: '🧥', price: 850,  stackable: false, desc: 'Def 20. Good ranged body. Rng+15.' },
      { id: 'studded_chaps',     name: 'Studded chaps',     icon: '🩲', price: 430,  stackable: false, desc: 'Def 20. Good ranged chaps. Rng+10.' },
      { id: 'green_dhide_body',  name: "Green d'hide body", icon: '🧥', price: 4680, stackable: false, desc: "Def 40. Best F2P ranged body. Rng+15." },
      { id: 'green_dhide_chaps', name: "Green d'hide chaps",icon: '🩲', price: 2964, stackable: false, desc: "Def 40. Best F2P ranged legs. Rng+10." },
    ],
  },
  {
    id: 'magic',
    label: '🪄',
    title: 'Magic Shop',
    desc: 'Staves & runes for spellcasting.',
    items: [
      { id: 'staff',          name: 'Staff',          icon: '🪄', price: 15,   stackable: false, desc: 'Basic magic weapon. No req.' },
      { id: 'magic_staff',    name: 'Magic staff',    icon: '🪄', price: 200,  stackable: false, desc: 'Better magic bonuses. Magic 1.' },
      { id: 'staff_of_air',   name: 'Staff of air',   icon: '🌬️', price: 1500, stackable: false, desc: 'Provides unlimited air runes.' },
      { id: 'staff_of_water', name: 'Staff of water', icon: '💧', price: 1500, stackable: false, desc: 'Provides unlimited water runes.' },
      { id: 'staff_of_fire',  name: 'Staff of fire',  icon: '🔥', price: 1500, stackable: false, desc: 'Provides unlimited fire runes.' },
      { id: 'staff_of_earth', name: 'Staff of earth', icon: '🌍', price: 1500, stackable: false, desc: 'Provides unlimited earth runes.' },
      { id: 'air_rune',       name: 'Air rune',       icon: '💨', price: 17,   stackable: true,  desc: 'Used in most air spells.' },
      { id: 'water_rune',     name: 'Water rune',     icon: '💧', price: 17,   stackable: true,  desc: 'Used in water spells.' },
      { id: 'earth_rune',     name: 'Earth rune',     icon: '🌍', price: 17,   stackable: true,  desc: 'Used in earth spells.' },
      { id: 'fire_rune',      name: 'Fire rune',      icon: '🔥', price: 17,   stackable: true,  desc: 'Used in fire spells.' },
      { id: 'mind_rune',      name: 'Mind rune',      icon: '🧠', price: 17,   stackable: true,  desc: 'Used in offensive spells.' },
      { id: 'body_rune',      name: 'Body rune',      icon: '🫀', price: 16,   stackable: true,  desc: 'Used in stat-lowering spells.' },
      { id: 'chaos_rune',     name: 'Chaos rune',     icon: '💜', price: 140,  stackable: true,  desc: 'Mid-level combat spells.' },
      { id: 'nature_rune',    name: 'Nature rune',    icon: '🍀', price: 200,  stackable: true,  desc: 'Alchemy and binding spells.' },
      { id: 'law_rune',       name: 'Law rune',       icon: '⚖️', price: 200,  stackable: true,  desc: 'Teleportation spells.' },
      { id: 'cosmic_rune',    name: 'Cosmic rune',    icon: '✨', price: 200,  stackable: true,  desc: 'Enchantment spells.' },
      { id: 'astral_rune',    name: 'Astral rune',    icon: '✨', price: 190,  stackable: true,  desc: 'Teleportation & utility spells.' },
      { id: 'death_rune',     name: 'Death rune',     icon: '💀', price: 310,  stackable: true,  desc: 'High-level combat spells.' },
    ],
  },
  {
    id: 'capes',
    label: '🎗️',
    title: 'Skill Capes',
    desc: 'Awarded for reaching level 99. Requires 99 in the matching skill.',
    items: [
      { id: 'attack_cape',      name: 'Attack cape',      icon: '🎗️', price: 99000, stackable: false, desc: 'Requires Attack 99. Def +9 all styles.', requiresSkill: 'attack',      requiresLevel: 99 },
      { id: 'strength_cape',    name: 'Strength cape',    icon: '🎗️', price: 99000, stackable: false, desc: 'Requires Strength 99. Def +9 all styles.', requiresSkill: 'strength',    requiresLevel: 99 },
      { id: 'defence_cape',     name: 'Defence cape',     icon: '🎗️', price: 99000, stackable: false, desc: 'Requires Defence 99. Def +9 all styles.', requiresSkill: 'defence',     requiresLevel: 99 },
      { id: 'hitpoints_cape',   name: 'Hitpoints cape',   icon: '🎗️', price: 99000, stackable: false, desc: 'Requires Hitpoints 99. Def +9 all styles.', requiresSkill: 'hitpoints',   requiresLevel: 99 },
      { id: 'ranged_cape',      name: 'Ranged cape',      icon: '🎗️', price: 99000, stackable: false, desc: 'Requires Ranged 99. Def +9 all styles.', requiresSkill: 'ranged',      requiresLevel: 99 },
      { id: 'magic_cape',       name: 'Magic cape',       icon: '🎗️', price: 99000, stackable: false, desc: 'Requires Magic 99. Def +9 all styles.', requiresSkill: 'magic',       requiresLevel: 99 },
      { id: 'prayer_cape',      name: 'Prayer cape',      icon: '🎗️', price: 99000, stackable: false, desc: 'Requires Prayer 99. Def +9 all styles.', requiresSkill: 'prayer',      requiresLevel: 99 },
      { id: 'mining_cape',      name: 'Mining cape',      icon: '🎗️', price: 99000, stackable: false, desc: 'Requires Mining 99. Def +9 all styles.', requiresSkill: 'mining',      requiresLevel: 99 },
      { id: 'woodcutting_cape', name: 'Woodcutting cape', icon: '🎗️', price: 99000, stackable: false, desc: 'Requires Woodcutting 99. Def +9 all styles.', requiresSkill: 'woodcutting', requiresLevel: 99 },
      { id: 'fishing_cape',     name: 'Fishing cape',     icon: '🎗️', price: 99000, stackable: false, desc: 'Requires Fishing 99. Def +9 all styles.', requiresSkill: 'fishing',     requiresLevel: 99 },
      { id: 'smithing_cape',    name: 'Smithing cape',    icon: '🎗️', price: 99000, stackable: false, desc: 'Requires Smithing 99. Def +9 all styles.', requiresSkill: 'smithing',    requiresLevel: 99 },
      { id: 'cooking_cape',     name: 'Cooking cape',     icon: '🎗️', price: 99000, stackable: false, desc: 'Requires Cooking 99. Def +9 all styles.', requiresSkill: 'cooking',     requiresLevel: 99 },
      { id: 'fletching_cape',   name: 'Fletching cape',   icon: '🎗️', price: 99000, stackable: false, desc: 'Requires Fletching 99. Def +9 all styles.', requiresSkill: 'fletching',   requiresLevel: 99 },
      { id: 'crafting_cape',    name: 'Crafting cape',    icon: '🎗️', price: 99000, stackable: false, desc: 'Requires Crafting 99. Def +9 all styles.', requiresSkill: 'crafting',    requiresLevel: 99 },
      { id: 'herblore_cape',    name: 'Herblore cape',    icon: '🎗️', price: 99000, stackable: false, desc: 'Requires Herblore 99. Def +9 all styles.', requiresSkill: 'herblore',    requiresLevel: 99 },
      { id: 'agility_cape',     name: 'Agility cape',     icon: '🎗️', price: 99000, stackable: false, desc: 'Requires Agility 99. Def +9 all styles.', requiresSkill: 'agility',     requiresLevel: 99 },
    ],
  },
]

// ── COMPONENT ───────────────────────────────────────────────────────────────
export default function GeneralStoreScreen() {
  const { inventory, updateInventory, addToast, getSkillLevel, unlockedFeatures, unlockFeature, slayerPoints, updateSlayerPoints, stats } = useGame()
  const [activeShop, setActiveShop] = useState('general')
  const [quantities, setQuantities] = useState({})

  const coins = countItem(inventory, 'coins')
  const isUnlocksTab = activeShop === 'unlocks'
  const isSlayerTab = activeShop === 'slayer'
  const shop = isUnlocksTab ? UNLOCK_TAB : isSlayerTab ? SLAYER_SHOP_TAB : SHOPS.find(s => s.id === activeShop)

  const getQty = (id) => quantities[id] || 1
  const setQty = (id, val) => {
    const n = Math.max(1, Math.min(9999, parseInt(val) || 1))
    setQuantities(q => ({ ...q, [id]: n }))
  }

  const handleBuy = (storeItem) => {
    const qty = getQty(storeItem.id)
    const totalCost = storeItem.price * qty

    if (storeItem.requiresSkill && storeItem.requiresLevel) {
      const playerLevel = getSkillLevel(storeItem.requiresSkill)
      if (playerLevel < storeItem.requiresLevel) {
        const skillName = storeItem.requiresSkill.charAt(0).toUpperCase() + storeItem.requiresSkill.slice(1)
        addToast(`Need ${skillName} level ${storeItem.requiresLevel} to buy this cape.`, 'error')
        return
      }
    }

    if (coins < totalCost) {
      addToast(`Need ${totalCost.toLocaleString()} coins — you have ${coins.toLocaleString()}.`, 'error')
      return
    }

    const newInv = [...inventory]

    if (!storeItem.stackable) {
      const free = freeSlots(newInv)
      if (free < qty) {
        addToast(`Need ${qty} free slot${qty > 1 ? 's' : ''} — only ${free} available.`, 'error')
        return
      }
    } else {
      const existing = countItem(newInv, storeItem.id)
      if (existing === 0 && freeSlots(newInv) === 0) {
        addToast('Not enough inventory space.', 'error')
        return
      }
    }

    removeItem(newInv, 'coins', totalCost)
    for (let i = 0; i < qty; i++) {
      addItem(newInv, storeItem.id, 1, storeItem.stackable)
    }
    updateInventory(newInv)
    addToast(`${storeItem.icon ? storeItem.icon + ' ' : ''}${storeItem.name} ${qty > 1 ? `×${qty}` : ''} purchased!`, 'success')
  }

  const handleUnlock = (unlock) => {
    if (unlockedFeatures.has(unlock.id)) {
      addToast('Already unlocked.', 'info')
      return
    }
    if (coins < unlock.price) {
      addToast(`Need ${unlock.price.toLocaleString()} coins — you have ${coins.toLocaleString()}.`, 'error')
      return
    }
    const newInv = [...inventory]
    removeItem(newInv, 'coins', unlock.price)
    updateInventory(newInv)
    unlockFeature(unlock.id)
    addToast(`${unlock.name} unlocked!`, 'info', unlock.icon)
  }

  const handleSlayerBuy = (item) => {
    // Check slayer level requirement
    const slayerLevel = getLevelFromXP(stats.slayer?.xp || 0)
    if (item.slayerReq && slayerLevel < item.slayerReq) {
      addToast(`Need Slayer level ${item.slayerReq} to purchase this.`, 'error')
      return
    }
    if ((slayerPoints || 0) < item.cost) {
      addToast(`Need ${item.cost} slayer points — you have ${slayerPoints || 0}.`, 'error')
      return
    }
    const newInv = [...inventory]
    if (!item.stackable) {
      if (freeSlots(newInv) === 0) {
        addToast('Not enough inventory space.', 'error')
        return
      }
    } else {
      const existing = countItem(newInv, item.id)
      if (existing === 0 && freeSlots(newInv) === 0) {
        addToast('Not enough inventory space.', 'error')
        return
      }
    }
    addItem(newInv, item.id, 1, item.stackable)
    updateInventory(newInv)
    updateSlayerPoints((slayerPoints || 0) - item.cost)
    addToast(`${item.icon} ${item.name} purchased!`, 'info')
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── HEADER ── */}
      <div style={{ padding: '12px 16px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
          <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '15px', fontWeight: '700', color: '#d4af37', margin: 0 }}>
            {shop.title}
          </h2>
          <span style={{ fontSize: '11px', color: '#d4af37', fontFamily: 'monospace' }}>
            {isSlayerTab
              ? `💀 ${(slayerPoints || 0).toLocaleString()} pts`
              : `🪙 ${coins.toLocaleString()}`}
          </span>
        </div>
        <p style={{ fontSize: '10px', color: '#e8d5b0', opacity: 0.4, margin: '0 0 10px' }}>
          {shop.desc}
        </p>

        {/* ── TAB BAR ── */}
        <div style={{
          display: 'flex',
          gap: '4px',
          overflowX: 'auto',
          paddingBottom: '8px',
          scrollbarWidth: 'none',
        }}>
          {[...SHOPS, SLAYER_SHOP_TAB, UNLOCK_TAB].map(s => (
            <button
              key={s.id}
              onClick={() => setActiveShop(s.id)}
              style={{
                flexShrink: 0,
                padding: '6px 12px',
                borderRadius: '8px',
                border: activeShop === s.id ? '1px solid #d4af37' : '1px solid #2a2a2a',
                background: activeShop === s.id ? 'rgba(212,175,55,0.15)' : '#1a1a1a',
                color: activeShop === s.id ? '#d4af37' : '#e8d5b0',
                fontSize: '13px',
                cursor: 'pointer',
                fontWeight: activeShop === s.id ? '700' : '400',
                opacity: activeShop === s.id ? 1 : 0.55,
                transition: 'all 0.15s',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── ITEM LIST / UNLOCKS ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 80px' }}>

        {/* ── UNLOCKS TAB ── */}
        {isUnlocksTab && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {UNLOCKS.map(unlock => {
              const owned = unlockedFeatures.has(unlock.id)
              const canAfford = coins >= unlock.price
              return (
                <div
                  key={unlock.id}
                  style={{
                    background: '#1a1a1a',
                    border: owned ? '1px solid rgba(212,175,55,0.4)' : '1px solid #2a2a2a',
                    borderRadius: '10px',
                    padding: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <span style={{ fontSize: '26px', lineHeight: 1, flexShrink: 0 }}>{unlock.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#e8d5b0' }}>{unlock.name}</div>
                      <div style={{ fontSize: '10px', color: '#e8d5b0', opacity: 0.4, marginTop: '2px' }}>{unlock.desc}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {owned
                        ? <div style={{ fontSize: '11px', color: '#d4af37', fontWeight: '700' }}>✓ Owned</div>
                        : <>
                            <div style={{ fontSize: '12px', color: '#d4af37', fontFamily: 'monospace' }}>{unlock.price.toLocaleString()} gp</div>
                            <div style={{ fontSize: '9px', color: '#e8d5b0', opacity: 0.3 }}>one-time</div>
                          </>
                      }
                    </div>
                  </div>
                  <button
                    onClick={() => handleUnlock(unlock)}
                    disabled={owned}
                    style={{
                      width: '100%',
                      padding: '8px',
                      borderRadius: '8px',
                      background: owned ? '#1a1a1a' : canAfford ? 'linear-gradient(135deg, #b8940e, #d4af37)' : '#222',
                      border: owned ? '1px solid #333' : 'none',
                      color: owned ? '#d4af37' : canAfford ? '#0f0f0f' : '#888',
                      fontSize: '12px',
                      fontWeight: '700',
                      cursor: owned || !canAfford ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {owned ? '✓ Unlocked' : canAfford ? `Unlock · ${unlock.price.toLocaleString()} gp` : `Need ${unlock.price.toLocaleString()} gp`}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* ── SLAYER SHOP TAB ── */}
        {isSlayerTab && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {SLAYER_SHOP_ITEMS.map(item => {
              const slayerLevel = getLevelFromXP(stats.slayer?.xp || 0)
              const canAfford = (slayerPoints || 0) >= item.cost
              const levelLocked = item.slayerReq && slayerLevel < item.slayerReq
              return (
                <div
                  key={item.id}
                  style={{
                    background: '#1a1a1a',
                    border: '1px solid #2a2a2a',
                    borderRadius: '10px',
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '22px', lineHeight: 1, flexShrink: 0, opacity: levelLocked ? 0.4 : 1 }}>{item.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: levelLocked ? '#888' : '#e8d5b0' }}>{item.name}</div>
                      <div style={{ fontSize: '10px', color: '#e8d5b0', opacity: 0.38, marginTop: '1px' }}>{item.desc}</div>
                      {item.slayerReq && (
                        <div style={{ fontSize: '9px', marginTop: '2px', color: levelLocked ? '#e57373' : '#81c784', fontWeight: '600' }}>
                          💀 Slayer {item.slayerReq} required {levelLocked ? `(you: ${slayerLevel})` : '✓'}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: '12px', color: canAfford ? '#d4af37' : '#888', fontFamily: 'monospace', fontWeight: '700' }}>{item.cost} pts</div>
                    </div>
                  </div>
                  <button
                    onClick={() => !levelLocked && handleSlayerBuy(item)}
                    disabled={levelLocked}
                    style={{
                      width: '100%',
                      padding: '8px',
                      borderRadius: '8px',
                      background: levelLocked ? '#1a1a1a' : canAfford ? 'linear-gradient(135deg, #4a1a4a, #7a3a7a)' : '#222',
                      border: levelLocked ? '1px solid #333' : 'none',
                      color: levelLocked ? '#888' : canAfford ? '#f0c0f0' : '#888',
                      fontSize: '12px',
                      fontWeight: '700',
                      cursor: levelLocked || !canAfford ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {levelLocked
                      ? `Need Slayer ${item.slayerReq}`
                      : canAfford
                        ? `Buy · ${item.cost} pts`
                        : `Need ${item.cost} pts`}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* ── SHOP ITEMS TAB ── */}
        {!isUnlocksTab && !isSlayerTab && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {shop.items.map(item => {
              const qty = getQty(item.id)
              const totalCost = item.price * qty
              const canAfford = coins >= totalCost
              const skillLocked = item.requiresSkill
                ? getSkillLevel(item.requiresSkill) < item.requiresLevel
                : false

              return (
                <div
                  key={item.id}
                  style={{
                    background: '#1a1a1a',
                    border: '1px solid #2a2a2a',
                    borderRadius: '10px',
                    padding: '10px 12px',
                  }}
                >
                  {/* Item info row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '22px', lineHeight: 1, flexShrink: 0, opacity: skillLocked ? 0.4 : 1 }}>{item.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: skillLocked ? '#888' : '#e8d5b0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                      <div style={{ fontSize: '10px', color: '#e8d5b0', opacity: 0.38, marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.desc}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {skillLocked
                        ? <div style={{ fontSize: '11px', color: '#888' }}>🔒 Lv {item.requiresLevel}</div>
                        : <>
                            <div style={{ fontSize: '12px', color: '#d4af37', fontFamily: 'monospace' }}>{item.price.toLocaleString()} gp</div>
                            <div style={{ fontSize: '9px', color: '#e8d5b0', opacity: 0.3 }}>each</div>
                          </>
                      }
                    </div>
                  </div>

                  {/* Buy controls row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {/* Qty controls */}
                    <button
                      onClick={() => setQty(item.id, qty - 1)}
                      style={{ width: '26px', height: '26px', borderRadius: '6px', background: '#222', border: '1px solid #333', color: '#e8d5b0', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                    >−</button>
                    <input
                      type="number" min="1" max="9999" value={qty}
                      onInput={e => setQty(item.id, e.target.value)}
                      style={{ width: '44px', height: '26px', borderRadius: '6px', background: '#111', border: '1px solid #333', color: '#e8d5b0', fontSize: '12px', fontFamily: 'monospace', textAlign: 'center', outline: 'none' }}
                    />
                    <button
                      onClick={() => setQty(item.id, qty + 1)}
                      style={{ width: '26px', height: '26px', borderRadius: '6px', background: '#222', border: '1px solid #333', color: '#e8d5b0', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                    >+</button>
                    {/* Quick presets */}
                    {[5, 10, 100].map(n => (
                      <button
                        key={n}
                        onClick={() => setQty(item.id, n)}
                        style={{ height: '26px', padding: '0 7px', borderRadius: '6px', background: '#222', border: '1px solid #333', color: '#e8d5b0', fontSize: '10px', cursor: 'pointer', opacity: qty === n ? 1 : 0.45, flexShrink: 0 }}
                      >{n}</button>
                    ))}
                    {/* Spacer */}
                    <div style={{ flex: 1 }} />
                    {/* Buy button */}
                    <button
                      onClick={() => handleBuy(item)}
                      style={{
                        padding: '0 12px',
                        height: '28px',
                        borderRadius: '8px',
                        background: skillLocked ? '#222' : canAfford ? 'linear-gradient(135deg, #b8940e, #d4af37)' : '#222',
                        border: 'none',
                        color: skillLocked ? '#555' : canAfford ? '#0f0f0f' : '#888',
                        fontSize: '11px',
                        fontWeight: '700',
                        cursor: skillLocked || !canAfford ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {skillLocked ? 'Locked' : `Buy · ${totalCost.toLocaleString()} gp`}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}
