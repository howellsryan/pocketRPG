import gameIconsData from '../data/gameIcons.json'
import { getItemIconKey, getItemIconTint } from '../utils/itemIcons'

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
  const key   = iconKey || getItemIconKey(item)
  const entry = gameIconsData[key]

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

  return (
    <svg
      viewBox={vb}
      style={sizeStyle}
      class={cls}
      role="img"
      aria-label={label}
      fill={fill}
      dangerouslySetInnerHTML={{ __html: entry.body }}
    />
  )
}
