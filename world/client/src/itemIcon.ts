// Unified item icons: reuse the main game's bespoke full-colour SVG art
// (src/data/bespokeIcons.json) so the world and the game show the same icon for
// every item. The data (~940 KiB) is lazy-loaded as its own chunk during world
// entry — never in the initial bundle — via loadItemIcons(). Items without a
// bespoke entry fall back to their items.json emoji. (A gameIcons.json glyph
// fallback with tinting could be added later; every current world item is
// bespoke, so it isn't needed yet.)
import itemsData from '../../../src/data/items.json'

type IconEntry = { body: string; viewBox?: string | null }
const items = itemsData as unknown as Record<string, { icon?: string; name?: string } | undefined>
let bespoke: Record<string, IconEntry> | null = null

export async function loadItemIcons(): Promise<void> {
  if (bespoke) return
  const mod = await import('../../../src/data/bespokeIcons.json')
  bespoke = ((mod as { default?: unknown }).default ?? mod) as Record<string, IconEntry>
}

export function itemEmoji(itemId: string): string {
  return items[itemId]?.icon ?? '❔'
}

export function itemName(itemId: string): string {
  return items[itemId]?.name ?? itemId
}

/** Standalone <svg> string for `itemId`, or null when no bespoke art exists. */
export function iconSvgString(itemId: string, sizePx: number): string | null {
  const b = bespoke?.[itemId]
  if (!b) return null
  const vb = b.viewBox || '0 0 512 512'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${sizePx}" height="${sizePx}">${b.body}</svg>`
}

/** DOM markup for an inventory cell: the bespoke SVG, or an emoji span. */
export function iconMarkup(itemId: string, sizePx: number): string {
  const svg = iconSvgString(itemId, sizePx)
  if (svg) return svg
  return `<span style="font-size:${Math.round(sizePx * 0.72)}px;line-height:1">${itemEmoji(itemId)}</span>`
}
