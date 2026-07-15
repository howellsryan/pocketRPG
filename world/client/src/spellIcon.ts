// Bespoke combat-spell icons for the Magic tab. Each of the four elements is a
// colour (wind = white, water = blue, earth = brown, fire = red); each of the
// five tiers (strike → surge, lowest requirement to highest) is a distinct
// silhouette, so a spell reads as "which element, how strong" at a glance with
// no text. Spell ids are `${element}_${tier}` (spells.json).

const ELEMENT_COLOR: Record<string, string> = {
  wind: '#eef1f4',
  water: '#3f8fd0',
  earth: '#9a6a34',
  fire: '#d0402c',
}

// Filled silhouettes on a 24×24 canvas. A thin dark outline keeps the near-white
// wind icons legible on the dark HUD panel.
const TIER_BODY: Record<string, string> = {
  // Orb with a small spark — the weakest cast.
  strike: '<circle cx="12" cy="13" r="6"/><path d="M12 2 L14 7 L10 7 Z"/>',
  // Lightning bolt.
  bolt: '<path d="M13 2 L5 13 L10.5 13 L9 22 L19 9.5 L12 9.5 Z"/>',
  // Four-point burst / sparkle.
  blast: '<path d="M12 1 L14 10 L23 12 L14 14 L12 23 L10 14 L1 12 L10 10 Z"/>',
  // Curling wave.
  wave: '<path d="M5 17 a7 7 0 1 1 9.5 -9.5 a3.4 3.4 0 1 0 -4.7 4.7 a1 1 0 0 1 -1.4 1.4 a5.4 5.4 0 1 1 7.5 -7.5 a9 9 0 0 0 -10.9 10.9 Z"/>',
  // Comet with a trailing tail — the strongest cast.
  surge: '<path d="M21 3 L10.5 11 a4.5 4.5 0 1 0 3.2 3.2 Z"/>',
}

const TIERS = ['strike', 'bolt', 'blast', 'wave', 'surge']
const ELEMENTS = ['wind', 'water', 'earth', 'fire']

/** Whether a spell id maps to a bespoke combat-spell icon. */
export function isCombatSpellIcon(spellId: string): boolean {
  const i = spellId.indexOf('_')
  if (i < 0) return false
  return ELEMENTS.includes(spellId.slice(0, i)) && TIERS.includes(spellId.slice(i + 1))
}

/** SVG markup for a combat spell's bespoke icon, or '' when the id isn't an
 * elemental combat spell. Colour = element, silhouette = tier. */
export function spellIconSvg(spellId: string, sizePx: number): string {
  const i = spellId.indexOf('_')
  const element = i < 0 ? '' : spellId.slice(0, i)
  const tier = i < 0 ? '' : spellId.slice(i + 1)
  const body = TIER_BODY[tier]
  const color = ELEMENT_COLOR[element]
  if (!body || !color) return ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}" fill="${color}" stroke="#1a140c" stroke-width="0.9" stroke-linejoin="round">${body}</svg>`
}
