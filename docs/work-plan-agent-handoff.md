# Agent Handoff Work Plan

This document is a concrete, ready-to-execute plan for an implementing agent. It covers six work
items. Each section lists the exact files, schemas, computed values, edge cases, tests, and the
commit gate. Read CLAUDE.md first — its invariants (Math.floor rounding, Title Case item names,
data-contract tests, single-file build rules) apply throughout.

## Ground rules (apply to every item)

- **Source-of-truth edits only**: edit `src/**` and `src/data/**`. Do **not** hand-edit the
  generated root `index.html` — it is produced by `npm run rebuild`.
- **Item naming**: every new item `name` field is **Title Case** (e.g. "Black Dragonhide Body").
- **Rounding**: all gameplay numbers use `Math.floor()`.
- **Data contracts**: `tests/data-contracts.test.ts` auto-validates that every skill action's
  `product` and every `materials` key resolves to a real item in `src/data/items.json`. Add items
  **before/with** the recipes or this test fails.
- **Commit gate (required, do not skip)**: before committing run either
  `npm test && npm run build && npm run rebuild && npm run check:single`, or `npm run ci && npm test`.
- Keep changes minimal and scoped; no unrelated refactors. Update/extend tests with new logic.

---

## Item 1 — Crafting: add Black d'hide body, Black d'hide chaps, Red d'hide chaps

### Files
- Recipes: `src/data/skills.json` → `crafting.actions` (existing dragonhide recipes around lines
  1318–1663; pattern to mirror).
- Items: `src/data/items.json`.

### Recipe schema (mirror existing dragonhide entries)
```json
{
  "id": "red_d_hide_chaps",
  "name": "Craft red d'hide chaps",
  "level": 73,
  "ticks": 5,
  "xp": 124,
  "product": "red_d_hide_chaps",
  "materials": { "red_dragon_leather": 2 }
}
```

### What already exists (confirmed)
- Leather inputs: `green_dragon_leather`, `blue_dragon_leather`, `red_dragon_leather`,
  `black_dragon_leather` all exist in `items.json`.
- Output items: `black_d_hide_body` and `black_d_hide_chaps` **already exist** as items
  (~lines 13614 / 13648). `red_d_hide_body` exists (~line 1470).
- Existing reference recipes: green chaps (lvl 57, xp 62, 2 leather), green body (lvl 63, xp 186,
  3 leather), red body (lvl 75, xp 225, 4 leather).

### What is missing
- **Item to create**: `red_d_hide_chaps` (it does not exist in `items.json`). Model it on the
  existing `red_d_hide_body` entry — copy its structure, change to the legs slot, set Title Case
  name "Red Dragonhide Chaps", and give it sensible stats (legs slot ranged armour; mirror the
  body's defensive style but lower, consistent with how green/blue chaps relate to their bodies).
- **3 crafting recipes** to add to `crafting.actions`.

### Values to use (OSRS-accurate; consistent with existing dhide neighbours)
Dragonhide armour uses the OSRS pattern of **chaps = 2 leather, body = 3 leather**. Note the
codebase's existing `red_d_hide_body` uses 4 leather — keep the new entries OSRS-accurate (2/3) and
do **not** retrofit existing recipes (out of scope). Use:

| Recipe | level | ticks | xp | materials |
|---|---|---|---|---|
| Craft red d'hide chaps  | 73 | 5 | 124 | `red_dragon_leather`: 2 |
| Craft black d'hide chaps | 79 | 5 | 172 | `black_dragon_leather`: 2 |
| Craft black d'hide body  | 84 | 6 | 258 | `black_dragon_leather`: 3 |

(IDs: `red_d_hide_chaps`, `black_d_hide_chaps`, `black_d_hide_body` — match the product item ids.)

### Tests
- `tests/data-contracts.test.ts` will validate the new recipes' product/materials resolve.
- Check `tests/itemIcons.test.ts` — it asserts icon mappings for dhide items; if it enumerates
  every dhide piece, add a mapping/entry for `red_d_hide_chaps` (and confirm icons exist for the
  black pieces). Run `npm test -- itemIcons` to see.

---

## Item 2 — Smithing: add all iron / steel / mithril / adamant / runeforged armour + weapons

### Files
- Recipes: `src/data/skills.json` → `smithing.actions` (existing recipes ~lines 262–700).
- Items: `src/data/items.json`.

### Recipe schema (mirror existing smithing entries)
```json
{
  "id": "smith_steel_platebody",
  "name": "Smith steel platebody",
  "level": 47,
  "ticks": 5,
  "xp": 187,
  "product": "steel_platebody",
  "materials": { "steel_bar": 5 }
}
```
Use `ticks: 5` (the existing smithing convention). `productQty` is only for multi-output recipes
(bolts); omit for single items.

### Decisions already made by the user (apply these)
1. **Strict OSRS bar counts** (NOT the existing 1-bar simplification). E.g. platebody = 5 bars,
   platelegs/plateskirt/kiteshield/chainbody = 3 bars, full helm/square shield/2h sword/claws = 2
   bars, etc.
2. **XP follows OSRS** (xp = bars × OSRS xp-per-bar; floor any fraction).
3. **Levels follow OSRS**, EXCEPT: **armour** in the **mithril, adamant, and runeforged** tiers has
   its level requirement **reduced ~20%** (`floor(osrsLevel × 0.8)`). Iron & steel armour keep OSRS
   levels. **All weapons** keep OSRS levels (no reduction). Only armour pieces in those three tiers
   are reduced.

> Note: the existing runeforged **weapon** recipes in the codebase use inflated XP (e.g. rune axe
> 400 xp). The user wants **OSRS XP** for the new additions, so new runeforged items use OSRS XP
> (e.g. rune platebody 375). Do **not** retrofit the existing weapon recipes (out of scope) — but
> call out the resulting inconsistency in the PR description.

### Reference constants
**Tier level offsets** (verified against existing codebase recipes — bronze base + offset):
Iron `+14`, Steel `+29`, Mithril `+49`, Adamant `+69`, Runeforged `+84`.

**OSRS bronze base level + bar count per item type:**

| Item | base lvl | bars |
|---|---|---|
| Dagger | 1 | 1 |
| Axe | 1 | 1 |
| Mace | 2 | 1 |
| Medium helm | 3 | 1 |
| Sword | 4 | 1 |
| Scimitar | 5 | 2 |
| Longsword | 6 | 2 |
| Full helm | 7 | 2 |
| Square shield | 8 | 2 |
| Warhammer | 9 | 3 |
| Battleaxe | 10 | 3 |
| Chainbody | 11 | 3 |
| Kiteshield | 12 | 3 |
| Claws | 13 | 2 |
| Two-handed sword | 14 | 3 |
| Plateskirt | 16 | 3 |
| Platelegs | 16 | 3 |
| Platebody | 18 | 5 |

**XP per bar by tier:** Iron 25, Steel 37.5, Mithril 50, Adamant 62.5, Runeforged 75.
So `xp = floor(bars × xpPerBar)`.

### Computed ARMOUR recipe table (levels already reduced where required)

Levels: iron/steel = OSRS (base+offset); mithril/adamant/runeforged = `floor(OSRS × 0.8)`.

| Armour (bars) | Iron lvl/xp | Steel lvl/xp | Mithril lvl/xp | Adamant lvl/xp | Runeforged lvl/xp |
|---|---|---|---|---|---|
| Medium helm (1) | 17 / 25 | 32 / 37 | 41 / 50 | 57 / 62 | 69 / 75 |
| Full helm (2) | 21 / 50 | 36 / 75 | 44 / 100 | 60 / 125 | 72 / 150 |
| Square shield (2) | 22 / 50 | 37 / 75 | 45 / 100 | 61 / 125 | 73 / 150 |
| Chainbody (3) | 25 / 75 | 40 / 112 | 48 / 150 | 64 / 187 | 76 / 225 |
| Kiteshield (3) | 26 / 75 | 41 / 112 | 48 / 150 | 64 / 187 | 76 / 225 |
| Plateskirt (3) | 30 / 75 | 45 / 112 | 52 / 150 | 68 / 187 | 80 / 225 |
| Platelegs (3) | 30 / 75 | 45 / 112 | 52 / 150 | 68 / 187 | 80 / 225 |
| Platebody (5) | 32 / 125 | 47 / 187 | 53 / 250 | 69 / 312 | 81 / 375 |

(Bar item ids: `iron_bar`, `steel_bar`, `mithril_bar`, `adamant_bar`, `runeforged_bar`; quantity =
the bars number for that row.)

### Computed WEAPON recipe table (OSRS levels, no reduction)

| Weapon (bars) | Iron lvl/xp | Steel lvl/xp | Mithril lvl/xp | Adamant lvl/xp | Runeforged lvl/xp |
|---|---|---|---|---|---|
| Dagger (1) | 15 / 25 | 30 / 37 | 50 / 50 | 70 / 62 | 85 / 75 |
| Sword (1) | 18 / 25 | 33 / 37 | 53 / 50 | 73 / 62 | 88 / 75 |
| Mace (1) | 16 / 25 | 31 / 37 | 51 / 50 | 71 / 62 | 86 / 75 |
| Scimitar (2) | 19 / 50 | 34 / 75 | 54 / 100 | 74 / 125 | 89 / 150 |
| Longsword (2) | 20 / 50 | 35 / 75 | 55 / 100 | 75 / 125 | 90 / 150 |
| Claws (2) | 27 / 50 | 42 / 75 | 62 / 100 | 82 / 125 | 97 / 150 |
| Warhammer (3) | 23 / 75 | 38 / 112 | 58 / 150 | 78 / 187 | 93 / 225 |
| Battleaxe (3) | 24 / 75 | 39 / 112 | 59 / 150 | 79 / 187 | 94 / 225 |
| Two-handed sword (3) | 28 / 75 | 43 / 112 | 63 / 150 | 83 / 187 | 98 / 225 |

(Axe, pickaxe, scimitar and bolts recipes already exist for these tiers — do **not** duplicate
them. `check:single`/data-contract duplication will not catch duplicate recipe ids in JSON, so
verify by searching `skills.json` before adding each id.)

### Execution steps (important — do an audit first)
1. **Audit `items.json`**: for every tier×type cell above, determine whether the equipment item
   already exists (research confirms platebody/platelegs/full helm exist for all 5 tiers;
   kiteshield exists only for bronze; most weapon types beyond axe/pickaxe/scimitar/dagger do
   **not** exist). Produce a checklist of existing vs missing items.
2. **Phase A — recipes for existing items**: add a smithing recipe for every armour/weapon item
   that already exists in `items.json` but lacks a recipe, using the tables above.
3. **Phase B — create missing items, then their recipes**: for cells whose item is missing, create
   the item in `items.json` by **mirroring the stat block of the same slot in an adjacent tier**
   (e.g. base a steel chainbody's combat bonuses on the existing steel platebody / iron chainbody
   pattern, scaling between tiers). Title Case names, correct equipment slot, finite positive
   `shopValue`. Then add the recipe.
   - ⚠️ New equipment items require **combat-bonus stats**, which is a balancing decision. Mirror
     existing tier patterns; if a slot has no precedent at any tier to model from, flag it for the
     user rather than inventing numbers blind.
4. Keep recipe `id`s consistent: `smith_<tier>_<type>` (match the existing naming, e.g.
   `smith_steel_scimitar`).

### Tests
- `tests/data-contracts.test.ts` validates products/materials resolve.
- Consider extending `tests/gatherInventoryRouting.test.ts` (the only smithing-aware test) with one
  representative new recipe (e.g. steel platebody consuming 5 steel bars) to lock material
  consumption + XP.

---

## Item 3 — Trading Post: pagination on the listings page

### File
- `src/screens/TradingPostScreen.jsx` — `renderListings()` (~lines 602–643). All listings come from
  `allListings` state (~line 68), populated by `refreshListings()` (~lines 143–151) via
  `api.tradingPostListings()`. Currently `allListings.map(renderListingRow)` renders everything with
  no paging. There is **no existing pagination component** to reuse.

### Approach (client-side pagination — simplest, no API change)
1. Add `const [listingsPage, setListingsPage] = useState(0)` and a `const PAGE_SIZE = 20` (pick a
   mobile-friendly count).
2. Derive the visible slice with `useMemo`:
   `allListings.slice(listingsPage * PAGE_SIZE, (listingsPage + 1) * PAGE_SIZE)`.
3. Render Prev / Next controls + a "Page X of Y" indicator below the list. Disable Prev on page 0
   and Next on the last page. Total pages = `Math.ceil(allListings.length / PAGE_SIZE)`.
4. Reset `listingsPage` to 0 whenever the underlying list changes (e.g. after `refreshListings()` or
   when a search/filter narrows results) so you never land on an out-of-range page.
5. Use the shared `Button` component already imported in this screen; respect the 44×44px min tap
   target and existing Tailwind/CSS-variable styling conventions (no `/N` opacity modifiers).

> Server-side pagination (adding `offset`/`limit` to the `/api/trading-post/listings` handler) is an
> option if list sizes are large, but is more invasive. Recommend client-side first unless the list
> is expected to be very large.

### Tests
- This is presentational; add a small unit test only if you extract a pure paging helper. Otherwise
  rely on the build/`check:single` gate.

---

## Item 4 — Offers: block instant-sell until partially-sold items are collected

### File
- `src/screens/TradingPostScreen.jsx`.
  - Offer schema fields: `quantity_total`, `quantity_remaining`, `coins_pending`, `items_pending`,
    `status`, `price` (see `renderOffer` ~line 460+).
  - "Sold X of Y" = `filled = quantity_total - quantity_remaining` (~line 462).
  - `hasPending = coinsPending > 0 || itemsPending > 0` (~line 473).
  - Instant-sell button render (~lines 516–519): shown when
    `!isReady && offer.offer_type === 'sell' && offer.quantity_remaining > 0`.
  - Instant-sell handler `handleInstantSell` (~lines 354–369) — **no guard today**.
  - Collect handler `handleCollect` (~lines 371–398); Collect button shown when `hasPending`.

### Required behaviour
When a sell offer has partially sold (some units filled, with pending coins to collect) and the
player taps **Instant Sell**, force them to **Collect first**.

### Approach (guard + UX, both)
1. **Hard guard in `handleInstantSell`** (authoritative): at the top of the handler, recompute
   `hasPending` for the target offer (look it up from `myOffers` by id rather than trusting a stale
   closure). If pending, `addToast('Collect your sold items first.', 'error')` and `return` before
   calling `api.tradingPostInstantSell`.
2. **UX in the button** (~lines 516–519): when `hasPending`, either hide the Instant Sell button and
   show only **Collect**, or keep it visible but `disabled` with a tooltip/label hint. Recommended:
   prioritise the Collect action — render Collect (already present when `hasPending`) and suppress
   Instant Sell while `hasPending` is true, so there is a single obvious next step.
3. Make sure the guard uses the same `isReadyToCollectOffer`/`hasPending` logic already defined in
   the file (~lines 23–28) so behaviour is consistent.

> Note: this is a client-side UX guard. If the server `/api/trading-post/instant-sell` handler does
> not already reject instant-sell while coins are pending, that is the real authority — but per the
> task scope (offers screen behaviour) the client guard is the deliverable. If you want
> belt-and-suspenders, check the handler under `functions/api/trading-post/` and add a matching
> server rejection; flag if you do, as it widens scope.

### Tests
- Extend `tests/tradingPost.test.ts` (covers instant-sell payout, partial collect) with a case
  asserting that an offer with `coins_pending > 0` / `items_pending > 0` is not instant-sellable
  (or that the handler rejects it, if you add the server guard).

---

## Item 5 — Bank: fix search "✕" clear button overlapped by "Edit tab" on mobile

### File
- `src/screens/BankScreen.jsx`.
  - Header row container (~line 533): `class="flex items-center gap-2 mb-2"`.
  - Search input wrapper (~line 538): `class="w-32 flex items-center ..."` inside a
    `flex-1 flex justify-center` column; the clear button (~line 549) sits inside the input wrapper
    with `ml-1 flex-shrink-0` (no z-index, no absolute positioning).
  - "Edit tab" button (~lines 556–564): `class="text-[10px] ... px-2 py-1 ... flex-shrink-0"`.

### Root cause
On narrow (mobile) viewports the flex row squeezes: the `flex-1` centering column and the
fixed-width (`w-32`) search box leave the `flex-shrink-0` "Edit tab" button to encroach on the
search box's right edge, visually covering the ✕ clear button. No `min-w-0`, no stacking context, no
responsive layout branch exists.

### Approach (pick the cleanest; recommend B)
- **Option A (quick)**: give the search wrapper `relative z-10` and the ✕ button `relative z-10` so
  it renders above the Edit-tab button. Cheap but leaves visual squishing on very narrow screens.
- **Option B (recommended)**: fix the layout so they never overlap. Add `min-w-0` to flex children
  as needed, drop the fixed `w-32` for a fluid `flex-1`/`max-w` on mobile, and ensure the header has
  enough room — e.g. on mobile shorten the Edit-tab control to just the ✏️ icon (hide the "Edit tab"
  text with a responsive class, show full text at `sm:`/`md:`+), or move Edit-tab onto its own row.
  The repo already has `src/hooks/useIsDesktop.js` (breakpoint `min-width: 768px`) if you prefer a
  JS branch over Tailwind responsive classes — but Tailwind `sm:`/`md:` classes are simpler here.
- Keep within UI rules: min 44×44px tap targets, Tailwind utilities + CSS variables (no `/N` opacity
  modifiers), avoid inline styles.

### Verify
- Manually check at a narrow width (≤375px) that the ✕ is fully tappable and not covered, and that
  the layout still looks right at desktop width. (Optionally use the `verify`/`run` skill to launch
  the app and eyeball it.)

### Tests
- Presentational; rely on build/`check:single`. No logic test needed.

---

## Suggested execution order & commits

Group into focused commits (each passing the commit gate before moving on):
1. **Crafting dhide** (Item 1) — items + recipes + icon/test updates.
2. **Smithing** (Item 2) — biggest; do the items.json audit, Phase A, then Phase B. Consider
   splitting into "recipes for existing items" and "new items + recipes" commits.
3. **Trading post listings pagination** (Item 3).
4. **Offers instant-sell guard** (Item 4).
5. **Bank search clear-button fix** (Item 5).

For every commit: run `npm test && npm run build && npm run rebuild && npm run check:single`
(or `npm run ci && npm test`). Do **not** commit the generated `index.html` in normal PRs. Push to
branch `claude/work-plan-agent-handoff-bqr449`. Do not open a PR unless asked.

## Open decisions to confirm with the user if hit
- Item 2 Phase B: creating brand-new equipment items requires combat-stat balancing. Mirror adjacent
  tiers where possible; escalate any slot with no precedent.
- Item 4: whether to also add a server-side rejection in `functions/api/trading-post/` (widens
  scope beyond the offers screen).
- Item 2 XP inconsistency: new runeforged items use OSRS XP while existing runeforged weapon recipes
  use inflated XP — confirm we are intentionally not retrofitting the old ones.
