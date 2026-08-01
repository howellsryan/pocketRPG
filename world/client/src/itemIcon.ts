// Unified item icons: the world draws every item through the SAME resolver as
// the idle game (src/utils/itemIconResolve.js), so an item can never show one
// icon here and another there. Bespoke full-colour art (src/data/bespokeIcons.json)
// wins; anything without it falls back to the same tinted game-icons glyph the
// idle game would draw. The bespoke set (~1 MiB) is lazy-loaded as its own chunk
// during world entry — never in the initial bundle — via loadItemIcons().
//
// Tints arrive as `var(--token)` CSS custom properties from src/index.css, which
// this client does not load (and which cannot resolve at all inside the `data:`
// SVG that loot.ts rasterises into a canvas texture), so every tint is resolved
// to a literal hex by resolveIconTint before it reaches the markup.
import itemsData from '../../../src/data/items.json'
import { resolveIconTint } from '../../../src/utils/iconTints.js'

type IconEntry = { body: string; viewBox?: string | null; tintable?: boolean }
type Resolve = typeof import('../../../src/utils/itemIconResolve.js')['resolveItemIcon']

const items = itemsData as unknown as Record<string, { icon?: string; name?: string } | undefined>
let bespoke: Record<string, IconEntry> | null = null
// game-icons glyphs (currentColor line art) — the fallback for items with no
// bespoke art, and the source for HUD icons that have none (e.g. the logout door).
let glyphs: Record<string, IconEntry> | null = null
// The resolver is loaded here rather than imported at the top because its own
// static dependency tree pulls in gameIcons.json (~325 KiB) — importing it
// eagerly moves that into the world's initial bundle. Every render below shows
// its placeholder until this lands, exactly as it already did for bespoke art.
let resolveItemIcon: Resolve | null = null

export async function loadItemIcons(): Promise<void> {
  if (bespoke) return
  const [b, g, r] = await Promise.all([
    import('../../../src/data/bespokeIcons.json'),
    import('../../../src/data/gameIcons.json'),
    import('../../../src/utils/itemIconResolve.js'),
  ])
  bespoke = ((b as { default?: unknown }).default ?? b) as Record<string, IconEntry>
  glyphs = ((g as { default?: unknown }).default ?? g) as Record<string, IconEntry>
  resolveItemIcon = r.resolveItemIcon
}

function svgMarkup(
  body: string, viewBox: string, sizePx: number, tint: string | null, glow: string | null,
): string {
  const colour = tint ? resolveIconTint(tint) : null
  // game-icons bodies paint with fill="currentColor", so the tint has to drive
  // the CSS `color` property as well as the fill attribute.
  const paint = colour ? ` fill="${colour}"` : ''
  const styles = [colour ? `color:${colour}` : '', glow ? `filter:${glow}` : ''].filter(Boolean).join(';')
  const style = styles ? ` style="${styles}"` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${sizePx}" height="${sizePx}"${paint}${style}>${body}</svg>`
}

/** Markup for a HUD/nav icon by its icon key (not an itemId): the bespoke
 * full-colour art if present, else the tinted game-icons glyph, else ''. Used
 * for the panel tabs (backpack/paperdoll/combat_level), the run orb (sprint)
 * and the logout door. */
export function uiIconMarkup(key: string, sizePx: number, color = 'currentColor'): string {
  if (!resolveItemIcon) return ''
  const icon = resolveItemIcon(null, { bespoke, glyphs, iconKey: key, color })
  if (icon.kind === 'none') return ''
  return svgMarkup(icon.body!, icon.viewBox!, sizePx, icon.tint, icon.glow)
}

export function itemEmoji(itemId: string): string {
  return items[itemId]?.icon ?? '❔'
}

export function itemName(itemId: string): string {
  return items[itemId]?.name ?? itemId
}

/** Standalone <svg> string for `itemId`, or null when neither bespoke art nor a
 * glyph resolves (icons not loaded yet, or an id that is not an item). */
export function iconSvgString(itemId: string, sizePx: number): string | null {
  if (!resolveItemIcon) return null
  const icon = resolveItemIcon(items[itemId] ?? { id: itemId }, { bespoke, glyphs })
  if (icon.kind === 'none') return null
  return svgMarkup(icon.body!, icon.viewBox!, sizePx, icon.tint, icon.glow)
}

/** DOM markup for an inventory cell: the resolved SVG, or an emoji placeholder. */
export function iconMarkup(itemId: string, sizePx: number): string {
  const svg = iconSvgString(itemId, sizePx)
  if (svg) return svg
  return `<span style="font-size:${Math.round(sizePx * 0.72)}px;line-height:1">${itemEmoji(itemId)}</span>`
}
