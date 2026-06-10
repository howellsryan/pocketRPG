# PocketRPG — Feature & Bug Batch Plan (2026-06-09)

> **Status:** Phases 1, 2, 4, 5 & 6 complete. Phase 3 (combat magic) pending.
> Every phase ends with the **commit gate** (`npm test && npm run build && npm run rebuild && npm run check:single`, **or** `npm run ci && npm test`) green before commit/push. Do **not** commit generated root `index.html` (build artifact).
>
> **Branch:** `claude/feature-requests-bug-fixes-ne4ajs`.
>
> Phases are grouped by code area and ordered low-risk → higher-risk so each can ship independently. The product owner will split phases into deliveries.

## Phase map

| Phase | Theme | Items | Status | Risk |
|------|-------|-------|--------|------|
| **1** | Quick-win bug fixes | Slayer purchase bug · PvP defeat HP · Drop confirmation · Gargoyle dust price | ✅ Done | Low |
| **2** | Slayer progression unlocks | Double monster-quantity unlock (250 pts) · Double slayer-XP unlock (100 creds) | ✅ Done | Med |
| **3** | Combat magic | Blood/chaos/death rune spells + Wrath tier | ⬜ Pending | Med |
| **4** | Combat feedback | Hit markers · potion icon · purple fireworks >1m · KC gating | ✅ Done | Med |
| **5** | PvP bot coverage | Bots for every combat level (±10 band) | ✅ Done | Med–High |
| **6** | Economy & persistence | Everything tradeable (allowlist) · reduce DB writes · charge-loss-in-bank | ✅ Done | High |

---

## Completed work — handoff notes for next agent

### Phase 1 — Quick-win bug fixes ✅ (commit `5b39fbc`)

All four items shipped and gate-green.

| Item | What was done |
|------|--------------|
| 1.1 Slayer purchase bug | `SlayerScreen.jsx:6` — added `ownsItem` to import; `SlayerScreen.jsx:297` — changed bare-string call to `ownsItem({ itemId: unlock.itemId, bank, inventory })`; extended `tests/slayerUnlocks.test.ts` |
| 1.2 PvP defeat HP=0 | `PvpCombatScreen.jsx:1083–1085` — `self={youWon ? pair.self : { ...pair.self, hp: 0 }}` |
| 1.3 Drop confirmation | `InventoryScreen.jsx` — added `showDropConfirm` state; `handleDrop` now sets the state rather than immediately dropping; `confirmDrop()` performs the actual null-slot op; confirmation Modal rendered at bottom |
| 1.4 Gargoyle dust price | `items.json` — `gargoyle_dust.shopValue` 1500 → 750 |

### Phase 2 — Slayer progression unlocks ✅ (commit `4806e16` + bug-fix commits `49cd5ce`, `8e73c5f`)

**New files:**
- `src/screens/CharacterUnlockScreen.jsx` — lists permanent credit-purchased unlocks. Currently has one entry: Double Slayer XP (100 credits, stateKey `doubleSlayerXp`). Calls `api.purchaseUnlock(unlock.id)`, dispatches `CREDITS_UPDATED_EVENT`, calls `updateCharacterUnlock`, then `requestCriticalPushSave`.
- `functions/api/unlocks/purchase.js` — server endpoint. Atomically debits credits with `UPDATE … WHERE credits >= ? RETURNING credits_remaining`, emits audit event, returns `{ ok, unlock_id, credits_remaining }`. Server-side `UNLOCK_REGISTRY` prevents client price-picking.

**Modified files:**
- `src/engine/slayerMasters.js` — `buildSlayerTask` accepts `options.quantityMultiplier`; applies `Math.floor(totalCount * quantityMultiplier)` (ember_tyrant capped at 1 regardless).
- `src/engine/slayerRewards.js` — `getSlayerTaskXpForKill` accepts `options.doubleXp`; returns `Math.floor(xp * 2)` when set. Multipliers: default ×2, boss ×10; with `doubleXp` these become ×4 and ×20.
- `src/engine/idleEngine.js:1394` — `simulateIdleCombat` reads `options.doubleSlayerXp`; multiplier is 4 (perk active) or 2 (no perk). Bosses still return `null` from this function (they're excluded from idle simulation) — boss XP is handled in the active combat path (CombatScreen).
- `src/state/gameState.jsx` — added `slayerPerks` state + ref + `updateSlayerPerk`; added `characterUnlocks` state + ref + `updateCharacterUnlock`; both loaded from IDB in `loadGame` `Promise.all`; both in `getSnapshot()`; idle combat sim call threads `doubleSlayerXp: !!(savedCharacterUnlocks?.doubleSlayerXp)`.
- `src/screens/SlayerScreen.jsx` — destructures `slayerPerks, updateSlayerPerk`; `assignTask` passes `quantityMultiplier: 2` when perk active; Perks section added (Slayer Multitask, 250 pts); `handleUnlock` cloud path now calls `api.getSave()` after `api.completeSlayer()` and applies the save via `applyCloudSave` before `loadGame()` (fixes stale-IDB overwrite bug).
- `src/screens/CombatScreen.jsx` — destructures `characterUnlocks`; passes `{ doubleXp: characterUnlocks?.doubleSlayerXp }` to `getSlayerTaskXpForKill`.
- `src/App.jsx` — destructures `characterUnlocks` from `useGame()`; skip-hour `simulateIdleCombat` call passes `doubleSlayerXp: !!(characterUnlocks?.doubleSlayerXp)`.
- `src/utils/constants.js` — `SCREENS.CHARACTER_UNLOCKS: 'character_unlocks'`
- `src/components/navTabs.js` — added Unlocks tab (✨)
- `build_single.cjs` — `'screens/CharacterUnlockScreen.js'` in both `sourceFiles` and `GAME_CHUNK_FILES`
- `src/cloud/api.js` — `api.purchaseUnlock(unlockId)` — POST `/api/unlocks/purchase`
- `tests/slayerRewards.test.ts` — three new cases for `doubleXp` option (normal, boss, false)

**Bug fixes shipped after Phase 2 delivery:**
1. `CharacterUnlockScreen` — after `updateCharacterUnlock`, now calls `requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.PURCHASE)` so the flag reaches the cloud in the same round-trip as the credit debit.
2. `SlayerScreen handleUnlock` cloud path — `api.completeSlayer` returns `{ ok, ...applied }`, not `{ save: { save_data } }`. Fixed: pull via `api.getSave()` then `applyCloudSave(...)` before `loadGame()`.
3. Skip-hour `simulateIdleCombat` in `App.jsx` was missing `doubleSlayerXp` because `characterUnlocks` was not in the `useGame()` destructure. Fixed.

### What tests exist

- `tests/slayerUnlocks.test.ts` — purchase allowed/blocked, `ownsItem` object-form
- `tests/slayerRewards.test.ts` — all multiplier cases including `doubleXp` and boss stack
- All 1403 tests pass on the branch as of last push.

### Phase 4 — Combat feedback ✅ (commit `159894e`)

| Item | What was done |
|------|--------------|
| 4.1 Hit markers | New `src/components/HitSplat.jsx` (`HitSplatLayer`) + pure mapper `src/utils/hitSplats.js` (`splatsFromCombatEvents`); red damage / blue 0 splats float over both HP bars on the PvE combat screen; plain "You hit X"/"Monster hits X"/miss log lines removed (special/dragonfire/heal/info lines kept). PvP wiring deferred to the new PvP design per plan. CSS in `src/index.css` (`.hit-splat*`, reduced-motion safe). |
| 4.2 Potion icon | New `src/components/ActivePotionBadges.jsx` — GameIcon + remaining seconds per active potion, rendered next to the player HP bar. Reads `combat.activePotions` (`{ potionItemId: ticks }`). |
| 4.3 Purple fireworks | `LootResultModal` `buildParticles` gained a `purple` theme (plus surface/seal/title/button CSS). Triggered when loot value > 1m via `getLootTotalValue`/`isEpicLootValue` (`src/utils/itemValue.js`) at all three call sites: PvE kill modal (CombatScreen), PvP victory modal (uses existing `pvpLootTotal`), idle welcome-back modal (gained sources only). |
| 4.4 KC gate | `killCountsLoaded` flag in gameState (+ `markKillCountsLoaded`); set when the App's `fetchKillCounts` promise settles (success or fail; also set for brand-new characters; reset on `initCloudAndSave` for character switches). CombatScreen renders a spinner until it's set. Merge extracted to `src/utils/killCountMerge.js` (`mergeKillCounts`, max per id). |

Tests: `tests/hitSplats.test.ts`, `tests/itemValue.test.ts`, `tests/killCountMerge.test.ts`. New components registered in `build_single.cjs` `sourceFiles` (components are core; only screens go in `GAME_CHUNK_FILES`).

### Phase 5 — PvP bot coverage ✅ (commit `a828a9e`)

7 new templates in `src/data/pvpBots.json` so every CB 3–126 has a bot within the lobby's ±10 band: rustyblade (CB 10), thornduel (25), galearcher (39), runewarden (56), mistarcher (71), drakechampion (96), veilbreaker (112) — existing maxpurebot (83) and maxmainbot (126) fill the top. No mage archetype: PvP combatants start `spell: null` and the bot AI never selects a spell, so a staff bot would deal 0 damage. All loadouts meet their own equip requirements. `npm run seed:bots` script added to package.json (seed script was already data-driven). Coverage regression test: `tests/pvpBotCoverage.test.ts` (±10 coverage via the real server CB formula, 28-slot inventories, equip-requirement consistency, unique ids, food on board).

### Phase 6 — Economy & persistence ✅ (commit `3e7ee84`)

| Item | What was done |
|------|--------------|
| 6.1 Tradeable audit | 25 items lost `isUntradeable`. Kept untradeable (38): minigame rewards, 17 skill capes, Zesta ×3, quest rewards (`ava_s_*`, `cryptbound_gloves`), `coins`, and construction feature tokens `money_purse`/`master_rejuvenation` (perk lives in `unlockedFeatures`; trading the token would dupe it). New `isSpecialSource` flag (22 items: slayer gear, dungeoneering gear, fire/infernal capes, shardglass, godsword shard, clue scrolls): listable on the player order book + store-visible for discovery, but blocked from infinite-store purchase (`SPECIAL_SOURCE_RESTRICTED` in `storeRules.js`; `isOrderBookItem` extended in both `storeRules.js` and `tradingPost.js`). `fire_cape` shopValue 2m, `infernal_cape` 10m. Test: `tests/tradeableAllowlist.test.ts` derives the allowlist from live data files. |
| 6.2 DB writes | `/api/save`: skips the `characters` summary UPDATE when total/combat level unchanged (ownership SELECT now returns both columns); skips the whole write on a no-op save (payload unchanged modulo the volatile top-level `timestamp`), returning the current revision with `noop: true`. Client `sync.js`: `saveContentKey` (timestamp-normalized) of the last successful push; identical 60s pushes are skipped and reported as saved. Stale-write + regression guards intact. Tests: `tests/saveEndpoint.test.ts`, `tests/syncDirtyCheck.test.ts`. |
| 6.3 Bank charges | **Root cause found:** `functions/_lib/game/inventory.js` `normalizeSaveItemIds`/`addItemToBank`/`removeItemFromBank` rebuilt bank entries as bare `{itemId, quantity}` — every trading-post/MCP/action endpoint call wiped `charges` from every banked chargeable item. All three now spread the existing entry. Also fixed `BankScreen.jsx` partial-withdrawal charge duplication: withdrawals now take a proportional `Math.floor` share of the merged charge pool (full pool when the entry empties) and the bank keeps the rest. Test: `tests/bankCharges.test.ts`. |

All 1514 tests pass; `npm run ci` green.

---

> **Deferred (not in this batch):** the **mobile combat UI redesign** is on hold — the product owner will produce a new **Claude-designed mobile PvP interface** separately. This batch must **not** restyle the combat/PvP screen layout. The functional feedback features in Phase 4 (hit markers, potion icon, fireworks, KC gate) still ship, built as reusable pieces that the future PvP design can adopt (see Phase 4 notes on PvP scope).

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

Two new unlocks using *different currencies* and *different homes*: the **slayer-point** unlock (2.1) stays in the Slayer screen's unlocks section; the **credit** unlock (2.2) lives in a **new Character Unlock screen** (per product owner).

### 2.1 — New slayer-point unlock: "Double assigned quantity" (250 points)
A purchasable, persistent account perk (not a banked item like the existing `SLAYER_UNLOCKS`, which all grant gear). It doubles the monster count of newly assigned tasks.

**Implementation:**
- Persist a boolean perk on the save (client-authoritative — slayer assignment is client logic). Add to the slayer state in `src/state/gameState.jsx` (e.g. `slayerPerks: { doubleQuantity?: boolean }`) and include it in `getSnapshot`/load.
- **Apply** in `src/engine/slayerMasters.js:144` `buildSlayerTask(master, monsterId, isBoss, options)` — accept `options.quantityMultiplier` and multiply `totalCount` (line 151-156) with `Math.floor` (CLAUDE.md §4). Thread the perk from `SlayerScreen.jsx` `assignTask` (line 88) into the call.
- **Purchase UI:** add a non-gear "perk" entry alongside the gear `SLAYER_UNLOCKS` section in `SlayerScreen.jsx` (cost 250 pts, deduct via `updateSlayerPoints`, mark perk true, critical-save). Show "Owned" once active.

**Files:** `slayerMasters.js`, `gameState.jsx`, `SlayerScreen.jsx`, save snapshot. **Tests:** `buildSlayerTask` with `quantityMultiplier: 2` doubles `totalCount`/`monstersRemaining`; perk persists through a save round-trip.

### 2.2 — New credit unlock: "Double Slayer XP" (100 credits) — **permanent, in a new Character Unlock screen**
**Confirmed (product owner):** the unlock is **permanent / account-wide**, and lives in a **new dedicated Character Unlock screen** (the first home for credit-purchased permanent perks; future unlocks land here too).

**Credits are server-authoritative** (CLAUDE.md §14; debited in `functions/api/skip-hour.js:42` and `functions/api/slayer/skip.js`), so the purchase needs a server debit.

**Implementation:**
1. **New server endpoint** `functions/api/unlocks/purchase.js` (generic, so future credit unlocks reuse it). Takes an unlock id, atomically debits its credit cost (`UPDATE characters SET credits = credits - ?, credits_used = credits_used + ? WHERE … AND credits >= ?` with `RETURNING credits`, mirroring `skip-hour.js:42-53`), returns `credits_remaining`, emits an audit event (§14), and rejects 402 on insufficient credits. Keep a server-side registry of valid unlock ids + costs so the client can't pick the price.
2. **Persist the perk flag** in the client save (e.g. `characterUnlocks: { doubleSlayerXp: true }`) via `src/state/gameState.jsx` + `getSnapshot`/load. Permanent once set. After a successful debit the client sets the flag, critical-saves, and dispatches `CREDITS_UPDATED_EVENT`. (The flag is client-authoritative, consistent with slayer XP already being client-side §14; the *credit debit* is the server-authoritative part.)
3. **Apply the multiplier** in `src/engine/slayerRewards.js:37` `getSlayerTaskXpForKill` — accept a `doubleXp`/multiplier arg and apply with `Math.floor`. **Default: applies as a final ×2 on the awarded slayer task XP, stacking on top of the existing default ×2 / boss ×10** task multipliers (`slayerRewards.js:1-2`). Thread the flag into every caller (grep `getSlayerTaskXpForKill` — the combat slayer-reward path).
4. **New screen `src/screens/CharacterUnlockScreen.jsx`** — lists permanent unlocks with credit price, "Owned" state, and a buy button calling the endpoint. Reuse the credits top-up UI (`BuyCreditsModal.jsx`). **Wiring (single-file build §12):**
   - add `MAGIC`-style `SCREENS.CHARACTER_UNLOCKS` to `src/utils/constants.js`;
   - register `'screens/CharacterUnlockScreen.js'` in **both** `build_single.cjs` `sourceFiles` **and** `GAME_CHUNK_FILES` (in-game screen), unique top-level names, `npm run check:single` green;
   - add a `case SCREENS.CHARACTER_UNLOCKS` in `App.jsx` `renderScreen`;
   - add a reachable entry point (Stats/Home or Skills hub — confirm placement during impl; a button on the Stats/character screen is the natural home).

**Default to confirm only if you disagree:** the ×2 stacks with boss ×10 (so a boss slayer kill becomes ×20). Say the word if you want it to *not* stack with the boss multiplier.

**Files:** new `functions/api/unlocks/purchase.js`, new `src/screens/CharacterUnlockScreen.jsx`, `slayerRewards.js`, `gameState.jsx`, `constants.js`, `build_single.cjs`, `App.jsx`. **Tests:** endpoint debits/rejects + audit emitted; `getSlayerTaskXpForKill` doubles (and stacks with boss ×10) when flag set; perk persists through a save round-trip; `check:single` passes.

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

## Phase 4 — Combat feedback

Functional combat-feedback features only — **no layout/visual redesign** of the combat or PvP screens (that's the deferred Claude-designed mobile PvP interface). Build the hit-splat and potion-icon as **reusable, self-contained components** so the future PvP design can drop them in. Reference `docs/loot-modals-redesign-plan.md` for the fireworks/loot modal; **audit existing scaffolding first, don't duplicate.** Consider sub-deliveries (4.1+4.2 PvE feedback, 4.3 fireworks, 4.4 KC gate).

**PvP scope decision (assumption — flip if you prefer):** implement hit markers + potion icon on the **PvE** combat screen now, and the **shared component**, but **defer wiring them into `PvpCombatScreen.jsx`** so we don't invest in a screen the new Claude PvP design will replace. Fireworks (4.3, shared modal) and KC gating (4.4, PvE) are layout-independent and ship for their normal surfaces regardless.

### 4.1 — Hit markers replacing chat-based combat info (PvE now; PvP with the new design)
Replace the textual combat log with floating hit splats over the damaged combatant's HP area on the **PvE** combat screen (`CombatScreen.jsx`).
- **Source of truth:** the combat tick already emits damage events. PvE: `src/engine/combat.js` pushes `events` (e.g. `noRunesForSpell` at line 708; damage values computed around 691-702). PvP (for later): tick processing in `functions/api/pvp/match/[id]/tick.js` / `src/engine/pvpEngine.js`, surfaced through `state.recentEvents` (see `pvpEndSummary.js:51`).
- **UI:** a small reusable `HitSplat` component (register in `src/components/` + `build_single.cjs` `sourceFiles`/`GAME_CHUNK_FILES` per §12) rendered near the target HP bar: **red splat with the damage number when >0**, **blue "0" splat when 0 damage**. Animate up-and-fade; key by event id so each hit shows once. Drive from the per-tick damage events.
- Retire the chat-style info feed on the PvE screen once splats cover the same info (keep a minimal log only if product wants history). Leave `PvpCombatScreen.jsx`'s log untouched for now (handed to the new PvP design with the shared `HitSplat` ready to use).

### 4.2 — Active-potion icon near HP (PvE now)
Show an icon next to the PvE HP bar indicating an active potion boost, with the **correct icon per potion type**. Boost/potion state is tracked in the combat boost logic (`combat.js:1043-1063` applies combat/magic boosts). Surface the active boost type + remaining duration and render the matching potion icon (use `src/utils/itemIcons.js` / `GameIcon`). Build it reusable; PvP wiring (PvP potions: `src/engine/pvpPotions.js`) lands with the new PvP design.

### 4.3 — Purple fireworks for drops >1m value
`LootResultModal.jsx` already has a particle burst (`buildParticles(theme)`, line 9) with `gold`/`blood` themes and a purple `loot-row--highlight` row style. Add a **purple/epic** particle palette and trigger it when the loot's value exceeds **1,000,000**.
- Add a `purple` (or `epic`) branch to `buildParticles` (purple palette) and let callers pass it.
- Compute drop value via `src/utils/itemValue.js`; threshold `> 1_000_000`. Apply at the **three call sites**: PvE loot modal (`CombatScreen.jsx`), PvP end modal (`PvpCombatScreen.jsx:1058`), and the **idle results modal** (`setIdleResult` flow in `App.jsx`). Pass `theme="purple"` (or an `epic` flag) when the relevant total exceeds 1m; keep gold/blood otherwise.

### 4.4 — Don't render the combat screen until KC has loaded
**Current:** `fetchKillCounts()` is fire-and-forget (`App.jsx:1194-1202`), merged via max(local, server); `CombatScreen.jsx` reads `killCount` (state default 0) and gates display on `killCount > 0` (e.g. line 2406-2410). On a cold cache KC is briefly missing.
**Fix:** expose a `killCountsLoaded` signal (resolve when `fetchKillCounts()` settles, success *or* fail, per character) and **gate the combat screen render** on it — show a lightweight loading state until KC has returned, then render. Scope the gate to the combat screen specifically (do **not** block global `setGameReady`, to protect startup time). Persist server KC back to IndexedDB so the next cold load is warm.
**Files:** `App.jsx`, `src/cloud/killCounts.js`, `CombatScreen.jsx` (+ `CombatMobileSelect.jsx`). **Tests:** merge/loaded-flag logic unit test.

> *(Mobile combat UI redesign removed from this batch — deferred to the separate Claude-designed mobile PvP interface. Do not restyle combat/PvP screen layout here.)*

**Files:** `CombatScreen.jsx`, `LootResultModal.jsx` (fireworks), new reusable `HitSplat`/potion-icon components, `App.jsx` + `src/cloud/killCounts.js` (KC gate), `src/index.css`. PvP end modal (`PvpCombatScreen.jsx:1058`) only for the fireworks theme prop — no layout changes. **Tests:** logic-only (splat event mapping, fireworks >1m threshold, KC loaded-flag/merge).

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
**Current:** `functions/_lib/game/tradingPost.js:49` `isTradingPostListable` already lists any item that is **not** `isUntradeable` and has `shopValue > 0` (boss/raid/clue uniques go via the order book, line 44). So "make everything tradeable" is largely a **data audit of `isUntradeable` flags** in `items.json`, plus ensuring listable items have a `shopValue`.

**Confirmed untradeable allowlist (everything else becomes tradeable):**
- **Minigame reward items** (collection-log `minigame` items).
- **Skill capes** (the 20 capes — keep their own buy path per `docs/feature-plan-2026-06.md` Feature 5; stay off the order book).
- **Zesta / PvP bot reward items** (`zesta_longsword`, `zesta_vest`, `zesta_skirt` — CLAUDE.md §10).
- **Quest reward items.**

**Implementation:**
1. Build the keep-untradeable set programmatically where possible: derive minigame items from `src/data/collectionLog.json` (`minigame` category), skill capes from the cape id set / `isSkillCape`, Zesta from the `pvp_bots` section, and quest rewards from `src/data/quests.json` reward tables. Anything in these sets keeps `isUntradeable: true`.
2. For **every other** item currently `isUntradeable: true` (or with `shopValue: 0`) that *should* be player-tradeable, clear `isUntradeable`/set a sensible `shopValue` in `items.json` so it lists. Use `src/utils/itemValue.js`/existing `shopValue`s for pricing; don't invent wild values.
3. Verify the purchase/sell/visibility gates honour the new flags: `src/engine/storeRules.js` (`getPurchaseRestriction`, `isStoreVisibleItem`), `functions/api/purchase.js`, and the trading-post search. Add an audit event for any new economy path (§14).
4. `TradingPostScreen.jsx` surfaces newly-listable items automatically once flags/shopValue are set — verify search/visibility.

**Files:** `src/data/items.json` (primary), `tradingPost.js`/`storeRules.js` (verify), `TradingPostScreen.jsx` (verify). **Tests:** extend `tests/tradingPost.test.ts` — newly-tradeable items list/sell; **assert each allowlist category (minigame, skill capes, Zesta, quest rewards) stays unlistable** so a future data edit can't accidentally expose them.

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
- **Resolved product decisions (2026-06-09):** 2.2 Double Slayer XP is **permanent**, lives in a **new Character Unlock screen**; mobile combat redesign **deferred** to a separate Claude-designed PvP interface (no layout changes here); 6.1 untradeable allowlist = **minigame items, skill capes, Zesta/PvP bot rewards, quest reward items** — everything else runs through the trading post.
- **Remaining minor assumptions (flip if you disagree):** double-XP ×2 **stacks** with the boss ×10 / default ×2 task multipliers (2.2); hit markers + potion icon ship on **PvE now**, PvP wiring lands with the new PvP design (Phase 4).
