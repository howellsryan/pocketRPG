import gameIconsData from '../data/gameIcons.json'
import bespokeIconsData from '../data/bespokeIcons.json'
import { resolveItemIcon } from '../utils/itemIconResolve'

/**
 * Renders an item's icon: PocketRPG-owned bespoke art where it exists, else the
 * tinted game-icons glyph.
 *
 * Props:
 *   item     — item object from itemsData (used to resolve glyph key and tint)
 *   iconKey  — override the resolved key directly
 *   size     — number (px) applied as width/height, default 24
 *   color    — CSS color override; defaults to tint from item type
 *   class    — additional CSS classes
 *   title    — accessible label override; defaults to item.name
 *
 * Resolution lives in `src/utils/itemIconResolve.js` because the open world
 * client draws the same items from the same descriptor — see its header.
 *
 * Both icon maps ship in the lazily loaded game chunk in the single-file build
 * (they are never needed on the landing/login page), where they are undeclared
 * globals until it arrives — so guard each with `typeof` and render the "no
 * icon" placeholder until then. In the Vite web/Capacitor builds they are
 * static imports and always defined.
 */
export default function GameIcon({ item, iconKey, size = 24, color, class: cls = '', title }) {
  const icon = resolveItemIcon(item, {
    bespoke: typeof bespokeIconsData !== 'undefined' ? bespokeIconsData : null,
    glyphs:  typeof gameIconsData !== 'undefined' ? gameIconsData : null,
    iconKey,
    color,
  })

  if (icon.kind === 'none') {
    return (
      <span
        class={cls}
        style={{ fontSize: typeof size === 'number' ? `${size * 0.75}px` : undefined }}
      >
        {item?.icon || '📦'}
      </span>
    )
  }

  const px        = typeof size === 'number' ? size : undefined
  const sizeStyle = px ? { width: px, height: px, flexShrink: 0 } : undefined
  const style     = {
    ...(sizeStyle || {}),
    ...(icon.tint && { color: icon.tint }),
    ...(icon.glow && { filter: icon.glow }),
  }

  return (
    <svg
      viewBox={icon.viewBox}
      style={style}
      class={cls}
      role="img"
      aria-label={title || icon.label}
      {...(icon.tint ? { fill: icon.tint } : {})}
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  )
}
