# DESIGN.md — PocketRPG Visual Language

```
name: PocketRPG
description: Illuminated-ledger fantasy UI for a tick-based idle RPG — parchment, iron, brass, and ember; dense game state kept scannable one-handed.
colors:
  base: parchment, ink, gold, blood, emerald, mana, void
  forgemark: fm-parch, fm-vellum, fm-ink, fm-iron, fm-soot, fm-brass, fm-ember, fm-blood, fm-verdigris, fm-woad, fm-royal
typography:
  display: Cinzel (base) / Grenze Gotisch (Forgemark)
  body: Nunito (base) / Spectral (Forgemark)
  lore: IM Fell English (italic)
  numerals: JetBrains Mono (base) / Spline Sans Mono (Forgemark, tabular)
rounded: fm-r-sharp 2px · fm-r-sm 4px · fm-r-frame 7px — never larger (Tailwind's own radius scale is retuned to match in the @theme block)
components: fm-frame, fm-parch, fm-banner, fm-eyebrow, fm-lore, fm-num, fm-btn, fm-ledger/fm-row, fm-tag, fm-corner, fm-divider, fm-rule-head, fm-crest
source of truth: src/index.css (:root tokens) · brand brief: PRODUCT.md
```

## 1. Overview: The Blacksmith's Ledger

**Creative north star.** PocketRPG reads as an illuminated ledger kept in a blacksmith's workshop — vellum pages bound in soot-dark iron, brass rivets, ember glow. Progression is the product; the surface must make dense game state (stats, inventory, drop logs, tick-by-tick combat) feel earned and legible, not decorated. Low-fantasy grit over high-fantasy spectacle.

Key characteristics:
- Parchment surfaces carry ink; iron surfaces carry brass and ember.
- Texture is load-bearing (parchment grain, iron plate, corner ornaments), never skinned onto generic UI.
- Numbers are first-class citizens: tabular numerals, ledger rows, hairline rules.
- Every screen passes the "does this look like a game" test — never SaaS, never gacha (PRODUCT.md anti-references).
- Mobile-first, thumb-first: 44×44px minimum tap targets, one-handed layouts.

## 2. The Kit: One Vocabulary for Every Screen

*The Kit Consumption Rule.* Build screens from the Forgemark primitives below and the base tokens; do not invent a new `.screen-x-panel` / `.custom-cta` when `fm-frame` + `fm-btn--ember` already say it. New shared components go in `src/components/` and get registered in `build_single.cjs` (CLAUDE.md §9/§12).

*The Opt-In Rule.* Forgemark is piloted per screen: wrap a screen's own root in `.forge-shell` (HomeScreen, CombatScreen, WorldMapScreen). Persistent chrome (nav rail, header) stays on the base palette until the full rollout — a screen must never flip the shared shell.

*The Two-Skin Trap.* Screen-prefixed classes (`.cb-*`, `.wm-*`, `.clog-*`) are defined **twice** in `src/index.css`: the pre-Forgemark iron skin at the class's own definition, then a `.forge-shell .<class>` parchment override that is what actually ships on a piloted screen. So a neighbouring rule is never a colour template — copying one gives you a dark panel on a parchment screen. Adding a surface to a piloted screen means reusing an existing class or adding yours to that override block; a new class of your own carries **layout only**.

What's in the kit:
- **Frames & surfaces** — `fm-frame` (iron plate, riveted corners via `fm-rivet--tl/tr/bl/br`), `fm-parch` (vellum panel with `--fm-parch-inset`), `fm-corner` + `fm-divider` (SVG ornaments, `public/forge/`).
- **Type roles** — `fm-banner` (display heads, `--gilt` variant for gold-leaf fills), `fm-eyebrow` (tracked small caps), `fm-lore` (italic Fell flavour text), `fm-num` (tabular numerals).
- **Buttons** — three primitives cover every control: `fm-btn` (actions), `fm-toggle` (on/off + segments), `fm-tile` (selection cards). See §6.
- **Data** — `fm-ledger` + `fm-row` (`--head`, `--alt` zebra, `__label`/`__val` slots) for stat tables, drop logs, inventories.
- **Status** — `fm-tag` with meaning-bearing tints: `--ember` (action/heat), `--verdigris` (success/nature), `--blood` (danger), `--woad` (magic/info), `--brass` (neutral/metal).
- **Identity** — `fm-crest`, `fm-rule-head` (hairline-flanked headings).

*Tokens vs. classes.* Colors, fonts, radii, shadows, gradients, and textures are CSS variables in `src/index.css` `:root` (`var(--fm-ember)`); the `fm-*` classes compose them. Prefer Tailwind utilities + tokens for layout; never Tailwind `/N` opacity modifiers — use the solid token colors (CLAUDE.md §9).

## 3. Colors: Vellum, Iron, Ember

**Parchment (light surfaces).** `--fm-parch` `#e9dcbd` · `--fm-parch-hi` `#f3ead0` · `--fm-parch-lo` `#d8c69e` · `--fm-vellum` `#e6d8b6` (must match the base fill of `public/forge/parchment.svg`). Base palette: `--color-parchment` `#f5e6c8` / `--color-parchment-dark` `#e8d5a8`.

**Iron (dark surfaces).** `--fm-iron` `#1c1a18` · `--fm-soot` `#14110d`. Base: `--color-void` `#0f0f0f` family (`-dark`, `-light`, `-lighter`, `-border`). Dark surfaces are warm-black workshop iron, never pure blue-black chrome.

**Ink (text on parchment).** `--fm-ink` `#2b2114` · `--fm-ink-soft` `#5a4a32` · `--fm-ink-faint` `#8a7553` · hairlines `--fm-rule` `#b6a079`. Base: `--color-ink` `#1a1a0e`.

**Brass & gold (brand metal).** `--fm-brass` `#b08842` (`-hi` `#e6c878`, `-lo` `#6e521f`); base `--color-gold` `#d4a017` (`-light`, `-dim`). Gilt text uses `--fm-gilt-text` gradient, not flat yellow.

**Ember (primary action).** `--fm-ember` `#c2410c` (`-hi` `#f0742a`, `-deep` `#7c2708`); button faces use `--fm-ember-face` gradient.

**State & meaning.** `--fm-blood` `#7f1d1d` / base blood family (damage, danger) · `--fm-verdigris` `#2f6b5e` / emerald family (success, XP `--color-xp-bar` `#3cb043`) · `--fm-woad` `#2c4a73` / mana family (magic) · `--fm-royal` `#5b3a86` (rare/prestige). HP traffic-lights: `--color-hp-green/yellow/red`.

**Game-data tints.** Equipment-tier (`--tier-*`) and potion (`--potion-*`) variables color item icons — they are data encodings, not brand colors; never repurpose them for chrome.

Color rules:
- *The Brass Carries Brand Rule.* If one accent must say "PocketRPG", it is brass/gold on iron or ink on vellum — never ember. Ember is reserved for the primary action.
- *The Meaning Is Sacred Rule.* Blood = danger, verdigris/emerald = success, woad/mana = magic, ember = act now. Never use a state color decoratively.
- *The Warm Dark Rule.* Dark surfaces lean warm (`#1c1a18`, not `#111827`). No cool grays anywhere.
- *The No Candy Rule.* Nothing oversaturated or glossy-gacha. Saturation peaks at the ember CTA and item-tier icons.

## 4. Typography: Ledger Heads, Workshop Numbers

Display is **Grenze Gotisch** (fallback Cinzel) — blackletter-adjacent, used only for banners and screen titles. Body is **Spectral** (Forgemark) / **Nunito** (base screens). Lore and flavour text is **IM Fell English**, always italic. Numerals are **Spline Sans Mono** / JetBrains Mono with `font-variant-numeric: tabular-nums`.

Hierarchy:
- Screen banner — `fm-banner`, Grenze Gotisch 800, tight (1.0) line-height; gilt variant for the rare hero moment.
- Section eyebrow — `fm-eyebrow`, Spectral 600, 12px, 0.34em tracking, uppercase, ink-faint.
- Body/labels — Spectral/Nunito 600 for labels, regular for prose.
- Lore — `fm-lore`, Fell italic, ink-soft, 1.5 line-height.
- Numbers — `fm-num` everywhere a quantity appears: stats, XP, coins, timers, damage.

Typography rules:
- *The Tabular Number Rule.* Any value that ticks (XP, HP, coins, timers) uses tabular numerals so columns never shimmy at 600ms cadence.
- *The Two-Face Rule.* Display face for identity moments only; never set body copy or buttons in Grenze Gotisch (buttons use the display face at 800 sparingly via `fm-btn`).
- *The Lore Is Seasoning Rule.* Fell italic is flavour, one or two lines — never paragraphs, never UI labels.

## 5. Elevation and Material

Shadow vocabulary:
- Frame setback — `--fm-frame-shadow`: hard 2px drop + deep 28px soft + inner top-light + 1px inset ring. The standard iron-frame treatment.
- Parchment inset — `--fm-parch-inset`: inner shadow + 1px warm ring; vellum sits *into* the frame, it does not float.
- Ember lift — hover on `--ember` buttons: brightness + `0 7px 20px -6px rgba(240,116,42,0.8)` glow. The only glow in the system.
- No default card shadow — flat hairline (`--fm-rule`) first; shadow only via the named treatments above.

Material rules:
- *The Hairline First Rule.* Separate with 1px `--fm-rule` lines and `fm-divider` ornaments before reaching for shadow or background shifts.
- *The Texture Pays Rent Rule.* Parchment/iron textures (`--fm-tex-*`) and corner ornaments appear where they explain the material; opacity ≤ 0.5, never watermark spam.
- *The Pressed Metal Rule.* Interactive feedback is physical: buttons translate down 1px on press and take an inset press shadow (`--fm-btn-press`); rivets and frames use the `--fm-rivet` radial. Buttons carry bevel *relief* (`--fm-btn-relief`), never a drop shadow — they sit in the page, not above it. No glassmorphism, no blur, ever.
- *The Reduced Motion Rule.* Every animated effect (skill pulses, hit flashes, toasts) has a `prefers-reduced-motion` alternative (PRODUCT.md accessibility baseline).
- *The Ease Rule.* Transitions use `--fm-ease` `cubic-bezier(0.2, 0.9, 0.3, 1)` at `--fm-dur` 0.16s — quick, mechanical, no bounce.

## 6. Components

- **Buttons** — one pressed-metal language, three primitives:
  - `fm-btn` — actions. Variants `--ember` (primary, one per view), `--brass`, `--iron`, `--ghost`, plus the meaning faces `--blood` / `--verdigris` / `--woad` / `--royal` (§3). Sizes `--sm` / `--lg`.
  - `fm-toggle` — anything that reads ON or OFF: idle switches, attack stances, tab strips (`--stack` + `fm-toggle__n` for a count), filter chips (`--sm`).
  - `fm-tile` — selection cards in a grid: item slots, prayers, spells (`fm-tile__name` + `fm-tile__sub`).

  Shared contract: ON is matte struck brass with ink text — never a gloss, never a glow. Press is `translateY(1px)` plus an inset press shadow. Disabled/locked is a **solid dead face with faint ink**, never an opacity fade (a dimmed tile is illegible on parchment and on iron alike). Radius `--fm-r-sm`, tap area ≥ 44×44px, brass `:focus-visible` ring.

  The resting face follows the surface, not the screen: `--fm-btn-face/-ink/-edge/-relief/-press/-dead*` are iron at `:root` and re-pointed to vellum by `.forge-shell`, `.fm-parch` and the other parchment containers (`.fm-on-parch` / `.fm-on-iron` opt a nested panel either way). Button rules read the tokens and never hard-code a face — including the named screen classes (`.cb-*`, `.wm-*`). Add a variant to the kit before inventing a bespoke button.
- **Panels** — `fm-frame` (iron, rivets at 8px corners) wrapping `fm-parch` (vellum content). Corner ornaments at 7px inset, opacity 0.5.
- **Ledgers** — `fm-ledger` for every stat/inventory/log table: `fm-row--head` under a 2px ink rule, zebra via `--alt`, values right-aligned in `fm-num`.
- **Tags** — `fm-tag` small-caps chips; tint by meaning (§3), never by aesthetics.
- **Headings** — `fm-rule-head` flanks section titles with gradient hairlines; eyebrow above, banner below.
- **Progress** — XP bars in `--color-xp-bar` green; HP bars traffic-light by threshold. Bars are flat fills on inset tracks, no gradients-for-decoration.
- **Screen shells** — piloted screens wrap in `.forge-shell`; non-piloted screens stay on the base parchment/void palette until ported. Both must coexist without visual whiplash: shared spacing, shared meaning colors.

## 7. Do and Do Not

Do:
- Build from `fm-*` primitives and `:root` tokens; extend the kit in `src/index.css` when something is genuinely missing.
- Keep every quantity in tabular numerals and every table a ledger.
- Use ember for exactly one primary action per view.
- Keep dense state scannable one-handed — legibility over spectacle, always.
- Give every animation a reduced-motion fallback.

Do not:
- No flat SaaS dashboards, sterile card grids, or generic admin chrome.
- No candy-gacha styling: no oversaturated gradients, no gem-shop sparkle, no bubbly rounded-2xl corners (max radius 7px).
- No glassmorphism, backdrop blur, or cool-gray dark mode.
- No Tailwind `/N` opacity modifiers or inline `style={{}}` for static values.
- No repurposing tier/potion/state colors as decoration.
- No copying a screen-prefixed class's colours as a starting point for a new one — see the Two-Skin Trap (§2).
- No new top-level identity fonts; the four faces above are the whole cast.

## 8. Before You Ship: The Critique Pass

Two passes, not one: plan the screen, then critique the plan before writing CSS. A rule-by-rule read (§7) catches violations; this catches *generic* — output that breaks no rule but reads as anyone's app.

- **Signature.** Name the one thing a player remembers from this screen. If the answer is "a card grid", rebuild — the illuminated-ledger identity must surface somewhere (frame, crest, ledger rule, or the ember CTA).
- **The default tell.** Would this pass as a stock dashboard with the palette swapped in? If yes, you defaulted — return to the `fm-*` primitives.
- **The game test.** PRODUCT.md: never SaaS, never gacha. Dense state should feel earned and legible, not like an admin panel or a gem shop.
