// Landing screen image sources.
//
// Two delivery paths share this module via the same `landingImages` name:
//   • Vite builds (dev / dist) use the real files in `public/landing/`,
//     resolved against the configured base URL below.
//   • The single-file build (build_single.cjs) is served from the site root
//     with no external assets, so it STRIPS this import and injects a
//     `landingImages` global built by scanning `public/landing/` for every
//     full-size `.webp` (responsive `-NNN.webp` variants are skipped and
//     referenced via `srcset`). Keep any key you reference present as a file
//     in that folder so both paths resolve.
//
// `ss-*` — in-game screenshots (Forgemark UI). `lp-*` — world-map art: the
// realm map (`lp-map`) and the 14 painted place scenes keyed by place id.
const base = import.meta.env.BASE_URL || '/'
const L = (name) => `${base}landing/${name}.webp`

export const landingImages = {
  'ss-home':        L('ss-home'),
  'ss-worldmap':    L('ss-worldmap'),
  'ss-place':       L('ss-place'),
  'ss-townmap':     L('ss-townmap'),
  'ss-combat':      L('ss-combat'),
  'ss-bosses':      L('ss-bosses'),
  'ss-bank':        L('ss-bank'),
  'ss-inventory':   L('ss-inventory'),
  'ss-trading':     L('ss-trading'),
  'ss-collection':  L('ss-collection'),
  'ss-leaderboard': L('ss-leaderboard'),
  'ss-connect':     L('ss-connect'),

  'lp-map':        L('lp-map'),
  'lp-lumbright':  L('lp-lumbright'),
  'lp-varrick':    L('lp-varrick'),
  'lp-faloden':    L('lp-faloden'),
  'lp-ardounne':   L('lp-ardounne'),
  'lp-draynar':    L('lp-draynar'),
  'lp-alkarid':    L('lp-alkarid'),
  'lp-edgevale':   L('lp-edgevale'),
  'lp-barlock':    L('lp-barlock'),
  'lp-catherra':   L('lp-catherra'),
  'lp-seerhold':   L('lp-seerhold'),
  'lp-brimhollow': L('lp-brimhollow'),
  'lp-canifel':    L('lp-canifel'),
  'lp-camlann':    L('lp-camlann'),
  'lp-portsarin':  L('lp-portsarin'),
}
