import gameIconsData from '../data/gameIcons.json'
import { getItemIconKey, getItemIconTint, isCryptboundChampion } from '../utils/itemIcons'

// Outline / glow palette.
const RIM = {
  white: '#ffffff', black: '#000000', red: '#d23b2f',
  green: '#2ecc71', blue: '#3498db', purple: '#9b59b6',
  gold: '#f0c040', platinum: '#e5e4e2',
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
function glowFor(id) {
  if (!id) return undefined
  if (id === 'infernal_cape') return glowing(RIM.gold)
  if (id.startsWith('2nd_age_')) return 'drop-shadow(0 0 3px #e5e4e2)'
  if (isCryptboundChampion(id) || isBlackHide(id)) return outline(RIM.white)
  const spec = OUTLINE_SPEC[id]
  if (spec) {
    const [color, glow] = spec
    return (glow ? glowing : outline)(RIM[color])
  }
  return undefined
}

/**
 * Renders a game-icons.net SVG glyph for an item.
 *
 * Props:
 *   item     — item object from itemsData (used to resolve glyph key and tint)
 *   iconKey  — override the resolved glyph key directly
 *   size     — number (px) applied as width/height, default 24
 *   color    — CSS color override; defaults to tint from item type
 *   class    — additional CSS classes
 *   title    — accessible label override; defaults to item.name
 *
 * Falls back to the item's legacy emoji when the resolved glyph is missing,
 * so un-curated items never render blank.
 */
export default function GameIcon({ item, iconKey, size = 24, color, class: cls = '', title }) {
  // In the single-file production build, gameIconsData lives in the lazily
  // loaded game chunk (it is never needed on the mobile landing/login page).
  // Before that chunk loads it is an undeclared global, so guard every access
  // with `typeof` — GameIcon then renders its emoji fallback until it arrives.
  // In the Vite web/Capacitor builds it is a static import and always defined.
  const icons = typeof gameIconsData !== 'undefined' ? gameIconsData : null
  const key   = iconKey || (icons ? getItemIconKey(item) : 'default')
  const entry = icons ? icons[key] : undefined

  if (!entry) {
    // Graceful fallback to legacy emoji during incremental curation
    return (
      <span
        class={cls}
        style={{ fontSize: typeof size === 'number' ? `${size * 0.75}px` : undefined }}
      >
        {item?.icon || '📦'}
      </span>
    )
  }

  const fill       = color || (item ? getItemIconTint(item) : 'currentColor')
  const vb         = entry.viewBox || '0 0 512 512'
  const label      = title || item?.name || key
  const px         = typeof size === 'number' ? size : undefined
  const sizeStyle  = px ? { width: px, height: px, flexShrink: 0 } : undefined
  const glow       = glowFor(item?.id)
  const style      = {
    ...(sizeStyle || {}),
    color: fill,
    ...(glow && { filter: glow })
  }

  return (
    <svg
      viewBox={vb}
      style={style}
      class={cls}
      role="img"
      aria-label={label}
      fill={fill}
      dangerouslySetInnerHTML={{ __html: entry.body }}
    />
  )
}
