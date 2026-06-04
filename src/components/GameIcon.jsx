import gameIconsData from '../data/gameIcons.json'
import { getItemIconKey, getItemIconTint, isCryptboundChampion } from '../utils/itemIcons'

// Items that get a white rim outline (their fill is near-black, so the rim
// traces the silhouette against the dark UI).
const WHITE_OUTLINE_IDS = new Set(['ring_of_affliction', 'staff_of_the_dead'])

// Near-black hide/leather items (armour or crafting material) — white rim so
// the black silhouette reads on the dark UI.
function isBlackHide(id) {
  return id.startsWith('black_') &&
    (id.includes('_d_hide_') || id.includes('dragon_leather') || id.includes('dragonhide'))
}

// Items that get a black rim outline to define their coloured silhouette.
const BLACK_OUTLINE_IDS = new Set([
  'amulet_of_torment', 'necklace_of_agony', 'afflicted_bracelet',
  'berserker_ring', 'archers_ring', 'seers_ring',
  'kodai_hat', 'kodai_robe_top', 'kodai_robe_bottom',
])

// game-icons glyph paths are authored with fill="currentColor", which resolves
// to the CSS `color` property — NOT the svg `fill` attribute. So the tint drives
// `color` (see below). Some items additionally get an SVG `drop-shadow` filter:
//   • a prestige glow (infernal cape gold, 2nd age platinum),
//   • a white rim outline for black items (cryptbound champions, black
//     dragonhide, ring of affliction) so the black silhouette reads, or
//   • a black rim outline to define a coloured silhouette.
function glowFor(id) {
  if (!id) return undefined
  if (id === 'infernal_cape') {
    return 'drop-shadow(0 0 3px #f0c040) drop-shadow(0 0 1.5px #f0c040)'
  }
  if (id.startsWith('2nd_age_')) {
    return 'drop-shadow(0 0 3px #e5e4e2)'
  }
  if (isCryptboundChampion(id) || isBlackHide(id) || WHITE_OUTLINE_IDS.has(id)) {
    return 'drop-shadow(0 0 1px #ffffff) drop-shadow(0 0 0.5px #ffffff)'
  }
  if (BLACK_OUTLINE_IDS.has(id)) {
    return 'drop-shadow(0 0 1px #000000) drop-shadow(0 0 0.5px #000000)'
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
