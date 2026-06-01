# Implementation Guide — One-Life Reset Hardening & the Armoury

> **Scope**: Two independent feature requests. Each section is self-contained
> (current behaviour → design → step-by-step → tests). They can ship in separate PRs.
>
> 1. **One-Life death must wipe trading post records as part of a single atomic reset.**
>    The reset must be one all-or-nothing flow that *cannot* half-succeed and back out
>    into a partial cleanup, while keeping the player's login and character name.
> 2. **Add an "Armoury" tab** (desktop + mobile) that lists every weapon and armour in the
>    game, split into melee / ranged / magic, grouped by equipment family (dragon, runeforged,
>    grondar, …), ordered by tier, with info modals and a crossing-swords indicator on weapons
>    that have a special attack.

---

## Feature 1 — One-Life reset: single atomic wipe (including trading post)

### Current behaviour

The death pipeline is already wired correctly at the call sites. All three death sites route
through one helper:

- `src/screens/CombatScreen.jsx:452` and `:480` (direct combat / dragonfire death)
- `src/App.jsx:768`, `:1128`, `:1697` (idle / offline / skip-hour death)

…all call `triggerOneLifeDeath(addToast)` → `performOneLifeReset()` (`src/utils/oneLifeDeath.js:8-40`).

`performOneLifeReset()` then takes **one of two very different paths**:

```js
// src/utils/oneLifeDeath.js:8-21
export async function performOneLifeReset() {
  if (getToken()) {
    try {
      await api.resetOneLife()                 // PRIMARY: atomic + clears offers
    } catch (err) {
      // FALLBACK: partial, non-atomic, leaves the character + offers intact
      try { await api.deleteSave() }  catch (e) { /* … */ }
      try { await api.deleteIdle() }  catch (e) { /* … */ }
    }
  }
  // local wipe + clearAuth + redirect run regardless of server outcome
}
```

**The primary path already clears trading post records.** The server endpoint deletes offers
inside an atomic D1 `batch()`:

```js
// functions/api/characters/reset-one-life.js:29-48
await env.DB.batch([
  env.DB.prepare('DELETE FROM saves              WHERE character_id = ?').bind(characterId),
  env.DB.prepare('DELETE FROM character_idle_state WHERE character_id = ?').bind(characterId),
  env.DB.prepare('DELETE FROM collection_log      WHERE character_id = ?').bind(characterId),
  env.DB.prepare('DELETE FROM trading_post_offers WHERE character_id = ?').bind(characterId), // ← offers
  env.DB.prepare('DELETE FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL').bind(characterId, auth.identity.id),
  env.DB.prepare(`INSERT INTO characters (owner_id, username, is_ironman, is_one_life, …) VALUES (…)`), // recreate, same login + name
])
```

`env.DB.batch()` runs as a single implicit transaction in Cloudflare D1, so the primary path
is *already* the atomic "total reset that keeps login + name" the request describes.

**The bug is the fallback.** When `api.resetOneLife()` throws (a transient network error, a
cold worker, a 5xx), `performOneLifeReset()` silently degrades to `deleteSave()` + `deleteIdle()`:

- `DELETE /api/save`  → `DELETE FROM saves WHERE character_id = ?` only (`functions/api/save.js:189`)
- `DELETE /api/idle`  → `DELETE FROM character_idle_state WHERE character_id = ?` only (`functions/api/idle.js:115`)

Neither touches `trading_post_offers`, and neither deletes the `characters` row. So after a
fallback the cloud character **survives with all its active offers and escrowed items/coins**.
The local save is wiped and the player is redirected, but they can re-authenticate, open the
Trading Post, **cancel** their offers, and recover everything that was in escrow — exactly the
"chance to keep items on death" being reported.

**Confirmed not a vector** (no extra work needed, but documented so the fix is complete):

- There is only one trading-post store: `trading_post_offers` (migration `0015_trading_post.sql`).
  No client-side / IndexedDB mirror exists (`grep` of `src/db`, `src/state` is empty).
- Instant-sold offers are *orphaned* by setting `character_id = NULL`
  (`functions/_lib/game/tradingPost.js:399-406`). The player already took the 80% payout, so
  they are public stock, not recoverable by that player. A character-id-scoped delete correctly
  leaves them alone.
- The recreated character gets a **new** auto-increment id, so even surviving offers under the
  old id are only reachable through the old id — which is precisely why the fallback's failure
  to delete the old character is what enables recovery.

### Design

Per the product decision: **the reset is a single, atomic, all-or-nothing flow that keeps the
player's login and name. It must never degrade into a partial cleanup that leaves recoverable
state.**

The server side already satisfies this (`batch()` is atomic). The work is on the **client
orchestration** in `src/utils/oneLifeDeath.js`:

1. **Delete the partial fallback entirely.** Never call `deleteSave` / `deleteIdle` as a
   consolation prize — that is the "half-bothered backout" we are removing.
2. **Make `resetOneLife` the only server path, and retry it** with bounded exponential backoff
   (mirroring the repo's documented push/fetch retry policy: 2s, 4s, 8s, 16s).
3. **Gate the local wipe + redirect on server success.** Only after the server confirms the
   atomic reset (or confirms it already happened — see idempotency) do we `wipeLocalSave()`,
   `clearAuth()`, and redirect. If every retry fails, do **not** silently continue: surface a
   blocking error and keep the player from resuming play (the account is "dead" but the cloud
   wipe is still pending), so they can never reach a state where the old character + offers are
   usable.
4. **Make the endpoint idempotent for retries.** A retry can happen *after* the server already
   committed the batch but before the response reached the client. After a successful reset the
   old `characterId` no longer exists, so the endpoint currently returns `404 Character not
   found`. The retry logic must treat "character not found / not one-life for this id" as
   **already reset = success**, not as a hard failure that triggers another attempt.

> **Why not also harden `DELETE /api/save` and `/api/idle`?** They are general-purpose endpoints
> used for legitimate save/idle management and account deletion. They intentionally do **not**
> destroy trading-post escrow (which, outside one-life, must be refunded via `cancelOffer`, not
> hard-deleted). Leave them as-is; the one-life total reset is the single place offers are wiped
> without refund. Removing the fallback means these endpoints are no longer part of the one-life
> path at all.

### Step-by-step

**1. Add an idempotency-aware result to the client API call** — `src/cloud/api.js:200`.

`request()` throws on non-2xx. We need the retry loop to distinguish "already reset" (treat as
success) from "try again". Either:

- inspect the thrown error's status/message for the 404 "Character not found" / 400 "not
  one-life" case, **or**
- add a tiny wrapper that returns a discriminated result.

Recommended wrapper next to `resetOneLife`:

```js
// src/cloud/api.js
resetOneLife: () => request('/api/characters/reset-one-life', { method: 'POST', body: JSON.stringify({}) }),
```

Keep `resetOneLife` as-is and do the classification in `oneLifeDeath.js` (below), so `api.js`
stays a thin transport layer. Make sure `request()` surfaces the HTTP status on the thrown error
(check its implementation in `src/cloud/api.js`; if it only throws a bare message, include the
status code in the error so the retry loop can branch on 404/400).

**2. Rewrite `performOneLifeReset()`** — `src/utils/oneLifeDeath.js:8-28`.

```js
// Treat "this character id no longer exists / is not one-life" as proof the
// atomic server reset already committed (idempotent retry after a lost response).
function isAlreadyReset(err) {
  const s = err?.status
  const m = String(err?.message || '')
  return s === 404 || s === 400 || /not found|not one-life/i.test(m)
}

async function resetOneLifeWithRetry({ attempts = 5, baseDelayMs = 2000 } = {}) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      await api.resetOneLife()
      return true
    } catch (err) {
      if (isAlreadyReset(err)) return true   // server committed; we're done
      lastErr = err
      if (i < attempts - 1) await new Promise(r => setTimeout(r, baseDelayMs * 2 ** i)) // 2s,4s,8s,16s
    }
  }
  throw lastErr
}

export async function performOneLifeReset() {
  // 1) Authoritative, atomic server wipe FIRST. No partial fallback — retry or fail loud.
  if (getToken()) {
    await resetOneLifeWithRetry()            // throws if it never succeeds
  }
  // 2) Only after the cloud account is provably reset do we clear the device.
  try {
    closeDB()
    await wipeLocalSave()
  } catch (err) { console.error('Failed to wipe local save:', err) }
  try {
    localStorage.removeItem('pocketrpg_activeCombatSpell')
    localStorage.removeItem('pocketrpg_offline_mode')
    setLocalCharacterId(null)
  } catch { /* ignore */ }
  clearAuth()
}
```

Key change: the `try/catch` that fell back to `deleteSave` + `deleteIdle` is **gone**. The
imports for those (`api.deleteSave`, `api.deleteIdle`) can be dropped from this file if unused
elsewhere.

**3. Make `triggerOneLifeDeath()` fail loud instead of leaking a usable account** —
`src/utils/oneLifeDeath.js:34-40`.

```js
export async function triggerOneLifeDeath(addToast) {
  try {
    await performOneLifeReset()
    if (addToast) addToast('You died — account wiped.', 'error')
    setTimeout(() => { window.location.href = '/' }, 1500)
  } catch (err) {
    console.error('One-life reset failed after retries:', err)
    // Do NOT redirect or unlock play — the cloud character is still alive.
    // Keep the player on a blocking "reset pending" state so the old character
    // (and its trading post offers) can never be used. Retry on next launch.
    if (addToast) addToast('Reset failed — reconnecting. Do not close the app.', 'error')
    // Optional: schedule a retry, or hard-redirect to a "/dead" gate that re-runs
    // performOneLifeReset() on load until it succeeds.
    throw err
  }
}
```

> The three call sites use `void triggerOneLifeDeath(addToast)` (fire-and-forget). With the throw
> above, decide the UX for the unhappy path: simplest is a full-screen blocking overlay ("Account
> wiped — finishing reset…") that re-invokes `performOneLifeReset()` until it resolves, then
> redirects. The invariant to preserve: **the player must not regain control of the old
> character while its cloud record (and offers) still exist.**

**4. (Optional, defence-in-depth) Idempotent server endpoint.**

`reset-one-life.js` already returns `404` when the id is gone. If you want retries to be cleaner,
make the endpoint treat "already reset" as a success: when the character row is absent but a
non-deleted character with the same `username`/`owner_id` exists, return `200 { ok: true,
recreated: {…} }` instead of `404`. This is optional because step 2's `isAlreadyReset()` already
handles it client-side; do it only if other callers would benefit.

### Edge cases & gotchas

- **Offline / no token**: when `getToken()` is falsey there is no cloud character and the trading
  post (auth-only) has no offers — the local wipe alone is sufficient. The `if (getToken())` guard
  preserves this.
- **Retry after committed-but-lost response**: handled by `isAlreadyReset()` (404/400 → success).
- **Don't refund on one-life**: the server `DELETE FROM trading_post_offers` hard-deletes escrow
  (no `cancelOffer` refund). That is intentional and correct for a death wipe — do not route the
  one-life path through `cancelOffer`.
- **Security model (`CLAUDE.md §14`)**: the wipe stays server-authoritative; the client only
  triggers and confirms it. The existing audit story is unchanged, though emitting an audit event
  from `reset-one-life.js` (per §14, "new mutations that materially change economy/progression
  must emit audit events") is a reasonable add-on if not already covered.

### Tests

- **Server** (`tests/` — follow existing API/worker test harness, e.g. how trading-post endpoints
  are tested): create a one-life character with active buy + sell offers, call
  `reset-one-life`, assert `trading_post_offers` for the **old** character id is empty, the old
  `saves`/`character_idle_state`/`collection_log` rows are gone, and a fresh character with the
  same `username` and `is_one_life` exists with a **new** id.
- **Client logic** (extract `resetOneLifeWithRetry` / `isAlreadyReset` so they're unit-testable):
  - `resetOneLife` succeeds first try → no retries, returns true.
  - throws transient (500) twice then succeeds → retried with backoff, returns true.
  - throws 404 "Character not found" → `isAlreadyReset` true → returns true with no further calls.
  - throws transient on all attempts → `performOneLifeReset` rejects, local wipe / redirect do
    **not** run (assert `wipeLocalSave` / `clearAuth` not called).
  - **Regression for the bug**: assert `api.deleteSave` / `api.deleteIdle` are **never** called
    by the one-life path.

---

## Feature 2 — Armoury tab (all weapons & armour, by category → group → tier)

### Current behaviour

There is no equipment compendium screen today. The nav is fully data-driven and shared between
desktop and mobile, so adding a tab is a small, well-trodden change. The item data, however, has
**no tier/group/family fields** — those must be *derived*, and that is the main design problem.

**Navigation (one source of truth for desktop + mobile):**

- `src/utils/constants.js:79-96` — `SCREENS` enum (no `ARMOURY` yet).
- `src/components/navTabs.js:3-18` — `NAV_TABS` array, consumed by **both**
  `src/components/SideNav.jsx` (desktop sidebar) and `src/components/BurgerMenu.jsx` (mobile
  drawer). Adding one entry here lights up both.
- `src/App.jsx:14-23` (screen imports), `:1942-1959` (`renderScreen()` switch).

**Item data** — `src/data/items.json` (931 items; **421 `type:"armour"`, 159 `type:"weapon"`**):

```jsonc
// weapon
{ "id":"bronze_dagger", "name":"Bronze Dagger", "type":"weapon", "slot":"weapon",
  "attackSpeed":4, "attackStyle":"stab", "attackBonus":{…}, "defenceBonus":{…},
  "otherBonus":{"meleeStrength":3}, "requirements":{"attack":1}, "shopValue":83, "icon":"🗡️" }
// armour
{ "id":"bronze_full_helm", "name":"Bronze Full Helm", "type":"armour", "slot":"head",
  "defenceBonus":{…}, "otherBonus":{…}, "requirements":{"defence":1}, "shopValue":42, "icon":"🧢" }
```

- **Combat category**:
  - Weapons: `attackStyle` is one of `stab|slash|crush` (→ **melee**), `ranged` (→ **ranged**),
    `magic` (→ **magic**). (Verified counts: stab 26, slash 53, crush 23, ranged 40, magic 17.)
  - Armour has **no** `attackStyle`; categorise from `requirements`: `requirements.ranged` →
    ranged, `requirements.magic` → magic, otherwise melee. Many armour pieces have only a
    `defence` requirement (shared across styles) — these need a curated override (see below).
- **Special attacks**: 35 items carry a `specialAttack` object (weapons only), e.g. `dragon_dagger`,
  `dragon_scimitar`, `magic_shortbow`, the godswords, `nether`/`venom`/`gargoyle` weapons.
  Schema per `CLAUDE.md §7`: `{ type, energyCost, description, stunTicks?, minHeal?, lightningMax? }`.
- **NO tier / set / group / family / rank field exists** (verified by grep — all absent).

**The grouping problem (read before designing):** grouping by the first word of `name` yields
**148 distinct prefixes**, most with a single item — dragonhide bodies named by colour
("Green"/"Blue"/"Red"/"Black"), gem jewellery ("Sapphire"/"Ruby"/…), skill capes
("Attack"/"Strength"/… at req 99), one-offs ("Occult", "Fancy"). A naive first-word grouping is
unusable. The real families the request names — **grondar, runeforged, dragon** — do appear
cleanly (e.g. Runeforged: 12 weapons + 16 armour at req 40; Grondar: 2 weapons + 22 armour;
Dragon: 11 weapons + 7 armour at req 60), but they must be selected by a **curated taxonomy**,
not auto-derived.

### Design

Build the Armoury as a **read-only compendium** reusing the existing item-modal stack, fed by a
**pure data classifier** so the logic is testable and the screen stays thin.

**Data model — `src/utils/armoury.js` (pure, no UI imports):**

```js
// Ordered list of equipment families. Order defines display order within a category.
// Each entry matches by id prefix and/or name prefix; first match wins.
export const ARMOURY_GROUPS = [
  // melee metal tiers
  { key: 'bronze',      label: 'Bronze',      match: ['bronze'] },
  { key: 'iron',        label: 'Iron',        match: ['iron'] },
  { key: 'steel',       label: 'Steel',       match: ['steel'] },
  { key: 'mithril',     label: 'Mithril',     match: ['mithril'] },
  { key: 'adamant',     label: 'Adamant',     match: ['adamant'] },
  { key: 'runeforged',  label: 'Runeforged',  match: ['runeforged', 'rune_'] },
  { key: 'dragon',      label: 'Dragon',      match: ['dragon'] },
  { key: 'grondar',     label: 'Grondar',     match: ['grondar'] },
  { key: 'zephyra',     label: 'Zephyra',     match: ['zephyra'] },
  { key: 'lumira',      label: 'Lumira',      match: ['lumira'] },
  { key: 'krylth',      label: 'Krylth',      match: ['krylth'] },
  { key: 'nether',      label: 'Nether',      match: ['nether'] },
  // …extend from the audit table below…
]
```

> **Authoring note**: the exact, complete group list should be locked down with product — see
> the appendix table at the end (generated from the live data) listing every first-word prefix,
> its item counts and min requirement. Map each meaningful family to a `ARMOURY_GROUPS` entry;
> route the long tail (single-item jewellery, dragonhide colours, skill capes) into a small set
> of catch-all buckets (e.g. "Dragonhide", "Jewellery", "Skill Capes", "Other") or exclude them
> if the Armoury is meant to be weapons + body/limb armour only. **Decision required** (see
> "Decisions to confirm").

```js
import itemsData from '../data/items.json'

const MELEE_STYLES = new Set(['stab', 'slash', 'crush'])

export function categoryOf(item) {
  if (item.type === 'weapon') {
    if (item.attackStyle === 'ranged') return 'ranged'
    if (item.attackStyle === 'magic')  return 'magic'
    return 'melee'
  }
  // armour
  const req = item.requirements || {}
  if (req.ranged) return 'ranged'
  if (req.magic)  return 'magic'
  // …plus curated overrides for defence-only ranged/magic armour (dragonhide, robes)…
  return 'melee'
}

export function tierOf(item) {
  const reqs = Object.values(item.requirements || {})
  return reqs.length ? Math.min(...reqs) : 0   // sort key; lower = earlier tier
}

export function groupOf(item) {
  const hay = `${item.id} ${item.name}`.toLowerCase()
  for (const g of ARMOURY_GROUPS) {
    if (g.match.some(m => hay.startsWith(m) || item.id.startsWith(m))) return g.key
  }
  return 'other'
}

// Build { melee: [{group, label, items:[…sorted by tier then name]}], ranged:[…], magic:[…] }
export function buildArmoury(items = itemsData) {
  const cats = { melee: new Map(), ranged: new Map(), magic: new Map() }
  for (const item of Object.values(items)) {
    if (item.type !== 'weapon' && item.type !== 'armour') continue
    const cat = categoryOf(item)
    const gk = groupOf(item)
    if (!cats[cat].has(gk)) cats[cat].set(gk, [])
    cats[cat].get(gk).push(item)
  }
  const order = new Map(ARMOURY_GROUPS.map((g, i) => [g.key, i]))
  const labelOf = new Map(ARMOURY_GROUPS.map(g => [g.key, g.label]))
  const shape = (map) => [...map.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999))
    .map(([key, list]) => ({
      key, label: labelOf.get(key) || 'Other',
      items: list.sort((x, y) => tierOf(x) - tierOf(y) || x.name.localeCompare(y.name)),
    }))
  return { melee: shape(cats.melee), ranged: shape(cats.ranged), magic: shape(cats.magic) }
}

export const hasSpecialAttack = (item) => !!item?.specialAttack
```

**Screen — `src/screens/ArmouryScreen.jsx`:** follow the HomeScreen card-grid + detail-modal
pattern (`src/screens/HomeScreen.jsx:23-43`, styles in `src/index.css`).

- Top filter bar: three category tabs **Melee / Ranged / Magic** (and optionally a Weapons /
  Armour sub-toggle). Reuse `Button.jsx`; respect the 44×44px tap target (`CLAUDE.md §9`).
- For the active category, render each group as a section: a `SectionHeader` (group label) +
  a responsive grid of item cards (2 cols mobile → 3–4 desktop, matching HomeScreen's grid).
- Each card: `GameIcon` + name + a small tier badge (min requirement). If
  `hasSpecialAttack(item)`, overlay a **⚔️ crossing-swords** badge in a corner.
- Tap a card → open the info modal.

**Info modal — reuse `SharedItemModal`, no edits to shared components needed:**

`SharedItemModal` already renders icon, type, slot, attack speed, style, requirements, value, and
the full `BonusDisplay` (`src/components/ItemDetailPanel.jsx:5-44`). It accepts `extraInfo` and
`children` slots — inject the special-attack details there without modifying the shared
component:

```jsx
import SharedItemModal from '../components/SharedItemModal.jsx'

function ArmourySpecial({ item }) {
  const s = item.specialAttack
  if (!s) return null
  return (
    <div class="pt-2 mt-2 border-t border-[var(--color-void-border)]">
      <p class="text-[var(--color-gold)] font-semibold text-[12px]">⚔️ Special Attack</p>
      <p class="text-[11px] opacity-80">Energy: {s.energyCost}</p>
      <p class="text-[12px]">{s.description}</p>
    </div>
  )
}

// in render:
{selected && (
  <SharedItemModal item={selected} onClose={() => setSelected(null)}>
    <ArmourySpecial item={selected} />
  </SharedItemModal>
)}
```

(`children` render *below* the bonus block in `ItemDetailPanel`, so the special-attack section
appears last — a natural place for it.)

### Step-by-step

**1. Register the screen id** — `src/utils/constants.js`, inside `SCREENS` (after line 95):

```js
  HELP: 'help',
  ARMOURY: 'armoury',
```

**2. Add the nav tab** — `src/components/navTabs.js`, add an entry to `NAV_TABS` (place it near
the combat/equipment group):

```js
  { id: SCREENS.ARMOURY, label: 'Armoury', icon: '🗡️' },
```

> Use a distinct icon — `⚔️` is already taken by the **Combat** tab (`navTabs.js:10`) and `🛡️`
> by **Equip** (`:7`). `🗡️` (or `📕`/"compendium") keeps the Armoury visually distinct.
> This one array drives **both** `SideNav.jsx` (desktop) and `BurgerMenu.jsx` (mobile).

**3. Create the classifier** — `src/utils/armoury.js` (pure logic per the design above). Keep it
free of Preact imports so it can be unit-tested and reused by the build.

**4. Create the screen** — `src/screens/ArmouryScreen.jsx` (cards + filters + modal as above).
Reuse `Modal`/`SharedItemModal`/`ItemDetailPanel`/`BonusDisplay`/`GameIcon`/`SectionHeader`/
`Button`; do **not** invent new wrappers (`CLAUDE.md §9`).

**5. Wire the router** — `src/App.jsx`:

- Import near the other screens (`:14-23`): `import ArmouryScreen from './screens/ArmouryScreen.jsx'`
- Add a case to `renderScreen()` (after `:1959`): `case SCREENS.ARMOURY: return <ArmouryScreen />`

**6. Register for the single-file build** — `build_single.cjs` (`CLAUDE.md §12`). The build now
**code-splits** the heavy in-game screens into a lazily-loaded `game-<hash>.js` chunk (PR #544),
so a new in-game screen must be registered in **two** places, using the **transpiled `.js`** path:

- `'utils/armoury.js'` → in the `sourceFiles` utils block only. Utils stay in the **core** inline
  script; the chunk references core's `buildArmoury` binding by name (classic scripts share one
  global scope), so it must *not* go in `GAME_CHUNK_FILES`.
- `'screens/ArmouryScreen.js'` → in **both** `sourceFiles` (after `'screens/EquipmentScreen.js'`)
  **and** the `GAME_CHUNK_FILES` set. The Armoury is in-game only (rendered inside `renderScreen`,
  gated behind `cloudPhase === 'ready'`), so it belongs in the lazy chunk — keeping it out of the
  landing/login payload.

If `ArmourySpecial` (or any new card component) is factored into `src/components/`, register it in
the `sourceFiles` components block (before the screen that uses it); shared components stay in core.

> The screen uses `GameIcon`, whose glyph data (`gameIconsData`) also lives in the chunk. `GameIcon`
> already guards access with `typeof gameIconsData !== 'undefined'` and emoji-falls-back until the
> chunk loads, so the Armoury renders correctly (it only ever shows once the chunk is loaded). Do
> not reference `gameIconsData` directly from the screen.

**7. Build artifact**: `src/index.html` / root `index.html` are generated by `npm run rebuild` —
do **not** hand-edit them (`CLAUDE.md §13`).

### Edge cases & gotchas

- **The classifier is content, not just code.** Because there is no `group`/`tier` field, new
  items won't auto-classify into the right family. Add a regression test (below) that fails when
  any `weapon`/`armour` lands in the `other` bucket, so adding equipment forces a taxonomy update.
  (Alternative durable fix: add a `group` field to `items.json` — but `CLAUDE.md §3` treats
  `src/data` as content data; tagging ~580 items is a larger content task. Recommend the
  classifier + override map first, and consider data tagging later.)
- **Defence-only armour mis-categorising.** Pure `requirements.defence` armour (e.g. dragonhide
  named by colour, mage robes) won't expose `ranged`/`magic` in requirements. The curated group
  list must also encode the category for these families (e.g. a group can declare
  `category: 'ranged'` to override `categoryOf`). Build the override into `ARMOURY_GROUPS`.
- **Non-equippable "weapons/armour".** Some `type:"armour"` entries are jewellery, skill capes,
  or quest/cosmetic items. Decide whether the Armoury shows everything or only true combat gear.
- **Performance**: `buildArmoury()` iterates 931 items once; memoise it (module-level constant or
  `useMemo`) so it isn't recomputed per render.
- **Icon reuse**: card special-attack badge uses ⚔️ per the request; the tab icon should differ
  (see step 2).

### Tests

New `tests/armoury.test.ts` (logic-only, against the pure classifier):

- `categoryOf` maps each `attackStyle` correctly (stab/slash/crush→melee, ranged→ranged,
  magic→magic) and armour by requirements/overrides.
- `tierOf` returns the min requirement (and `0` when no requirements).
- `hasSpecialAttack` true for exactly the items with a `specialAttack` object (expect 35).
- `buildArmoury()` returns the three categories; within each group, items are sorted by tier then
  name; groups are in `ARMOURY_GROUPS` order.
- **Coverage guard**: every `type:"weapon"`/`"armour"` item resolves to a known group (assert the
  `other` bucket is empty, or contains only an explicitly allow-listed tail) — this is the test
  that forces taxonomy upkeep when content is added.

### Decisions to confirm (product)

1. **Scope of "weapons & armour"**: include jewellery / skill capes / cosmetics, or restrict to
   true combat gear (weapon + head/body/legs/shield/etc.)?
2. **Group taxonomy & order**: confirm the final `ARMOURY_GROUPS` list and the display order
   within each category (use the appendix audit table as the starting point).
3. **Tier definition**: min equipment requirement (recommended, data-driven) vs. an explicit
   authored tier number.
4. **Tab icon/label**: `Armoury` + `🗡️` proposed (⚔️/🛡️ already used).

### Appendix — data audit (for locking the taxonomy)

Run this to regenerate the full prefix → counts/min-req table that the `ARMOURY_GROUPS` list
should be built from:

```bash
node -e 'const it=require("./src/data/items.json");const g={};
for(const i of Object.values(it)){if(i.type!=="weapon"&&i.type!=="armour")continue;
const k=(i.name||"").split(" ")[0];g[k]??={w:0,a:0,min:1/0,spec:0};
g[k][i.type==="weapon"?"w":"a"]++;const r=Object.values(i.requirements||{});
g[k].min=Math.min(g[k].min,r.length?Math.min(...r):0);if(i.specialAttack)g[k].spec++;}
for(const[k,v]of Object.entries(g).sort((a,b)=>a[1].min-b[1].min))
console.log(k.padEnd(14),"req"+v.min,"w"+v.w,"a"+v.a,"spec"+v.spec);'
```

Notable clean families confirmed in the data: **Bronze/Iron** (req 1), **Steel** (5),
**Mithril** (20), **Adamant** (30), **Runeforged** (40, w12/a16), **Grondar** (w2/a22, 2 specs),
**Zephyra/Lumira/Krylth** (40, with specials), **Dragon** (60, w11/a7, 5 specs), **Nether**
(70, 2 specs). The long tail (dragonhide colours, gem jewellery, req-99 skill capes, one-offs)
needs bucketing or exclusion per decision 1.

---

## Build / test / commit checklist (`CLAUDE.md §11`)

Run the full commit gate before pushing **each** feature's PR:

```bash
npm test && npm run build && npm run rebuild && npm run check:single
# or: npm run ci && npm test
```

- Keep `src/engine` and the new `src/utils/armoury.js` UI-free (pure logic).
- Do **not** hand-commit `index.html` — it regenerates via `npm run rebuild` (`CLAUDE.md §13`).
- Register new single-file sources in `build_single.cjs` (`CLAUDE.md §12`).
- Add the regression tests described in each feature.

## Suggested PR split

| PR | Feature | Risk | Server-authority touch |
|----|---------|------|------------------------|
| 1 | One-life atomic reset hardening | Medium | Client orchestration only; reuses existing atomic `reset-one-life` batch |
| 2 | Armoury tab | Low–Medium | None (read-only compendium of static data) |

Ship PR 1 first (closes an economy exploit), then PR 2.
