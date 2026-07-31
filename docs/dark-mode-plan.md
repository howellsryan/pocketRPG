# Dark Mode — Implementation Plan (idle game only)

Status: **implemented**. This document is the design record; `DESIGN.md` §3.1 is the maintained reference and `tests/theme.test.ts` the guard. Where the build diverged from this plan, §12 records why. Scope is `src/**` (the idle game). The open-world companion (`world/**`), the admin portal (`functions/_lib/admin/portalPage.js`) and the marketing landing/auth screens are explicitly out of scope — see §7.

## 1. The finding that shapes everything

**PocketRPG already contains a dark theme.** It is the pre-Forgemark iron skin, and it is still in `src/index.css` underneath the parchment one.

DESIGN.md §2 calls this the Two-Skin Trap: every screen-prefixed class (`.cb-*`, `.wm-*`, `.clog-*`) is defined **twice** — the iron skin at the class's own definition, then a `.forge-shell .<class>` parchment override that is what actually ships. Today the game runs light because 30 of 40 screens wrap themselves in `.forge-shell`.

The numbers say the second skin is thin:

| | count |
|---|---|
| `.cb-*` rules total | 318 |
| `.forge-shell <descendant>` parchment overrides | 45 |
| …of those carrying a literal hex | **6** (all `#e6d8b6` / `#ece0c2` + `--fm-tex-parch`) |
| Screens wrapping in `.forge-shell` | 30 / 40 |
| Literal hex outside `:root` | 286 — overwhelmingly in the **base iron skin** |
| Literal hex in JSX | 472, of which 175 are SVG artwork in `PlaceArt.jsx` |
| Tailwind palette classes (`text-yellow-400` etc.) in `src/screens` + `src/components` | ~50 |

So dark mode is **not new art direction**. It is: make the parchment override layer conditional, keep Forgemark's typography and geometry unconditional, and reconcile the ~50 places where the iron skin has rotted from disuse.

This is why the plan is small. It is also why the plan is mostly **audit**, not authoring.

## 2. Token architecture

Three layers. Only the middle one is new.

**Layer 1 — raw palette (`:root`, unchanged, never flips).**
`--fm-parch`, `--fm-ink`, `--fm-iron`, `--fm-brass`, `--fm-ember`, `--color-void-*`, `--tier-*`, `--potion-*`. These are *literal colour names*. `--fm-ink` means "the dark brown ink colour" and must stay dark in both themes — it is the text colour on a brass button face (`--fm-btn-ink-on`), where flipping it would produce cream-on-cream. **Do not theme layer 1.** This is the single biggest trap in the change.

**Layer 2 — semantic surface tokens (new, flips).**

```css
:root, [data-theme="light"] {
  --surface-page:   var(--fm-vellum);    /* #e6d8b6 */
  --surface-panel:  var(--fm-parch);     /* #e9dcbd */
  --surface-raised: var(--fm-parch-hi);  /* #f3ead0 */
  --surface-sunken: var(--fm-parch-lo);  /* #d8c69e */
  --surface-tex:    var(--fm-tex-parch);
  --text-strong:    var(--fm-ink);       /* #2b2114 */
  --text-soft:      var(--fm-ink-soft);  /* #5a4a32 */
  --text-faint:     var(--fm-ink-faint); /* #8a7553 */
  --rule:           var(--fm-rule);      /* #b6a079 */
  --accent:         var(--fm-ember-deep);/* #7c2708 */
  --accent-metal:   var(--fm-brass-lo);  /* #6e521f */
}

[data-theme="dark"] {
  --surface-page:   var(--fm-soot);      /* #14110d */
  --surface-panel:  var(--fm-iron);      /* #1c1a18 */
  --surface-raised: #262220;
  --surface-sunken: #100e0b;
  --surface-tex:    var(--fm-tex-iron);
  --text-strong:    var(--fm-parch);     /* #e9dcbd */
  --text-soft:      var(--fm-rule);      /* #b6a079 */
  --text-faint:     #9d8862;             /* NOT --fm-ink-faint — see §5 */
  --rule:           #3a332b;
  --accent:         var(--fm-ember-hi);  /* #f0742a */
  --accent-metal:   var(--fm-brass-hi);  /* #e6c878 */
}
```

Nine of the twelve dark values are existing tokens re-pointed. Only three are new mid-tones. The palette was built with enough mid-tone that inversion is mostly a swap of the two extremes.

**Layer 3 — consumers.** Components read layer 2 only. Three tiers exist today:

- *Already token-driven* — `Modal.jsx` (`--color-void-light`, `--color-void-border`), `Card`, `Panel`, `Button`, most of `src/components/`. These flip for free.
- *Semi-tokenized* — `.fm-topbar`, `.fm-navrail`, the 45 forge overrides. They read `--fm-*` but the *parchment-family* ones directly. Repoint to layer 2.
- *Hardcoded* — the audit backlog. Convert to layer 2 as encountered.

## 3. The selector strategy

`data-theme` lives on `<html>`. Then:

1. **Scope the parchment half of `.forge-shell` to light.** `src/index.css:250` re-points `--color-void*`, `--color-parchment*`, and sets the page background. Split it: the font re-pointing (`--font-display`/`-body`/`-mono` → Forgemark faces) stays unconditional; the colour re-pointing moves under `[data-theme="light"] .forge-shell`.

2. **Scope the parchment button-token block to light** (`src/index.css:210` — `.forge-shell, .fm-parch, .wm-actmodal-panel, .clog-sheet:not(.is-done), .cb-qa, .fm-on-parch`). Under dark these containers simply inherit `:root`'s iron button tokens, which already exist at `src/index.css:186-194`. **Zero new declarations for the entire button system.** `.fm-on-iron` / `.fm-on-parch` keep working as local escapes in both themes.

3. **Scope the 45 forge descendant overrides to light**, then add a dark block only where the base iron skin has actually rotted (§4).

4. `.fm-parch` is the one primitive that is a *material*, not a surface — it means "vellum panel". Under dark it becomes an iron slab: background → `--surface-panel` + `--surface-tex`, `--fm-parch-inset` → an iron inset, and the warm radial in `.fm-parch::after` loses its brown cast.

The elegance is that step 2 is the whole button, toggle and tile system, and it costs nothing.

## 4. Work breakdown

**Phase 1 — token layer.** Add layer 2 to `:root`. No behaviour change; light values are identical to what ships today. Verify by diffing screenshots before/after: they must be pixel-identical.

**Phase 2 — theme plumbing.**
- `src/utils/theme.js`: `readTheme()` / `applyTheme(t)` / `resolveTheme(pref)`. Preference is `'light' | 'dark' | 'system'`; `'system'` reads `prefers-color-scheme` and subscribes to changes.
- Pre-paint stanza in `build_single.cjs`'s `<head>` (after the `<style>` block, ~line 790): read `localStorage.pocketrpg_theme`, stamp `document.documentElement.dataset.theme`. Must be in `<head>`, not the existing `<body>`-top script block — the `#app-splash` div paints before those and would flash parchment.
- `<meta name="theme-color">` swapped alongside (iOS PWA status bar).

**Phase 3 — the flip.** Steps 1–4 of §3.

**Phase 4 — the audit.** The real cost. Sweep all 40 screens and 71 components in dark and fix what the iron skin no longer covers. Prioritise by rule count: `cb-` (318) → `wm-` (136) → `clog-` (96) → `fm-` kit (89, 22 colour-carrying) → `lm-` (81) → `pm-`/`loot-`/`skill-`. Budget this as the majority of the task.

**Phase 5 — settings UI.** A three-way segmented control (`fm-toggle --sm`, Light / Dark / System) on `HelpScreen`, next to the existing `showInfoToasts` switch (`src/screens/HelpScreen.jsx:38`). Note that switch uses an inline `#444` and `style={{}}` — replace with `fm-toggle` while there, since it is the neighbouring control (DESIGN.md §6, the kit consumption rule).

**Phase 6 — tests.** §6.

## 5. Contrast: what actually fails

Measured against `--fm-iron` `#1c1a18` (WCAG AA body text needs 4.5:1):

| token | dark value | ratio | verdict |
|---|---|---|---|
| `--text-strong` | `#e9dcbd` | 12.8:1 | pass |
| `--text-soft` | `#b6a079` | 6.9:1 | pass |
| `--fm-ink-faint` | `#8a7553` | **4.2:1** | **fails** → use `#9d8862` (5.2:1) |
| `--fm-ember-deep` | `#7c2708` | **1.8:1** | **fails badly** → use `--fm-ember-hi` `#f0742a` (6.0:1) |

The ember one matters more than it looks: `--fm-ember-deep` is the value colour for `.cb-kstat__v`, `.cb-stat__v` and `.cb-mon__kc` (`src/index.css:867-868`) — every stat number on the combat screen. On dark it is near-invisible. This is exactly why `--accent` must be a semantic token and not `var(--fm-ember-deep)` at each call site.

## 6. What must never flip

- **HP/XP bars** — `--color-hp-green/yellow/red`, `--color-xp-bar`. Safety semantics, already exempted from the forge-shell repoint (`src/index.css:248`). Keep exempt.
- **Item tier + potion tints** — `--tier-*`, `--potion-*`. Data encodings (DESIGN.md §3). But two are *near-black* and will vanish on an iron panel: `--tier-cryptbound` `#1f1f1f` and `--tier-dhide-black` `#1f1f1f`. Fix with a theme-conditional 1px outline on the icon, not by changing the tint — the tint is the data.
- **`PlaceArt.jsx`** (175 hex) and `landingImages.js` — illustration, not chrome. Check the scrim/vignette contrast on dark; do not recolour the art.
- **Meaning colours** — blood/verdigris/woad/royal keep their meaning; only their *on-dark* variants brighten.
- **3D arena** (`CombatArena3D`, `three3d.js`) — scene lighting is authored, not CSS. Out of scope; note if the surrounding panel clashes.

## 7. Out of scope (flagged, not fixed)

- `world/**` — the open-world companion is a separate app with its own styling.
- `functions/_lib/admin/portalPage.js` — mirrors `:root` tokens by hand (CLAUDE.md §14) and is deliberately outside the Tailwind pipeline. Stays light-only. **If layer 2 lands, the mirrored block in the portal must be updated in the same change** or it drifts.
- `LandingScreen` / `AuthScreen` (`lp-*`, 165 rules) — pre-login marketing surface with its own art direction and a 3D hero. Theming it is a separate piece of work; the toggle is only reachable once logged in anyway.
- The inline `style={{}}` colours in `App.jsx:3545-3620` (level-up modal cards) — pre-existing DESIGN.md violations. Flag; fix only if they break in dark.

## 8. Persistence

**`localStorage` is the authority; the save blob is a hint.**

`localStorage.pocketrpg_theme` holds the preference. It must be, because the pre-paint stanza runs before any cloud sync and because the save is *locked* during an active PvP match, co-op boss session or open-world session (CLAUDE.md §14/§20). A theme change made mid-fight would be silently dropped by `sync.js`, which drops rather than queues under the co-op lock — the player would toggle the theme, see it change, and find it reverted after the fight.

Mirror it into `settings.theme` for cross-device convenience via the existing `saveSetting` path (`src/state/gameState.jsx:925` is the pattern). On load, `localStorage` wins if present; the save value seeds it on a fresh device. This is a cosmetic client setting inside the already client-trusted save blob (CLAUDE.md §14) — no server work, no migration, no endpoint.

## 9. Tests

Two new logic-only Vitest files, in the spirit of `tests/questGateProduction.test.ts` (a build-failing structural guard):

- `tests/themeTokenParity.test.ts` — parse `src/index.css`; assert every `--surface-*` / `--text-*` / `--rule` / `--accent*` declared in the light block also exists in the dark block, and vice versa. Catches the half-added token.
- `tests/themeHardcodedColors.test.ts` — assert no literal hex/rgba inside `[data-theme]`-scoped rules or the `fm-*` kit, against an explicit allowlist of the known base-skin rules. Catches drift as new screens land. Start the allowlist at the current state and only ever shrink it.

Plus the standard gate: `npm run ci` (full suite + typecheck + `rebuild` + `check:single`).

Manual QA is the real gate here — all 40 screens in both themes, plus the four modal-heavy flows (loot result, level-up, daily tasks, inventory-full prompt) which are the easiest to miss because they only appear on an event.

## 10. Risks

| risk | mitigation |
|---|---|
| Theming layer 1 by mistake (`--fm-ink` → cream) breaks brass-button text everywhere | Layer 1 is frozen; the parity test does not touch it. Call it out in DESIGN.md. |
| Flash of parchment on load | Pre-paint stanza in `<head>`, verified against `#app-splash` which paints first. |
| Iron skin has rotted in places nobody has looked at since the Forgemark pilot | That *is* phase 4; budget it as the bulk of the work, not a polish pass. |
| Theme lost after a co-op/PvP fight | localStorage is the authority (§8). |
| Admin portal token mirror drifts | Same-change update, per CLAUDE.md §14. |

## 11. Documentation

DESIGN.md gains a §3.1 "Two Themes, One Palette" covering the layer-1-is-frozen rule and the semantic token list, and §2's Two-Skin Trap gets a line: the iron skin is no longer dead code — it is the dark theme, so a base-skin rule is now load-bearing and must not be deleted as unused.

## 12. What changed during the build

Four things the plan did not anticipate, all found by the visual gate rather than by reading code:

- **Cards needed their own token.** `--surface-panel` was not enough: in light a card is the *same* vellum as the page, separated only by a rule and an inset. That hairline is too weak on iron, so `--surface-card` gives dark a genuine value step while light keeps the shipped colour exactly.
- **The texture had to blend.** `parchment.webp` *is* the vellum tone, so it can sit opaque. `iron.webp` is a mid-brown and erased whatever surface it covered — every panel collapsed to one flat colour. Dark multiplies it (`--surface-blend`).
- **The accent has two registers.** Sites that were `--fm-ember-deep` and sites that were `--fm-ember` cannot share one token: they differ in light. Hence `--accent` (deep) and `--accent-bright` (plain), which converge in dark.
- **Opacity is not a hierarchy on iron.** Faded text works on parchment because it is *darker* than the surface; on iron a faded light text sinks into it. Four labels measured 1.9–4.2:1. Dark drops the fade and lets the solid faint tone carry the hierarchy; light keeps its opacity untouched.

The plan's §9 test list also grew: the guards now cover JSX as well as CSS, and the `<head>` stanza is checked against the module it duplicates. All four were mutation-tested.
