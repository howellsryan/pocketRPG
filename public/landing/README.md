# Landing screen images

These images back the marketing landing pages (`src/screens/LandingScreen.jsx`
and `DesktopLandingScreen.jsx`) via `src/screens/landingImages.js`. Two families
live here, each generated (not hand-dropped) — regenerate them when the UI or
world art changes:

## `ss-*` — in-game screenshots (Forgemark UI)

Captured from a running dev build in demo/mock-cloud mode, then downscaled to
widths `240 / 360 / 480 / 560` (`ss-x-240.webp` … `ss-x.webp`; `srcset` built by
`landingSrcSet` in `src/utils/helpers.js`). Full size is 560×1212 (phone
portrait). Current keys:

`ss-home` · `ss-worldmap` · `ss-place` · `ss-townmap` · `ss-combat` ·
`ss-bosses` · `ss-bank` · `ss-inventory` · `ss-trading` · `ss-collection` ·
`ss-leaderboard` · `ss-connect`

## `lp-*` — world-map art

Downscaled from the shipped painted art in `public/world/`:

- `lp-map` — the realm map (`public/world/map.webp`), widths `480 / 760 / 1108`.
- `lp-<placeId>` — the 14 painted place scenes (`public/world/<placeId>.webp`),
  widths `360 / 560` (560×313). Place ids match `src/data/world.json`.

Keep every key referenced by `landingImages.js` present as a full-size `.webp`
here — the single-file build (`build_single.cjs`) scans this folder to inject
the `landingImages` global (responsive `-NNN.webp` variants are skipped and
reached via `srcset`).
