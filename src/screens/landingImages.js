// Landing screen image sources.
//
// Two delivery paths share this module via the same `landingImages` name:
//   • Vite builds (dev / dist) use the real files in `public/landing/`,
//     resolved against the configured base URL below.
//   • The single-file build (build_single.cjs) is served from the site root
//     with no external assets, so it STRIPS this import and injects a
//     `landingImages` global whose values are base64 data URIs read from the
//     same webp files. Keep the keys here in sync with that injection.
const base = import.meta.env.BASE_URL || '/'

export const landingImages = {
  'ss-stats': `${base}landing/ss-stats.webp`,
  'ss-combat-select': `${base}landing/ss-combat-select.webp`,
  'ss-thieving': `${base}landing/ss-thieving.webp`,
  'ss-bank': `${base}landing/ss-bank.webp`,
  'ss-quests': `${base}landing/ss-quests.webp`,
  'ss-inventory': `${base}landing/ss-inventory.webp`,
  'ss-combat': `${base}landing/ss-combat.webp`,
  'ss-farming': `${base}landing/ss-farming.webp`,
  'ss-collection': `${base}landing/ss-collection.webp`,
  'ss-trading': `${base}landing/ss-trading.webp`,
}
