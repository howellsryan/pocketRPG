import gameIconsData from '../data/gameIcons.json'

// Per-skill emblem + accent colour for the artsy Home Screen.
// `icon` is a gameIcons.json glyph key (vendored offline from game-icons.net).
// `accent` drives the card's metallic gradient art tint and coloured glow halo.
export const SKILL_ART = {
  // Combat
  attack:        { icon: 'crossed_swords', accent: '#cdd6e0' },
  strength:      { icon: 'muscle_up',      accent: '#d9904a' },
  defence:       { icon: 'shield',         accent: '#8fa6c0' },
  hitpoints:     { icon: 'hearts',         accent: '#e8554e' },
  ranged:        { icon: 'high_shot',      accent: '#b3873f' },
  magic:         { icon: 'crystal_ball',   accent: '#9b6cff' },
  prayer:        { icon: 'prayer',         accent: '#f0c040' },
  // Gathering
  mining:        { icon: 'mining',         accent: '#9aa7b0' },
  woodcutting:   { icon: 'wood_axe',       accent: '#a9743f' },
  fishing:       { icon: 'fishing_pole',   accent: '#46a7c4' },
  farming:       { icon: 'wheat',          accent: '#d8b13a' },
  // Production
  smithing:      { icon: 'anvil',          accent: '#e07b3a' },
  cooking:       { icon: 'cooking_pot',    accent: '#e2944a' },
  crafting:      { icon: 'sewing_needle',  accent: '#c0a06a' },
  fletching:     { icon: 'arrow',          accent: '#c7ab73' },
  herblore:      { icon: 'vial',           accent: '#3fb56b' },
  runecraft:     { icon: 'rune',           accent: '#a766d6' },
  firemaking:    { icon: 'flame',          accent: '#ef6b3a' },
  // Utility
  agility:       { icon: 'sprint',         accent: '#46a0e0' },
  thieving:      { icon: 'hood',           accent: '#8a7ae6' },
  hunter:        { icon: 'wolf_trap',      accent: '#9c7a4a' },
  slayer:        { icon: 'death_skull',    accent: '#c0453b' },
  construction:  { icon: 'castle',         accent: '#9aa3ac' },
  dungeoneering: { icon: 'dungeon_gate',   accent: '#7f8c95' },
}

const DEFAULT_SKILL_ART = { icon: 'default', accent: '#cdd6e0' }

export function getSkillArt(skill) {
  return SKILL_ART[skill] || DEFAULT_SKILL_ART
}

// ── hex colour helpers (kept skill-art-local to avoid global name clashes) ──
function artChannels(hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function artTint(hex, amt) {
  const [r, g, b] = artChannels(hex)
  const m = v => Math.round(v + (255 - v) * amt)
  return `rgb(${m(r)},${m(g)},${m(b)})`
}
function artShade(hex, amt) {
  const [r, g, b] = artChannels(hex)
  const m = v => Math.round(v * (1 - amt))
  return `rgb(${m(r)},${m(g)},${m(b)})`
}
function artAlpha(hex, a) {
  const [r, g, b] = artChannels(hex)
  return `rgba(${r},${g},${b},${a})`
}

// Metallic, accent-tinted gradient + matching glow for an emblem.
export function skillArtTreatment(accent) {
  return {
    gradient: `linear-gradient(135deg, ${artTint(accent, 0.6)} 0%, ${artTint(accent, 0.12)} 50%, ${artShade(accent, 0.18)} 100%)`,
    glow: artAlpha(accent, 0.9),
    tint: accent,
  }
}

// Build an offline `mask-image` URL from a vendored glyph so a gradient-filled
// div can be masked into the icon silhouette. Returns null if the glyph is
// unknown (caller should fall back).
export function skillEmblemMask(iconKey) {
  // gameIconsData ships in the lazily-loaded game chunk in the single-file
  // build; until it loads, callers fall back (see GameIcon).
  if (typeof gameIconsData === 'undefined') return null
  const entry = gameIconsData[iconKey]
  if (!entry) return null
  const vb = entry.viewBox || '0 0 512 512'
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${vb}'>${entry.body}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}
