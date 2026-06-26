import { meleeMaxHit, rangedMaxHit, magicMaxHit } from '../engine/formulas.js'
import { skillEmblemMask, skillArtTreatment } from './skillArt.js'

// ──────────────────────────────────────────────────────────────────────────
// Combat art system for the mobile combat redesign.
//
// Resolves a masked gradient game-icon emblem + accent colour for every monster,
// area category, and raid (mirrors the Home Screen's skill-art treatment). Glyph
// keys are vendored offline in gameIcons.json via scripts/build-game-icons.cjs.
//
// Also derives the info-sheet stats the prototype showed but the data does not
// store: a monster's weakness (from its lowest defence bonus) and its max hit
// (from the engine's max-hit helpers, keyed off attack style).
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_ART = { icon: 'crossed_swords', accent: '#cdd6e0' }

// Area category key -> emblem + accent (also the fallback for monsters in it).
export const CATEGORY_ART = {
  "training": { icon: "combat_level", accent: "#cdd6e0", blurb: "Cut your teeth on the weak" },
  "slayer": { icon: "death_skull", accent: "#c0453b", blurb: "Tasks from the Slayer Master" },
  "bossing": { icon: "crowned_skull", accent: "#d8b13a", blurb: "Generals of the eternal war" },
  "dagganoth_kings": { icon: "horned_skull", accent: "#e0564b", blurb: "The crowned tyrants" },
  "wilderness": { icon: "spectre", accent: "#8a7ae6", blurb: "High risk, high reward" },
  "dragons_lair": { icon: "dragon_head", accent: "#46a7c4", blurb: "Where the great dragons sleep" },
  "venomcoil_matriarch": { icon: "wyvern", accent: "#3fb56b", blurb: "The serpent queen of the marsh" },
  "fight_caves": { icon: "flame", accent: "#ef6b3a", blurb: "Demons of the molten deep" },
  "blighted_gauntlet": { icon: "lightning_arc", accent: "#46a0e0", blurb: "A gauntlet of the blighted" },
  "sunken_crypts": { icon: "dungeon_gate", accent: "#7f8c95", blurb: "The restless dead stir below" },
  "ashveil_highlands": { icon: "cut_palm", accent: "#8db04a", blurb: "Beasts of the ashen wilds" },
  "ironhold_fortress": { icon: "anvil", accent: "#9aa3ac", blurb: "Guardians of the iron keep" },
  "verdant_wilds": { icon: "wolf_trap", accent: "#5fae5f", blurb: "Predators of the deep wood" },
}

// Raid id -> emblem + accent.
export const RAID_ART = {
  "vaults_of_xyren": { icon: "temple_gate", accent: "#9b6cff" },
  "crimson_night_theatre": { icon: "ancient_columns", accent: "#c0453b" },
  "cryptbound_champions": { icon: "stone_tower", accent: "#8b9a8f" },
  "tomb_of_arasmus": { icon: "crowned_skull", accent: "#a855f7" },
}

// Monster id -> emblem + accent (accent inherited from its area / raid).
export const MONSTER_ART = {
  "field_chicken": { icon: "chicken", accent: "#cdd6e0" },
  "cave_goblin": { icon: "goblin_head", accent: "#cdd6e0" },
  "pasture_bull": { icon: "bull", accent: "#cdd6e0" },
  "broodfang_spider": { icon: "hanging_spider", accent: "#cdd6e0" },
  "stoneback_crab": { icon: "crab", accent: "#cdd6e0" },
  "duneback_crab": { icon: "crab", accent: "#cdd6e0" },
  "tidereaper_crab": { icon: "crab", accent: "#c0453b" },
  "highland_giant": { icon: "ogre", accent: "#cdd6e0" },
  "briar_giant": { icon: "ogre", accent: "#cdd6e0" },
  "ember_giant": { icon: "ogre", accent: "#e07030" },
  "arcane_adept": { icon: "pointy_hat", accent: "#cdd6e0" },
  "umbral_adept": { icon: "pointy_hat", accent: "#cdd6e0" },
  "lesser_fiend": { icon: "daemon_skull", accent: "#cdd6e0" },
  "elder_tree_spirit": { icon: "tree_face", accent: "#cdd6e0" },
  "elder_rock_golem": { icon: "rock_golem", accent: "#cdd6e0" },
  "dustpaw_rat": { icon: "rat", accent: "#c0453b" },
  "wailing_banshee": { icon: "floating_ghost", accent: "#c0453b" },
  "bogling_sprite": { icon: "fairy", accent: "#c0453b" },
  "frostbite_imp": { icon: "imp", accent: "#c0453b" },
  "marshfen_toad": { icon: "frog", accent: "#c0453b" },
  "cinderpaw_cub": { icon: "tiger_head", accent: "#c0453b" },
  "glaive_skeleton": { icon: "skeleton", accent: "#c0453b" },
  "mirebound_husk": { icon: "shambling_zombie", accent: "#c0453b" },
  "verdant_stalker": { icon: "high_shot", accent: "#c0453b" },
  "stoneglare_basilisk": { icon: "horned_reptile", accent: "#c0453b" },
  "embertongue_lizard": { icon: "lizardman", accent: "#c0453b" },
  "hollow_reaver": { icon: "grim_reaper", accent: "#c0453b" },
  "briarheart_treant": { icon: "tree_face", accent: "#c0453b" },
  "frostmaw_direwolf": { icon: "wolf_head", accent: "#c0453b" },
  "pyreclaw_demon": { icon: "devil_mask", accent: "#c0453b" },
  "sanguine_veld": { icon: "bleeding_eye", accent: "#c0453b" },
  "wraithgale_specter": { icon: "spectre", accent: "#c0453b" },
  "bloodmoon_stalker": { icon: "werewolf", accent: "#c0453b" },
  "warped_spectre": { icon: "spectre", accent: "#c0453b" },
  "ironfang_drake": { icon: "spiked_dragon_head", accent: "#c0453b" },
  "ash_wyrm": { icon: "snake", accent: "#c0453b" },
  "astral_ranger": { icon: "high_shot", accent: "#c0453b" },
  "shadeglass_golem": { icon: "rock_golem", accent: "#c0453b" },
  "astral_warrior": { icon: "gladius", accent: "#c0453b" },
  "voidweave_stalker": { icon: "masked_spider", accent: "#c0453b" },
  "hellbound_gorilla": { icon: "gorilla", accent: "#c0453b" },
  "bone_wyvern": { icon: "wyvern", accent: "#c0453b" },
  "drakthul_wyrmling": { icon: "dragon_head", accent: "#c0453b" },
  "runestone_gargoyle": { icon: "gargoyle", accent: "#c0453b" },
  "bonelight_pyromancer": { icon: "pyromaniac", accent: "#c0453b" },
  "vicious_black_dragon": { icon: "dragon_head", accent: "#7a7f88" },
  "cinderfang_reaver": { icon: "orc_head", accent: "#c0453b" },
  "ashen_marauder": { icon: "barbute", accent: "#c0453b" },
  "marshscale_shaman": { icon: "totem_head", accent: "#c0453b" },
  "nether_wraith": { icon: "spectre", accent: "#c0453b" },
  "sovrathar_the_ashen_sovereign": { icon: "crowned_skull", accent: "#c0453b" },
  "astral_mage": { icon: "wizard_staff", accent: "#c0453b" },
  "nether_demon": { icon: "daemon_skull", accent: "#c0453b" },
  "cinder_devil": { icon: "fire_silhouette", accent: "#c0453b" },
  "deepmaw_kraken": { icon: "tentacle_strike", accent: "#c0453b" },
  "nightfang_beast": { icon: "bat", accent: "#c0453b" },
  "threefang_cerberus": { icon: "wolf_head", accent: "#c0453b" },
  "ashen_hydra": { icon: "hydra", accent: "#c0453b" },
  "green_dragon": { icon: "dragon_head", accent: "#3fb56b" },
  "red_dragon": { icon: "dragon_head", accent: "#d23b2f" },
  "adamant_dragon": { icon: "dragon_head", accent: "#5e8c5e" },
  "rune_dragon": { icon: "dragon_head", accent: "#4a90d9" },
  "king_black_dragon": { icon: "dragon_head", accent: "#7a7f88" },
  "warlord_grondar": { icon: "orc_head", accent: "#d8b13a" },
  "commander_zephyra": { icon: "winged_sword", accent: "#d8b13a" },
  "krylth_the_defiler": { icon: "daemon_skull", accent: "#d8b13a" },
  "skyrender_kharra": { icon: "harpy", accent: "#d8b13a" },
  "nagadoth_rex": { icon: "dragon_head", accent: "#e0564b" },
  "nagadoth_prime": { icon: "horned_skull", accent: "#e0564b" },
  "nagadoth_supreme": { icon: "high_shot", accent: "#e0564b" },
  "crazy_archaeologist": { icon: "scroll_unfurled", accent: "#8a7ae6" },
  "venomcoil_matriarch": { icon: "wyvern", accent: "#3fb56b" },
  "ember_tyrant": { icon: "volcano", accent: "#ef6b3a" },
  "ashen_crucible": { icon: "volcano", accent: "#ef6b3a" },
  "blighted_gauntlet": { icon: "gauntlet", accent: "#46a0e0" },
  "muttadile": { icon: "reptile_tail", accent: "#9b6cff" },
  "vespula": { icon: "wasp_sting", accent: "#9b6cff" },
  "nylocas_vasilias": { icon: "spider_alt", accent: "#c0453b" },
  "sotetseg": { icon: "crystal_ball", accent: "#c0453b" },
  "xarpus": { icon: "scorpion", accent: "#c0453b" },
  "verzik_vitur": { icon: "queen_crown", accent: "#c0453b" },
  "the_great_olm": { icon: "tentacle_strike", accent: "#9b6cff" },
  "the_maiden_of_sugadinti": { icon: "bleeding_heart", accent: "#c0453b" },
  "pestilent_bloat": { icon: "vomiting", accent: "#c0453b" },
  "tekton": { icon: "anvil_impact", accent: "#9b6cff" },
  "gravehusk_brute": { icon: "shambling_zombie", accent: "#7f8c95" },
  "boneclaw_revenant": { icon: "skeleton", accent: "#7f8c95" },
  "shroudwraith_specter": { icon: "spectre", accent: "#7f8c95" },
  "stonegale_elemental": { icon: "rock_golem", accent: "#8db04a" },
  "cindermaw_serpent": { icon: "snake", accent: "#8db04a" },
  "thornhide_colossus": { icon: "tree_face", accent: "#8db04a" },
  "ironclad_guardian": { icon: "mighty_force", accent: "#9aa3ac" },
  "emberhowl_warlord": { icon: "orc_head", accent: "#9aa3ac" },
  "gravethorn_drake": { icon: "spiked_dragon_head", accent: "#5fae5f" },
  "razorwing_harpy": { icon: "harpy", accent: "#5fae5f" },
  "dravok_the_wretched": { icon: "daemon_skull", accent: "#8b9a8f" },
  "gorath_the_infested": { icon: "maggot", accent: "#8b9a8f" },
  "kaelor_the_tainted": { icon: "high_shot", accent: "#8b9a8f" },
  "morvyn_the_blighted": { icon: "wizard_staff", accent: "#8b9a8f" },
  "torvek_the_corrupted": { icon: "orc_head", accent: "#8b9a8f" },
  "verin_the_defiled": { icon: "horned_skull", accent: "#8b9a8f" },
  // Tomb of Arasmus bosses — bespoke desert-tomb icons.
  "khareth_the_shadowbound": { icon: "tomb_khareth", accent: "#9b6cff" },
  "gorroth_the_mountain_ape": { icon: "tomb_gorroth", accent: "#b08d57" },
  "khepra_the_scarab_matron": { icon: "tomb_khepra", accent: "#3fb5a8" },
  "sebakh_the_devourer": { icon: "tomb_sebakh", accent: "#6f9e5e" },
  "warden_of_arasmus": { icon: "tomb_warden", accent: "#d8b13a" },
}

// Attack style (monsters.json attackStyle) -> chip glyph + colour. The melee
// sub-styles (stab/slash/crush) collapse to a single "Melee" chip.
export const STYLE_ART = {
  stab:   { icon: 'gladius',      color: '#e0564b', label: 'Melee'  },
  slash:  { icon: 'gladius',      color: '#e0564b', label: 'Melee'  },
  crush:  { icon: 'gladius',      color: '#e0564b', label: 'Melee'  },
  melee:  { icon: 'gladius',      color: '#e0564b', label: 'Melee'  },
  ranged: { icon: 'high_shot',    color: '#7bbf52', label: 'Ranged' },
  magic:  { icon: 'crystal_ball', color: '#9b6cff', label: 'Magic'  },
}

// Resolve a monster's emblem + accent, falling back to its category then default.
export function getMonsterArt(monster, categoryKey) {
  if (monster && MONSTER_ART[monster.id]) return MONSTER_ART[monster.id]
  if (categoryKey && CATEGORY_ART[categoryKey]) return CATEGORY_ART[categoryKey]
  return DEFAULT_ART
}

export function getCategoryArt(categoryKey) {
  return CATEGORY_ART[categoryKey] || DEFAULT_ART
}

export function getRaidArt(raidId) {
  return RAID_ART[raidId] || { icon: 'temple_gate', accent: '#9b6cff' }
}

export function getStyleArt(style) {
  return STYLE_ART[style] || STYLE_ART.melee
}

// Colours for multi-style chips (single-style chips use the style's own
// colour from STYLE_ART).
const MULTI_ALL_COLOR = '#f0c040'    // gold — all three combat styles
const MULTI_TWO_COLOR = '#cdd6e0'    // silver — two styles

const STYLE_LABEL = { melee: 'Melee', ranged: 'Ranged', magic: 'Magic' }

// Normalise any attack/defence style key to one of the three combat groups.
function styleGroup(style) {
  if (style === 'stab' || style === 'slash' || style === 'crush' || style === 'melee') return 'melee'
  if (style === 'ranged') return 'ranged'
  if (style === 'magic') return 'magic'
  return null
}

// Shape a set of combat-style groups into a chip descriptor:
//   - 3 distinct styles → gold "All"
//   - 2 distinct styles → silver "Melee & Ranged" (etc.)
//   - 1 style           → that style's own colour
// `prefix` (e.g. 'Weak: ') is prepended to the label. Returns null when empty.
function multiStyleChip(styles, prefix = '') {
  if (!styles || styles.length === 0) return null
  const ordered = ['melee', 'ranged', 'magic'].filter(s => styles.includes(s))
  if (ordered.length >= 3) {
    return { styles: ordered, label: prefix + 'All', color: MULTI_ALL_COLOR, tier: 'all' }
  }
  if (ordered.length === 2) {
    return {
      styles: ordered,
      label: prefix + ordered.map(s => STYLE_LABEL[s]).join(' & '),
      color: MULTI_TWO_COLOR,
      tier: 'multi',
    }
  }
  return {
    styles: ordered,
    label: prefix + STYLE_LABEL[ordered[0]],
    color: getStyleArt(ordered[0]).color,
    tier: 'single',
  }
}

// Derive a monster's weakness from its lowest defence bonus, collapsing
// stab/slash/crush into a single "melee" group. Ties are meaningful:
//   - all three styles equal  → weak to "All"  (gold)
//   - two styles tied lowest   → e.g. "Melee & Ranged" (silver)
//   - a single lowest style    → that style (its own colour)
// Returns { styles, label, color, tier } or null when no defence data exists.
export function getMonsterWeakness(monster) {
  const d = monster && monster.defenceBonus
  if (!d) return null
  const melee = Math.min(d.stab ?? Infinity, d.slash ?? Infinity, d.crush ?? Infinity)
  const groups = [
    ['melee', melee],
    ['ranged', d.ranged ?? Infinity],
    ['magic', d.magic ?? Infinity],
  ].filter(([, v]) => Number.isFinite(v))
  if (groups.length === 0) return null

  const lowest = Math.min(...groups.map(([, v]) => v))
  const styles = groups.filter(([, v]) => v === lowest).map(([k]) => k)
  return multiStyleChip(styles)
}

// Derive the attack style(s) a monster uses. Multi-form bosses (e.g. Venomcoil
// Matriarch) attack with a different style per form, so collect the distinct
// styles across all forms; single-form monsters use their top-level attackStyle.
//   - 3 distinct styles → "All" (gold)
//   - 2 distinct styles → e.g. "Melee & Magic" (silver)
//   - 1 style           → that style (its own colour)
// Returns { styles, label, color, tier } or null when no style data exists.
export function getMonsterAttackStyles(monster) {
  if (!monster) return null
  const raw = monster.multiForm && monster.forms
    ? Object.values(monster.forms).map(f => f.attackStyle)
    : [monster.attackStyle]
  const styles = [...new Set(raw.map(styleGroup).filter(Boolean))]
  return multiStyleChip(styles)
}

// Derive a monster's max hit at render time from its own stats, keyed off attack
// style. This is an approximation (monsters carry no authored maxHit) shown as a
// plain "Max Hit" figure in the info sheet.
export function getMonsterMaxHit(monster) {
  if (!monster || !monster.stats) return 0
  const style = monster.attackStyle
  if (style === 'ranged') {
    return rangedMaxHit(monster.stats.ranged || 1, monster.strengthBonus || 0)
  }
  if (style === 'magic') {
    // Magic monsters carry no spell object; approximate the spell base damage
    // from their magic level so the helper yields a sensible figure.
    return magicMaxHit(monster.stats.magic || 1)
  }
  // stab / slash / crush / melee / undefined → melee
  return meleeMaxHit(monster.stats.strength || 1, monster.strengthBonus || 0)
}

// Convenience: build the masked-emblem mask + metallic treatment in one call,
// so combat components can render the same art technique as SkillEmblem.
export function combatEmblem(iconKey, accent) {
  return { mask: skillEmblemMask(iconKey), treatment: skillArtTreatment(accent) }
}
