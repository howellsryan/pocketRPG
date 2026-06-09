# PocketRPG — Feature & Bug Batch Plan (2026-06-09)

> **Status:** planning / implementation guide. An AI agent picks up **one phase at a time**.
> Every phase ends with the **commit gate** (`npm test && npm run build && npm run rebuild && npm run check:single`, **or** `npm run ci && npm test`) green before commit/push. Do **not** commit generated root `index.html` (build artifact).
>
> **Branch:** `claude/feature-requests-bug-fixes-ne4ajs`.
>
> Phases are grouped by code area and ordered low-risk → higher-risk so each can ship independently. The product owner will split phases into deliveries.

## Phase map

| Phase | Theme | Items | Risk |
|------|-------|-------|------|
| **1** | Quick-win bug fixes | Slayer purchase bug · PvP defeat HP · Drop confirmation · Gargoyle dust price | Low |
| **2** | Slayer progression unlocks | Double monster-quantity unlock (250 pts) · Double slayer-XP unlock (100 creds) | Med |
| **3** | Combat magic | Blood/chaos/death rune spells + Wrath tier | Med |
| **4** | Combat feedback & mobile UI | Hit markers · potion icon · purple fireworks >1m · KC gating · mobile combat UI | Med–High |
| **5** | PvP bot coverage | Bots for every combat level (±10 band) | Med–High |
| **6** | Economy & persistence | Everything tradeable · reduce DB writes · charge-loss-in-bank | High |

---

## Phase 1 — Quick-win bug fixes

Four small, isolated, low-risk fixes. Can ship as one delivery.

### 1.1 — Cannot purchase slayer rewards despite sufficient points  *(root cause found)*
**Root cause:** `src/screens/SlayerScreen.jsx:297` calls `ownsItem(unlock.itemId)`, but:
- `ownsItem` is **not imported** (line 6 imports only `SLAYER_UNLOCKS, getSlayerUnlockPurchaseState`), so the unlocks list render throws `ReferenceError`.
- Even if imported, the signature is wrong: `ownsItem` in `src/engine/slayerUnlocks.js:19` expects `{ itemId, bank, inventory }`, not a bare id string.

**Fix:** import `ownsItem` from `../engine/slayerUnlocks.js` and call it as `ownsItem({ itemId: unlock.itemId, bank, inventory })` at line 297. `bank` and `inventory` are already destructured from `useGame()` (line 58). Verify the `handleUnlock` path (cloud: `api.completeSlayer(...)` line 136; local: `updateSlayerPoints` line 146) still works once the render no longer throws.

**Files:** `src/screens/SlayerScreen.jsx`. **Tests:** extend `tests/slayerUnlocks.test.ts` to assert `ownsItem({itemId, bank, inventory})` and `getSlayerUnlockPurchaseState` allow a purchase when points ≥ cost and item not owned.

### 1.2 — PvP defeat screen shows pre-death HP  *(root cause found)*
**Root cause:** `src/screens/PvpCombatScreen.jsx:1083-1090` passes `self={pair.self}` unmodified to `MatchupHpStrip`; only the opponent's HP is forced to 0 (and only when `youWon`). When you lose, your real (pre-death) HP renders instead of 0.

**Fix:** force the loser's HP to 0 on whichever side:
```jsx
self={youWon ? pair.self : { ...pair.self, hp: 0 }}
opp={youWon ? { ...pair.opp, hp: 0 } : pair.opp}
```
`MatchupHpStrip` (`src/components/LootResultModal.jsx:81`) already clamps and reads `hp`. **Files:** `PvpCombatScreen.jsx`. **Tests:** none required (pure display); optional render assertion.

### 1.3 — Confirmation when dropping an item
**Current:** `src/screens/InventoryScreen.jsx:115` `handleDrop()` nulls the slot immediately with no prompt.
**Fix:** gate `handleDrop` behind a confirmation. Reuse the existing `src/components/Modal.jsx` (or `Toast`/confirm pattern already used elsewhere) rather than a new component. Add local state `confirmDrop` holding the pending slot; render a small confirm dialog ("Drop {item.name}?" → Cancel / Drop). Only mutate inventory on confirm. Keep tap targets ≥44px (CLAUDE.md §9).
**Files:** `src/screens/InventoryScreen.jsx` (+ `Modal.jsx` reuse). **Tests:** none (UI); manual verify.

### 1.4 — Reduce Gargoyle Dust price by 50%
**Current:** `src/data/items.json:16180` `gargoyle_dust` has `"shopValue": 1500`.
**Fix:** set `"shopValue": 750`. Grep for any explicit buy-price/recipe references to `gargoyle_dust` / legacy `granite_dust` (e.g. a shop or upgrade cost) and halve those too if present; otherwise `shopValue` is the only price. **Files:** `src/data/items.json`. **Tests:** none; data-only.

---

## Phase 2 — Slayer progression unlocks

Two new unlocks. **Design note / decision needed:** the two requested unlocks use *different currencies* and *different persistence models* — confirm with product owner before building 2.2.

### 2.1 — New slayer-point unlock: "Double assigned quantity" (250 points)
A purchasable, persistent account perk (not a banked item like the existing `SLAYER_UNLOCKS`, which all grant gear). It doubles the monster count of newly assigned tasks.

**Implementation:**
- Persist a boolean perk on the save (client-authoritative — slayer assignment is client logic). Add to the slayer state in `src/state/gameState.jsx` (e.g. `slayerPerks: { doubleQuantity?: boolean }`) and include it in `getSnapshot`/load.
- **Apply** in `src/engine/slayerMasters.js:144` `buildSlayerTask(master, monsterId, isBoss, options)` — accept `options.quantityMultiplier` and multiply `totalCount` (line 151-156) with `Math.floor` (CLAUDE.md §4). Thread the perk from `SlayerScreen.jsx` `assignTask` (line 88) into the call.
- **Purchase UI:** add a non-gear "perk" entry alongside the gear `SLAYER_UNLOCKS` section in `SlayerScreen.jsx` (cost 250 pts, deduct via `updateSlayerPoints`, mark perk true, critical-save). Show "Owned" once active.

**Files:** `slayerMasters.js`, `gameState.jsx`, `SlayerScreen.jsx`, save snapshot. **Tests:** `buildSlayerTask` with `quantityMultiplier: 2` doubles `totalCount`/`monstersRemaining`; perk persists through a save round-trip.

### 2.2 — New credit unlock: "Double Slayer XP" (100 credits)  *(needs design confirmation)*
**Credits are server-authoritative** (CLAUDE.md §14; debited in `functions/api/skip-hour.js:42` and `functions/api/slayer/skip.js`). So a credit purchase **cannot** be a pure client change.

**Recommended design:**
1. **New server endpoint** (e.g. `functions/api/slayer/unlock.js`, or a generic `functions/api/unlocks/purchase.js`) that atomically debits 100 credits (`UPDATE characters SET credits = credits - ?, credits_used = credits_used + ? WHERE … AND credits >= ?` with `RETURNING credits`, mirroring `skip-hour.js:42-53`), returns `credits_remaining`, and emits an audit event (§14). Reject with 402 on insufficient credits.
2. The unlock **flag** lives in the client save (slayer XP is client-authoritative skilling, so the multiplier may be applied client-side). Client sets `slayerPerks.doubleXp = true` after a successful debit and dispatches `CREDITS_UPDATED_EVENT`.
3. **Apply** in `src/engine/slayerRewards.js:37` `getSlayerTaskXpForKill` — accept a `multiplier`/perk arg and multiply the result with `Math.floor`. Thread the perk into every caller (combat reward path that awards slayer XP — grep `getSlayerTaskXpForKill`).
4. **UI:** a "Character Unlocks" section (new) in `SlayerScreen.jsx` or a dedicated unlocks panel, priced in credits, using the existing credits UI (`BuyCreditsModal.jsx` for top-up).

**Open question for product owner:** (a) Is "Double Slayer XP" account-wide and permanent? (b) Should it stack with the boss ×10 / default ×2 task multipliers in `slayerRewards.js:1-2`, or only the base? (c) New dedicated "Character Unlocks" screen vs. a section inside Slayer? Resolve before implementing.

**Files:** new endpoint, `slayerRewards.js`, `gameState.jsx`, `SlayerScreen.jsx`. **Tests:** endpoint debits/rejects correctly + audit emitted; `getSlayerTaskXpForKill` doubles with perk; perk persists.

---

## Phase 3 — Combat magic: blood/chaos/death runes + Wrath spells

**Current state:** `src/data/spells.json` tops out at the **wave** tier (`fire_wave`, lvl 75, max 20) using only air/water/earth/fire runes. The combat engine already consumes `state.spell.runeReq` generically — `src/engine/combat.js:681-708` checks `hasRequiredRunes` (`src/engine/runes.js:22`) and records `getRunesToConsume` (line 49), honouring equipped elemental staffs. So **"magic doesn't take blood/chaos/death runes into account" = no spell currently requires them.** All needed runes already exist in `items.json`: `chaos_rune` (5501), `death_rune` (5511), `blood_rune` (5878), `soul_rune` (5888), `wrath_rune` (15475).

**Implementation (mostly data authoring):**
1. **Add higher spell tiers to `src/data/spells.json`** following the existing schema (`baseDamage`, `levelReq`, `baseXP`, `tier`, `runeReq`). Suggested, consistent with the strike→bolt→blast→wave progression:
   - **Surge tier** (lvl ~81–95) — `wind/water/earth/fire_surge`, using **death**/**blood**/**chaos** runes in `runeReq` (e.g. `{ "air_rune": 7, "death_rune": 1 }` style), max hit ~21–24.
   - **Wrath tier** (lvl ~95+) — `wind/water/earth/fire_wrath`, using **wrath_rune** + **blood/soul**, max hit ~25–27 (top tier).
   - Keep PocketRPG fantasy naming/Title Case (CLAUDE.md §8) — these names already match the existing in-game spell style.
2. **Spell-select UI:** confirm the combat spell picker lists spells from `spells.json` dynamically (so new tiers appear with level/rune gating) — grep the magic combat setup in `CombatScreen.jsx` / `CombatMobileSelect.jsx`. If the spell list is hard-coded anywhere, extend it.
3. **No engine change expected** — `hasRequiredRunes`/`getRunesToConsume`/`magicMaxHit` already generic. Verify max-hit/XP for the new tiers via the existing combat magic path (`combat.js:691-702`).

**Files:** `src/data/spells.json` (primary), possibly the combat spell-picker UI. **Tests:** new test (or extend an existing magic test) asserting each new spell's `runeReq` is consumed via `getRunesToConsume`, that `hasRequiredRunes` blocks when blood/chaos/death/wrath runes are absent, and level gating is correct.

---

## Phase 4 — Combat feedback & mobile UI

Touches `CombatScreen.jsx`, `PvpCombatScreen.jsx`, `LootResultModal.jsx`, combat tick events. Reference the prior design docs `docs/mobile-combat-redesign-implementation.md` and `docs/loot-modals-redesign-plan.md` — some scaffolding may already exist; **audit first, don't duplicate.** Largest phase; consider splitting into sub-deliveries (4.1+4.2 feedback, 4.3 fireworks, 4.4 KC gate, 4.5 mobile polish).

### 4.1 — Hit markers replacing chat-based combat info
Replace the textual combat log with floating hit splats over the damaged combatant's HP area, for **both** PvE (`CombatScreen.jsx`) and PvP (`PvpCombatScreen.jsx`).
- **Source of truth:** the combat tick already emits damage events. PvE: `src/engine/combat.js` pushes `events` (e.g. `noRunesForSpell` at line 708; damage values computed around 691-702). PvP: tick processing in `functions/api/pvp/match/[id]/tick.js` / `src/engine/pvpEngine.js`, surfaced through `state.recentEvents` (see `pvpEndSummary.js:51`).
- **UI:** a small `HitSplat` component (register in `src/components/` + `build_single.cjs` `sourceFiles`/`GAME_CHUNK_FILES` per §12 if shared) rendered near the target HP bar: **red splat with the damage number when >0**, **blue "0" splat when 0 damage**. Animate up-and-fade; key by event id so each hit shows once. Drive from the per-tick damage events both screens already receive.
- Remove/retire the chat-style info feed once splats cover the same information (keep a minimal log only if product wants history).

### 4.2 — Active-potion icon near HP
Show an icon next to the HP bar indicating an active potion boost, with the **correct icon per potion type**. Boost/potion state is tracked in the combat boost logic (`combat.js:1043-1063` applies combat/magic boosts). Surface the active boost type + remaining duration to the screen and render the matching potion icon (use `src/utils/itemIcons.js` / `GameIcon`). Mirror for PvP (PvP potions: `src/engine/pvpPotions.js`).

### 4.3 — Purple fireworks for drops >1m value
`LootResultModal.jsx` already has a particle burst (`buildParticles(theme)`, line 9) with `gold`/`blood` themes and a purple `loot-row--highlight` row style. Add a **purple/epic** particle palette and trigger it when the loot's value exceeds **1,000,000**.
- Add a `purple` (or `epic`) branch to `buildParticles` (purple palette) and let callers pass it.
- Compute drop value via `src/utils/itemValue.js`; threshold `> 1_000_000`. Apply at the **three call sites**: PvE loot modal (`CombatScreen.jsx`), PvP end modal (`PvpCombatScreen.jsx:1058`), and the **idle results modal** (`setIdleResult` flow in `App.jsx`). Pass `theme="purple"` (or an `epic` flag) when the relevant total exceeds 1m; keep gold/blood otherwise.

### 4.4 — Don't render the combat screen until KC has loaded
**Current:** `fetchKillCounts()` is fire-and-forget (`App.jsx:1194-1202`), merged via max(local, server); `CombatScreen.jsx` reads `killCount` (state default 0) and gates display on `killCount > 0` (e.g. line 2406-2410). On a cold cache KC is briefly missing.
**Fix:** expose a `killCountsLoaded` signal (resolve when `fetchKillCounts()` settles, success *or* fail, per character) and **gate the combat screen render** on it — show a lightweight loading state until KC has returned, then render. Scope the gate to the combat screen specifically (do **not** block global `setGameReady`, to protect startup time). Persist server KC back to IndexedDB so the next cold load is warm.
**Files:** `App.jsx`, `src/cloud/killCounts.js`, `CombatScreen.jsx` (+ `CombatMobileSelect.jsx`). **Tests:** merge/loaded-flag logic unit test.

### 4.5 — Mobile combat UI improvements
Per `docs/mobile-combat-redesign-implementation.md`. Improve layout/readability of `CombatScreen.jsx` + `CombatMobileSelect.jsx`/`CombatMobileSheets.jsx` for mobile: tap targets ≥44px, Tailwind utilities + CSS variables (no `/N` opacity), reuse shared components (CLAUDE.md §9). **Confirm exact visual scope with product owner** (this is subjective). The hit markers (4.1) and potion icon (4.2) are part of this redesign.

**Files:** `CombatScreen.jsx`, `PvpCombatScreen.jsx`, `CombatMobileSelect.jsx`, `CombatMobileSheets.jsx`, `LootResultModal.jsx`, new `HitSplat` component, `App.jsx`, `src/index.css`. **Tests:** logic-only where applicable (splat event mapping, fireworks threshold, KC gate).

---

## Phase 5 — PvP bot coverage for every combat level

**Current:** `src/data/pvpBots.json` has **only 2 bots** — `maxpurebot` (zerk/pure-ish, all-99 combat stats with def 1) and `maxmainbot` (all 99). Both are very high combat level, so low/mid-level players see **no** bots. The lobby surfaces bots within the caller's **±10 CB band** (`functions/api/pvp/waiting.js:21,87-116`, `CB_BAND = 10`). Combat level in PocketRPG spans ~3–126 (formula in `SlayerScreen.jsx:17-31`).

**Goal:** every reachable combat level has ≥1 bot within ±10. With a ±10 band, a bot every ~20 CB levels guarantees coverage; place bots roughly every **15 levels** for redundancy.

**Implementation:**
1. **Author bots** in `pvpBots.json` spanning the CB ladder (common OSRS-style builds adapted to PocketRPG items — verify every referenced `itemId` exists in `items.json`, CLAUDE.md §8). Suggested archetypes across tiers: low-level f2p meleer, mid-level rune/zerk, ranged pure, mage, dharok-style, tank/main — scaled so their **computed combat level** lands on a ~15-level grid from the minimum playable CB up to ~126. Each needs `id`, `username`, `aiProfile` (must match a branch in `src/engine/pvpBotAI.js`), `stats`, `equipment`, `inventory`, `combatStance`.
2. **Compute each bot's combat level** with the same formula the server uses (`functions/_lib/combatLevel.js` / `readCombatLevel`) and confirm the seeded `characters.combat_level` matches — the lobby filters on the stored `combat_level` column (`waiting.js:114`).
3. **Seed:** extend `scripts/seed-pvp-bots.cjs` to emit rows for all new templates (`is_bot=1`, `bot_template_id`, `combat_level`). Run via `npm run seed:bots` (CLAUDE.md §10).
4. **Coverage test (required):** a regression test that, for every integer CB from the lowest playable to the max, asserts ≥1 bot exists within ±10 — fails if a gap appears when bots are added/removed.
5. Confirm `aiProfile` values are all handled in `pvpBotAI.js`; add profiles if new archetypes need distinct behaviour. Bots stay excluded from the rank ladder (`pvpRanks.js`) and reset via `resetBotSave` after matches (already wired).

**Files:** `src/data/pvpBots.json`, `scripts/seed-pvp-bots.cjs`, possibly `src/engine/pvpBotAI.js`, new coverage test. **Risk:** Med–High (matchmaking + data correctness). Reference `docs/pvp-bot-system-plan.md`.

---

## Phase 6 — Economy & persistence

Highest-risk phase (server + economy + persistence). Ship as three separate deliveries.

### 6.1 — Make everything tradeable flow through the trading post
**Current:** `functions/_lib/game/tradingPost.js:49` `isTradingPostListable` already lists any item that is **not** `isUntradeable` and has `shopValue > 0` (boss/raid/clue uniques go via the order book, line 44). So "add everything tradeable" is largely a **data audit of `isUntradeable` flags** in `items.json`, plus ensuring listable items have a `shopValue`.
**Implementation:**
1. Audit `items.json` for items that are currently `isUntradeable: true` (or `shopValue: 0`) but *should* be player-tradeable. Flip `isUntradeable`/set `shopValue` for those.
2. **Decision needed (product owner):** confirm what stays untradeable — e.g. skill capes (see `docs/feature-plan-2026-06.md` Feature 5), quest items, PvP bot rewards (`zesta_*`), bound/Ironman items, clue/boss uniques (order-book). Don't blanket-flip; produce an explicit allowlist of what becomes tradeable.
3. Verify the purchase/sell/visibility gates honour the new flags: `src/engine/storeRules.js` (`getPurchaseRestriction`, `isStoreVisibleItem`), `functions/api/purchase.js`, and the trading-post search. Add an audit event for any new economy path (§14).
4. `TradingPostScreen.jsx` surfaces the newly listable items automatically once flags/shopValue are set — verify search/visibility.
**Files:** `src/data/items.json` (primary), `tradingPost.js`/`storeRules.js` (verify), `TradingPostScreen.jsx` (verify). **Tests:** extend `tests/tradingPost.test.ts` — newly-tradeable items list/sell; allowlist-excluded items stay unlistable.

### 6.2 — Reduce daily DB writes (still ~48k/day)
**Current:** `/api/save` (`functions/api/save.js:170-186`) runs a 2-statement `DB.batch` on **every** save — `INSERT … saves` **+** `UPDATE characters` (total_level/combat_level). Client pushes are debounced to **once per 60s** (`src/cloud/sync.js:1`). 2 writes × ~1440 pushes/day/active-char ⇒ the 48k figure scales with active characters. A prior optimisation gated the PvP sweep to 5% (`save.js:15-19`).
**Further reductions (server + client):**
1. **Skip the `characters` UPDATE when the summary is unchanged.** total_level/combat_level rarely change between saves; compute `computeSaveSummaryFromJson` (line 167), compare to the stored `characters.total_level`/`combat_level`, and only include the UPDATE in the batch when it actually differs. Removes ~half the writes in the common case.
2. **No-op save detection.** If incoming `save_data` equals the existing stored `save_data` (or matches a stored content hash), skip the write entirely and return the current `save_revision`. Cheap guard for AFK/idle pushes where nothing changed.
3. **Client dirty-check.** In `src/cloud/sync.js`, skip the scheduled 60s push when the snapshot is byte-identical to the last successfully-pushed snapshot (hash compare). Prevents periodic writes during pure idle. Optionally lengthen the cadence for inactive tabs.
**Files:** `functions/api/save.js`, `src/cloud/sync.js`, possibly `functions/_lib/saveSummary.js`. **Tests:** `save.js` skips `characters` UPDATE when summary unchanged; no-op save returns current revision without write; client skips identical push. Preserve the stale-write (`save_revision`) and total-level-regression guards (§14).

### 6.3 — Chargeable items lose charge in the bank  *(needs investigation)*
**Current model:** charges live on item entries (`{ itemId, quantity, charges }`). Idle combat consumes charges from the **equipped** weapon only — `gameState.jsx:277-280` deducts `sim.chargesConsumed` from `eq.weapon`; the sim caps idle kills by loaded charges (`idleEngine.js:1117-1126,1407`). Banked items should be untouched.
**Suspected causes (audit these):**
1. **Charge field dropped on save/load round-trips** for banked items — check `src/db/saveload.js`, `src/engine/itemMigrations.js`, and bank merge in `gameState.jsx` `addToBank` (and `lootTransfer.fillBank`) to ensure `charges` is always preserved when a charged item is deposited/serialised/migrated.
2. **Idle/offline catch-up touching a banked charged item** — confirm the idle charge deduction only ever targets `eq.weapon`, never a bank entry, across all offline/skip-hour paths (`idleEngine.js`, `skipPreflight.js`).
**Implementation:** reproduce (bank a charged item, run long offline/idle, inspect charges), pinpoint where `charges` is lost, and fix to guarantee banked charges are immutable. Add a migration backfill only if existing saves were corrupted.
**Files:** `src/db/saveload.js`, `src/engine/itemMigrations.js`, `src/state/gameState.jsx`, `src/engine/idleEngine.js`. **Tests:** charged item survives a save/load round-trip in the bank with charges intact; long offline tick does not change banked-item charges; equipped-weapon charge consumption unchanged.

---

## Cross-cutting reminders
- **Commit gate** before every commit/push. Don't commit generated `index.html`.
- **Single-file build (§12):** any new shared component (`HitSplat`, etc.) must have globally-unique top-level names and be registered in `build_single.cjs` `sourceFiles`; in-game-only screens/components also go in `GAME_CHUNK_FILES`. Run `npm run check:single`.
- **Server authority (§14):** new economy/credit mutations (2.2, 6.1) must debit/grant server-side and emit audit events. Client-authoritative XP/coins/charges stay client-side by design.
- **Item naming (§8):** any new/edited item `name` stays Title Case; verify referenced `itemId`s exist before use (bots, spells).
- **Open product decisions to confirm before building:** 2.2 (double-XP unlock scope/placement/currency), 4.5 (mobile redesign visual scope), 6.1 (which items become tradeable).
