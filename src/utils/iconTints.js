// Concrete hex for every `:root` token an item tint can resolve to.
//
// `getItemIconTint` returns CSS custom properties, which only work where
// `src/index.css` is loaded. The open world client loads no stylesheet, and its
// ground-loot icons are rasterised into a canvas texture from a standalone
// `data:` SVG where `currentColor` and `var()` resolve to nothing at all — so
// that client needs a real colour. `tests/itemIconParity.test.ts` parses
// `src/index.css` and fails if a value here drifts from it. These are the base
// `:root` values — the dark theme's `--color-*` overrides are deliberately not
// mirrored, since the world is its own always-dark surface.
export const ICON_TINT_HEX = {
  '--color-parchment': '#f5e6c8',
  '--color-parchment-dark': '#e8d5a8',
  '--color-gold': '#d4a017',
  '--color-gold-light': '#f0c040',
  '--color-emerald-light': '#27ae60',
  '--color-mana-light': '#3498db',
  '--tier-runeforged': '#b7e4ff',
  '--tier-dragon': '#d23b2f',
  '--tier-bronze': '#b87333',
  '--tier-iron': '#8c8c8c',
  '--tier-steel': '#cdd2d8',
  '--tier-mithril': '#3550c4',
  '--tier-adamant': '#3aa55f',
  '--tier-cryptbound': '#1f1f1f',
  '--tier-ranger': '#4a8c3a',
  '--tier-dhide-black': '#1f1f1f',
  '--tier-dhide-red': '#c0392b',
  '--tier-dhide-green': '#27ae60',
  '--tier-fire-cape': '#c0392b',
  '--tier-infernal-cape': '#4a1d18',
  '--tier-partyhat-red': '#e74c3c',
  '--tier-partyhat-blue': '#3498db',
  '--tier-partyhat-green': '#2ecc71',
  '--tier-partyhat-yellow': '#f1c40f',
  '--tier-partyhat-white': '#ecf0f1',
  '--tier-partyhat-purple': '#9b59b6',
  '--tier-gold': '#f39c12',
  '--tier-2nd-age': '#e5e4e2',
  '--tier-shardglass': '#dcdbe0',
  '--tier-jewel-red': '#d23b2f',
  '--tier-jewel-green': '#2ecc71',
  '--tier-jewel-blue': '#3498db',
  '--tier-jewel-purple': '#9b59b6',
  '--tier-orange': '#e67e22',
  '--potion-attack': '#7ec8e3',
  '--potion-strength': '#f4d03f',
  '--potion-combat': '#cde6b8',
  '--potion-prayer': '#8fd96f',
  '--potion-super-attack': '#1f4eb0',
  '--potion-super-restore': '#9b59b6',
  '--potion-ranging': '#3498db',
  '--potion-super-combat': '#1e7d4f',
  '--potion-super-strength': '#ffffff',
  '--potion-super-defence': '#f4d03f',
}

const VAR_PATTERN = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i

/** Turns a tint from `getItemIconTint` into a literal colour. Hex values pass
 * through; an unmapped token falls back to parchment rather than rendering an
 * invisible icon. */
export function resolveIconTint(tint) {
  if (!tint) return ICON_TINT_HEX['--color-parchment']
  const m = VAR_PATTERN.exec(tint.trim())
  if (!m) return tint
  return ICON_TINT_HEX[m[1]] || ICON_TINT_HEX['--color-parchment']
}
