// Optional PocketRPG hero logo for the Home Screen.
//
// Drop a square PNG at `public/pocketrpg-logo.png` and it is shown as the
// Home Screen hero emblem; until then the Home Screen falls back to the
// crossed-swords-on-shield crest (the <img> onError also falls back, so a
// missing file never breaks the view).
//
// Two delivery paths share the `homeLogo` name, mirroring landingImages.js:
//   • Vite builds resolve the file from `public/` against the base URL below.
//   • The single-file build (build_single.cjs) STRIPS this import and injects
//     a `homeLogo` global — a base64 data URI when the file exists, else null.
const base = import.meta.env.BASE_URL || '/'

export const homeLogo = `${base}pocketrpg-logo.png`
