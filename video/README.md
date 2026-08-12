# video — TikTok clips from the real game

Renders vertical gameplay videos by driving the actual built game in a headless
browser. Everything runs locally against demo mode: no account, no server, no
paid service.

```bash
npm run rebuild                                   # build first (index.html is generated)
node video/render.mjs video/recipes/zero-to-hero.json
# -> video/out/zero-to-hero.mp4  (1080x1920, H.264, 30fps)
```

Output is gitignored — a render exists only in that run's `video/out/`, so
grab it before the container goes away.

## Rendering from a phone

The **Render Video** GitHub Action (`.github/workflows/render-video.yml`) runs
the same pipeline in CI and publishes the result as a GitHub Release asset —
a direct file link, so it downloads cleanly from a mobile browser (unlike an
Actions artifact, which is a zip).

Actions tab → **Render Video** → **Run workflow** → pick a recipe name (no
`.json`) → run. When it finishes, the run's summary links straight to the
release with the MP4 attached.

Budget a few minutes, not one: checkout, `npm ci`, a cached-when-possible
Playwright Chromium install, the game build, and the render itself all happen
before anything is downloadable. The render step alone is well under a
minute; the surrounding CI setup is what adds the rest.

Upload the result to TikTok yourself and add a trending sound in-app — that
reaches further than anything bakeable into the file.

## Writing a recipe

A recipe is a shot list. New video = new JSON, no new code.

```json
{
  "id": "my-clip",
  "hook": "Text that stops the scroll",
  "hookMs": 3500,
  "outro": "PocketRPG — free in your browser",
  "seed": { "levels": { "all": 1 } },
  "scenes": [
    { "action": "hold",   "holdMs": 3000, "caption": "Shown at the bottom" },
    { "action": "reseed", "holdMs": 2600, "seed": { "levels": { "all": 99 } } },
    { "action": "nav",    "target": "Equip", "holdMs": 4000 }
  ]
}
```

**Actions**: `hold` (just record), `nav` / `click` (by accessible name), `text`
(by visible text), `back`, `scroll` (`deltaY`), `reseed` (jump the character
forward).

Use `text` when `click` cannot see the control. Parts of this UI hang `onClick`
on a plain `div` with no role — the mobile monster rows (`cb-mon`) are the ones
that matter — so `getByRole` finds nothing and `click` times out.

**`target` is an accessible name, not a CSS selector or visible text.** The nav
buttons label themselves with `aria-label` and visually-hidden text, so matching
on rendered text finds nothing — `Map`, `Bank`, `Combat`, `Items`, `Equip` are
the top bar. A wrong target fails the render and drops a screenshot at
`video/out/<id>-failure.png`.

**`reseed`** writes levels, equipment, inventory and bank straight into
IndexedDB and reloads. That is how a progression montage is possible without
playing for 200 hours. Recording pauses across the reload, so the video jump-cuts
between states instead of showing a boot screen.

## What it can and cannot film

Demo mode locks two things, so neither can appear in a video:

- **Store and Leaderboard** are cloud-only screens.
- **Every boss is locked** (`CombatScreen.jsx`, `demoBossLocked`). Lifting that
  needs a deliberate change to shipped game gating — ask before adding one.

The 63 non-boss monsters, all skilling, quests, bank, equipment and the world map
are all fair game.

## Why it is built this way

**CDP screencast, not Playwright's `recordVideo`.** `recordVideo` ignores
`deviceScaleFactor` (a 2x context still records 1x content padded into the
frame), hardcodes ~1 Mbit/s VP8 with no quality option, and emits variable frame
rate. All three are disqualifying at 1080x1920.

**Screencast needs explicit `maxWidth`/`maxHeight`.** Unlike `page.screenshot()`
it does *not* apply `deviceScaleFactor` on its own — omit them and the capture
silently comes out at the CSS viewport (390x694). `render.mjs` asserts the
finished file's dimensions for exactly this reason.

**A fixed-cadence pump.** Screencast only pushes a frame when the page repaints,
and this UI repaints once or twice a second. The pump holds the last frame and
emits on a fixed cadence, converting that to true CFR. It is wall-clock
authoritative, so a slow click costs no duration.

**Captions render in the page, not in ffmpeg.** The page already has the game's
fonts and palette, so captions come out on-brand for free and ffmpeg stays a
pure encoder. Positions are in *frame* pixels and divided by `deviceScaleFactor`
on the way into CSS — mixing those up puts the hook in the middle of the screen
at triple size.

**Not Xvfb + `x11grab`.** Headed Chromium under Xvfb hung here, and it would be
Linux-only.

## Layout

| path | role |
| --- | --- |
| `render.mjs` | orchestrator; serves the build, drives it, verifies the output |
| `lib/recipe.mjs` | schema, timeline maths, caption fitting — pure, unit-tested |
| `lib/seed.mjs` | IndexedDB character seeding |
| `lib/drive.mjs` | the action vocabulary |
| `lib/capture.mjs` | CDP screencast → CFR → H.264 |
| `lib/overlay.mjs` | in-page caption/hook layer |
| `lib/serve.mjs` | static file server for the build |

Pure logic is covered by `tests/videoRecipe.test.ts` and runs in `npm test`.
Chromium resolves via `PLAYWRIGHT_CHROMIUM`, then `/opt/pw-browsers/chromium`;
ffmpeg via `FFMPEG_PATH`, then the `ffmpeg-static` devDependency.
