---
paths:
  - "video/**"
  - "tests/videoRecipe.test.ts"
---

# Video pipeline rules

Path-scoped rule — auto-loads when working on `video/**`. Full usage and rationale: `video/README.md`. These are the traps that cost a render each when got wrong.

## Capture

- **Never go back to Playwright's `recordVideo`.** It ignores `deviceScaleFactor` (a 2x context records 1x content padded into the frame), hardcodes ~1 Mbit/s VP8, and emits VFR. It was tried and rejected; it looks like the simpler option and is not.
- **`Page.startScreencast` needs explicit `maxWidth`/`maxHeight`.** Unlike `page.screenshot()` it does **not** apply `deviceScaleFactor`. Omit them and capture silently comes out at the CSS viewport (390x694) instead of 1080x1920 — it fails as a bad-looking video, not an error, which is why `render.mjs` asserts the finished file's dimensions, codec, fps and square pixels.
- Screencast pushes a frame only on repaint, and this UI repaints once or twice a second. The pump holds the last frame and emits on a fixed cadence; it is **wall-clock authoritative**, so a slow click costs no duration. Don't convert it to a naive per-frame `setInterval` write.
- Reset the sample aspect (`setsar=1`) on any scale. Scaling a slightly-off source leaves a non-square SAR that encodes 1080x1920 but *displays* off-ratio.

## Driving the game

- **`nav`/`click` take an accessible name, never visible text or a CSS selector.** The nav labels itself with `aria-label` + visually-hidden text, so Playwright's `hasText` (rendered text only) matches nothing and fails as a 30s timeout. Top bar is `Map`, `Bank`, `Combat`, `Items`, `Equip`.
- **Not everything clickable is a button.** The mobile monster rows are a `div` with an `onClick` and no role (`CombatMobileSelect.jsx`), so `getByRole` cannot reach them — that is what the `text` action is for. Reach for it only when `click` genuinely cannot see the control.
- Useful targets: skill screens open from the home card (`Magic, level`) then `Skill Actions`. Alchemy is `High Alchemy` then the item's name in the "Select item to Alchemize" modal. The bank is `Bank` then `Store and manage your items`.
- **Alchemy pays into the BANK, not the inventory** (`skilling.js`, "alchemy banks"). A recipe showing alch profit must end on the bank or the payoff is invisible.
- Every driving failure must throw. Silently filming the wrong screen is worse than a failed render.
- The overlay must stay click-through at **every** level (`#pr-video-overlay, #pr-video-overlay *`). `pointer-events: none` on the container alone does not stop Playwright's hit-test on children.

## Overlay geometry

Safe-zone and font values are **frame pixels** (the 1080x1920 encode) and are divided by `deviceScaleFactor` on the way into CSS. Mixing the two puts the hook mid-screen at triple size. `CAPTION_FONT_SIZE` in `recipe.mjs` must match `overlay.mjs`'s `captionSize`, or the pre-flight fit check validates a size that is not the one drawn.

## What can be filmed

Demo mode locks Store and Leaderboard, and **locks every boss** (`CombatScreen.jsx`, `demoBossLocked`). Lifting that means changing shipped game gating — ask the user first, don't add a bypass flag uninstructed.

The Combat and Equipment screens have no 3D view (removed) — the Equipment screen always renders the paper doll, so there's no `Enable3dRender` build step to reach for.

## Boundaries

- `video/` is outside `tsconfig.typecheck.json` (`src/**/*.js`) and the coverage config (`src/**`, `functions/**`). Keep it that way — it is tooling, not shipped game code.
- Tests are logic-only: `recipe.mjs` and `seed.mjs` are pure and unit-tested. Do not add browser or ffmpeg work to `npm test`.
- `video/out` is gitignored. Never commit a rendered MP4 — CI publishes the render as a GitHub Release asset instead (below), which is downloadable without touching the repo's history.
- Seeding writes IndexedDB on a throwaway demo profile only. It is not a save editor — real characters go through skill `save-item-grant`.

## CI (`.github/workflows/render-video.yml`)

Manual (`workflow_dispatch`) only — takes a recipe name and an `enable_3d`
toggle, runs the same pipeline in CI, and publishes the MP4 as a GitHub
Release asset (a direct file link — downloads cleanly from a phone browser;
an Actions artifact is a zip and does not). A run is a few minutes end to end:
`npm ci` + a cached-when-possible Playwright Chromium install + the game
build all happen before the render itself, which is the only part under a
minute. Don't promise sub-minute total time from this workflow.
