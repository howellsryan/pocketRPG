// Real hex behind the `--ink-hide-*` tokens in src/index.css, for renderers
// that have no stylesheet to resolve a CSS custom property against — the
// open world's WebGL monster meshes, same problem utils/iconTints.js solves
// for item icons. Mirrors monsterFigures.js's HIDE_PALETTES names exactly;
// tests/hidePaletteParity.test.ts fails on drift from the CSS.
export const HIDE_PALETTE_HEX = {
  emerald: '#3f8f4e',
  crimson: '#b03a2c',
  obsidian: '#3b3f46',
  azure: '#3a72b6',
  verdigris: '#4f9268',
  bone: '#cec2a0',
  ash: '#6f6a62',
  ember: '#cf5b22',
  frost: '#6ea7c8',
  void: '#574a82',
  blight: '#6e8e39',
  blood: '#8d2a33',
  stone: '#7a7469',
  iron: '#8e949b',
  moss: '#5e7949',
  gold: '#c19232',
  sand: '#c2a56a',
  brine: '#2f6c77',
  arcane: '#7d5bd6',
  bark: '#6b533a',
  flesh: '#c08a68',
  dairy: '#f0ebdd',
}

export function hidePaletteHexFor(name) {
  return HIDE_PALETTE_HEX[name] || HIDE_PALETTE_HEX.flesh
}
