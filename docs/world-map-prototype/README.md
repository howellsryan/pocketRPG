# World Map prototype (Claude design)

Source design for the **map-driven overhaul** (see `docs/map-driven-overhaul-plan.md`).
This is a standalone vanilla prototype produced in Claude design — **not** wired into
the Preact app. It exists as the UX/visual reference for implementation sessions.

## Files
- `index.html` — page skeleton: top bar, map stage, travel banner, legend, map
  controls, place-hub side sheet, toast.
- `world/world-data.js` — the world model: `window.WORLD` with `places` (nodes),
  `edges` (road graph `[from, to, ticks]`), `tiers`, and activity `kinds`.
- `world/world.js` — prototype logic: Dijkstra shortest-path travel, pan/zoom,
  token animation along legs, tick progress bar, place-hub rendering, localStorage
  persistence of current location.
- `world/world.css` — the "Forgemark" look (parchment-in-iron).

## Not included (external deps the prototype references but the zip omits)
These must be sourced from the main app / design system, not invented:
- **`styles.css`** — defines the `--fm-*` design tokens (`--fm-ember`, `--fm-parch`,
  `--fm-serif`, `--fm-tex-iron`, `--fm-r-frame`, etc.). The prototype is unstyled
  without them.
- **`assets/glyphs.js`, `assets/bespoke-glyphs.js`, `assets/icon-inline.js`** — the
  `data-icon` inline-SVG injector (`window.PRPGfillIcons`). The app already has an
  icon system (`GameIcon`, `src/data/gameIcons.json`); reuse that, don't port this.
- **`image-slot.js`** — the drop-your-own-art `<image-slot>` web component used for
  place banners.

## Status of behaviour
Travel and location persistence are real in the prototype but local-only. Activity
cards are placeholder taps (`toast(...)`). The overhaul plan describes how each maps
onto the real app's screens, save blob, and idle engine.
