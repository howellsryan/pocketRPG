import { getItemIconKey, getItemIconTint, isCryptboundChampion } from './itemIcons.js'

// One resolver for both clients. The idle game (`GameIcon.jsx`) and the open
// world (`world/client/src/itemIcon.ts`) render an item's icon from the
// descriptor this returns, so an item can never look like two different things
// depending on which client is drawing it. Neither icon map is imported here —
// both are passed in, because the world lazy-loads its ~1 MiB bespoke set on
// world entry and the single-file build ships both maps in the game chunk.

// Item ids that share one bespoke icon body, recoloured per variant. The three
// Summoning charm tiers use the same engraved-plate art, tinted by BESPOKE_TINT.
export const BESPOKE_ALIAS = {
  green_charm: 'charm', red_charm: 'charm', blue_charm: 'charm',
}
const BESPOKE_TINT = {
  green_charm: 'var(--tier-jewel-green)',
  red_charm:   'var(--tier-jewel-red)',
  blue_charm:  'var(--tier-jewel-blue)',
}

// Outline / glow palette.
const RIM = {
  white: '#ffffff', black: '#000000', red: '#d23b2f',
  green: '#2ecc71', blue: '#3498db', purple: '#9b59b6',
  gold: '#f0c040', platinum: '#e5e4e2', runeforged: '#b7e4ff',
}
// Tight rim outline vs a stronger "glowing" halo.
const outline = (c) => `drop-shadow(0 0 1px ${c}) drop-shadow(0 0 0.5px ${c})`
const glowing = (c) => `drop-shadow(0 0 3px ${c}) drop-shadow(0 0 1.5px ${c})`

// Per-item rim outline spec: [palette colour, glowing?].
const OUTLINE_SPEC = {
  // White rim — black-filled items so their silhouette reads on the dark UI.
  ring_of_affliction:  ['white', false],
  staff_of_the_dead:   ['white', false],
  amulet_of_fury:      ['white', false],
  gargoyle_maul:       ['white', false],
  spiked_manacles:     ['white', false],
  black_wizard_hat:    ['white', false],
  black_wizard_robe:   ['white', false],
  ferocious_gloves:    ['white', false],
  gloves_of_slaughter: ['white', false],
  slayer_defender:     ['white', false],
  avernal_defender:    ['white', false],
  slayer_helmet:       ['white', false],
  // Black rim — defines a coloured silhouette.
  amulet_of_torment:   ['black', false],
  necklace_of_agony:   ['black', false],
  afflicted_bracelet:  ['black', false],
  berserker_ring:      ['black', false],
  archers_ring:        ['black', false],
  seers_ring:          ['black', false],
  kodai_hat:           ['black', false],
  kodai_robe_top:      ['black', false],
  kodai_robe_bottom:   ['black', false],
  ancient_maul:        ['black', true],
  occult_necklace:     ['black', true],
  // Wrath rune — red body with a black rim so it reads as "red & black".
  wrath_rune:          ['black', true],
  // Red rim
  colossal_ballista:   ['red', false],
  nightfang_bow:       ['red', false],
  nether_demon_whip:   ['red', false],
  durn_s_bulwark:      ['red', false],
  visage_shield:       ['red', true],
  scythe_of_vythar:    ['red', true],
  abyssal_tentacle:    ['red', true],
  ghraxis_rapier:      ['white', true],
  // Venom weapons — blowpipe: green body + purple rim; trident: purple body + green glow
  venom_blowpipe:      ['purple', false],
  trident_of_venom:    ['green', true],
  serpentine_helm:     ['blue', false],
  imbued_god_cape:     ['blue', false],
  // Green rim
  warped_buckler:      ['green', false],
  twisted_longbow:     ['green', true],
  // Purple rim
  ancestral_wand:      ['purple', true],
  // Tomb of Arasmus uniques — purple shadow glow (Masari set: black body, red shadow)
  shadow_of_tumaken:   ['purple', true],
  fang_of_osmun:       ['purple', true],
  ward_of_elidria:     ['purple', true],
  sunbearer_ring:      ['purple', true],
  masari_mask:         ['red', true],
  masari_body:         ['red', true],
  masari_chaps:        ['red', true],
  // Gem bolts — gem-coloured rim over material-tier body
  ruby_dragon_bolt:          ['red',        false],
  ruby_dragon_bolt_e:        ['red',        false],
  diamond_dragon_bolt:       ['white',      false],
  diamond_dragon_bolt_e:     ['white',      false],
  dragonstone_dragon_bolt:   ['purple',     false],
  dragonstone_dragon_bolt_e: ['purple',     false],
  onyx_dragon_bolt:          ['red',        false],
  onyx_dragon_bolt_e:        ['red',        false],
  ruby_bolt:                 ['red',        false],
  ruby_bolt_e:               ['red',        false],
  diamond_bolt:              ['white',      false],
  diamond_bolt_e:            ['white',      false],
  dragonstone_bolt:          ['purple',     false],
  dragonstone_bolt_e:        ['purple',     false],
  onyx_bolt:                 ['runeforged', false],
  onyx_bolt_e:               ['runeforged', false],
  // Onyx gems/jewellery — black body, white rim
  onyx:                      ['white',      false],
  uncut_onyx:                ['white',      false],
  onyx_amulet:               ['white',      false],
  // Zyrite gems/jewellery — black body, red rim
  zyrite:                    ['red',        false],
  uncut_zyrite:              ['red',        false],
  zyrite_amulet:             ['red',        false],
  zyrite_bracelet:           ['red',        false],
  zyrite_necklace:           ['red',        false],
  zyrite_ring:               ['red',        false],
  zyrite_shard:              ['red',        false],
}

// Near-black hide/leather items (armour or crafting material) — white rim so
// the black silhouette reads on the dark UI.
function isBlackHide(id) {
  return id.startsWith('black_') &&
    (id.includes('_d_hide_') || id.includes('dragon_leather') || id.includes('dragonhide'))
}

// game-icons glyph paths are authored with fill="currentColor", which resolves
// to the CSS `color` property — NOT the svg `fill` attribute. So the tint drives
// `color` (see below). Some items additionally get an SVG `drop-shadow` filter:
//   • a prestige glow (infernal cape gold, 2nd age platinum),
//   • a white rim outline for black items (cryptbound champions, black
//     dragonhide) so the black silhouette reads, or
//   • a per-item coloured rim/glow from OUTLINE_SPEC.
export function glowFor(id, type) {
  if (!id) return undefined
  if (id === 'infernal_cape' || id === 'max_cape' || id === 'infernal_max_cape') return glowing(RIM.gold)
  if (id.startsWith('2nd_age_')) return 'drop-shadow(0 0 3px #e5e4e2)'
  if (isCryptboundChampion(id) || isBlackHide(id)) return outline(RIM.white)
  const spec = OUTLINE_SPEC[id]
  if (spec) {
    const [color, glow] = spec
    return (glow ? glowing : outline)(RIM[color])
  }
  if (type === 'food') return glowing('#a0622a')
  return undefined
}

/**
 * Resolves how an item should be drawn, in the same order in every client.
 *
 *   item     — item object from items.json (may be a bare `{ id }`)
 *   bespoke  — bespokeIcons.json map, or null if it hasn't loaded yet
 *   glyphs   — gameIcons.json map, or null if it hasn't loaded yet
 *   iconKey  — render this key directly instead of resolving from the item
 *   color    — tint override
 *
 * Returns `{ kind, body, viewBox, tint, glow, label }`. `kind` is:
 *   'bespoke' — PocketRPG-owned full-colour art, rendered as authored. `tint`
 *               is null unless the entry is `tintable` (one shape recoloured
 *               per variant, e.g. the three charm tiers).
 *   'glyph'   — a game-icons line-art glyph; `tint` drives BOTH the svg `fill`
 *               and CSS `color` (the paths use currentColor), `glow` is an
 *               optional CSS filter.
 *   'none'    — nothing renderable; the caller shows its own placeholder.
 *
 * @typedef {{ body: string, viewBox?: string|null, tintable?: boolean }} IconEntry
 * @typedef {{ kind: 'bespoke'|'glyph'|'none', body: string|null, viewBox: string|null,
 *             tint: string|null, glow: string|null, label: string }} ResolvedIcon
 * @param {{ id?: string, name?: string, type?: string }|null|undefined} item
 * @param {{ bespoke?: Record<string, IconEntry>|null, glyphs?: Record<string, IconEntry>|null,
 *           iconKey?: string|null, color?: string|null }} [options]
 * @returns {ResolvedIcon}
 */
export function resolveItemIcon(item, { bespoke = null, glyphs = null, iconKey = null, color = null } = {}) {
  const id = item?.id
  const bespokeKey = iconKey || BESPOKE_ALIAS[id] || id
  const entry = bespoke && bespokeKey ? bespoke[bespokeKey] : undefined
  if (entry) {
    const tint = entry.tintable
      ? (color || BESPOKE_TINT[id] || (item ? getItemIconTint(item) : 'currentColor'))
      : null
    return {
      kind: 'bespoke', body: entry.body, viewBox: entry.viewBox || '0 0 512 512',
      tint, glow: null, label: item?.name || bespokeKey,
    }
  }

  const key = iconKey || (glyphs ? getItemIconKey(item) : null)
  const glyph = key && glyphs ? glyphs[key] : undefined
  if (!glyph) {
    return { kind: 'none', body: null, viewBox: null, tint: null, glow: null, label: item?.name || id || key || '' }
  }

  return {
    kind: 'glyph',
    body: glyph.body,
    viewBox: glyph.viewBox || '0 0 512 512',
    tint: color || (item ? getItemIconTint(item) : 'currentColor'),
    glow: glowFor(id, item?.type) || null,
    label: item?.name || key,
  }
}
