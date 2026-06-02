# PocketRPG — Feature Plan & Implementation Guide

> Status: planning doc. Features are implemented **one at a time**, each on branch `claude/session-fmoCB`, each validated with the commit gate (`npm test && npm run build && npm run rebuild && npm run check:single`, or `npm run ci && npm test`) before commit.

Confirmed design decisions (from product owner):
- **Log→Plank**: keep conversions limited to the **4 existing tiers** (logs, oak, teak, mahogany). Do **not** add willow/maple/yew/magic/redwood plank items. The "all types" scope is satisfied by adding **noted-item support** to the existing conversions + Construction.
- **Skill capes**: buying from the trading post **requires level 99** in the matching skill, validated **server-side**.
- **Noted items**: consume **un-noted (carried) first, then noted** stacks. No new UI selector.

Recommended build order (low-risk → higher-risk): #2 → #3 → #1 → #4 → #5.

---

## Feature 1 — Bank tab ordering is broken

### Root cause
New items added to the bank never receive an `itemTabMap` entry, so they default to sort `position 9999` and pile up at the bottom of the **All** tab in arbitrary order. There is **no** "last position + 1" assignment anywhere. Placeholders already behave correctly (they retain their `itemTabMap` entry; only `clearPlaceholder` removes it).

Data model recap (`src/state/gameState.jsx`):
- `bank`: `Record<itemId, { itemId, quantity, charges? }>`
- `bankConfig.itemTabMap`: `Record<itemId, { tabIndex, position }>` (tabIndex 0 = All)
- `bankConfig.placeholders`: `Record<itemId, true>`

Insertion paths that currently skip ordering:
1. `src/state/gameState.jsx` idle-deposit loop (~lines 280–323)
2. `src/state/gameState.jsx` `addToBank` helper (~lines 592–603)
3. `src/engine/lootTransfer.js` `fillBank` (~lines 167–231, new entry ~221)

Display/sort logic: `src/screens/BankScreen.jsx` `getDisplayItems()` (~lines 38–74), `assignToTab` (~188–198), `clearPlaceholder` (~200–206), `reorderItems` (~209–242).

### Implementation
1. **Add a centralized helper** in `src/state/gameState.jsx` (or `src/engine/`), e.g.:
   ```js
   // Assigns a first-time order to any bank item missing one.
   // position = (max position across ALL itemTabMap entries) + 1, tabIndex 0.
   function ensureBankOrder(itemTabMap, itemId) {
     if (itemTabMap[itemId]) return itemTabMap // already ordered (incl. placeholders)
     const maxPos = Object.values(itemTabMap)
       .reduce((m, v) => Math.max(m, v?.position ?? -1), -1)
     return { ...itemTabMap, [itemId]: { tabIndex: 0, position: maxPos + 1 } }
   }
   ```
   Use a **global max position + 1** (not per-tab) so order is stable and monotonic regardless of which tab the item is later moved to. The All-tab sort already only honors `tabIndex === 0` positions, and `assignToTab`/`reorderItems` re-pack positions per tab when the user organizes — so a global counter is safe and avoids collisions.
2. **Call it on every first insert** in all three paths above, alongside the `bank[itemId] = { itemId, quantity }` creation, persisting the updated `itemTabMap` via the same `updateBankConfig`/save mechanism each path uses.
3. **Display fallback**: keep the `?? 9999` fallback in `getDisplayItems()` as a safety net for legacy saves, but new items will now always have a real position.
4. **Placeholder invariant** (already correct — verify, don't regress): becoming a placeholder keeps `itemTabMap[itemId]`; only `clearPlaceholder` deletes it. No change needed.
5. **Migration for existing saves**: optionally, on load, backfill `itemTabMap` for any banked item lacking one (assign in current display order) so existing players get stable ordering immediately. One-time pass in the load path in `gameState.jsx`.

### Tests
- New item → gets `position = currentMax + 1`.
- Item → 0 qty → placeholder retains position; re-deposit reuses same position.
- `clearPlaceholder` removes the position; a later re-deposit gets a fresh end position.
- Two new items deposited in one tick get distinct, increasing positions.

### Risk / files
Touches core state mutation + persistence. Medium risk. Files: `gameState.jsx`, `lootTransfer.js`, `BankScreen.jsx` (verify only), new test in `tests/`.

---

## Feature 2 — Stop dragon bones in the Vaults raid

### Root cause
Dragon bones are **raid-completion rewards**, not monster drops. Defined in `src/data/raids.json` for `vaults_of_xyren` in the `always` rewards array (`{ itemId: 'dragon_bones', quantity: [5,15], chance: 0.6 }`), at ~lines 25–30 and **duplicated** in the legacy-id block at ~lines 394–399. Granted by `rollRaidRewards(raid.rewards)` in `src/engine/combat.js:270`. Individual vault bosses (tekton, vespula, muttadile, the_great_olm) do not drop bones.

### Implementation
- Remove the `dragon_bones` entry from the `always` array in **both** the primary (`~25–30`) and legacy (`~394–399`) `vaults_of_xyren` definitions in `src/data/raids.json`.
- No engine change required.

### Tests
- Add/extend a raid-reward regression test asserting `rollRaidRewards(vaults_of_xyren.rewards)` can never yield `dragon_bones` (run many iterations / inspect the table).

### Risk / files
Low risk, data-only. Files: `raids.json`, raid-rewards test.

---

## Feature 3 — KC sometimes missing until refresh

### Root cause
`fetchKillCounts()` is **fire-and-forget** after `setGameReady(true)` (`src/App.jsx` ~1163–1167, ready flag ~1205). First render uses local IndexedDB KC (`gameState.jsx` ~485–486), which can be empty/stale on a fresh device or after a save where the cache wasn't written. The display is correctly conditional on `> 0` (`CombatScreen.jsx` ~1780, ~1837; `CombatMobileSelect.jsx` ~161, ~200), so empty cache → no KC until the async server fetch lands and re-renders — and on some loads that update appears to not land/merge cleanly.

### Implementation (non-blocking, robust — preferred)
Do **not** block `setGameReady` on the network (keeps startup fast). Instead make the async path reliably update and persist:
1. In the `fetchKillCounts().then(...)` handler (`App.jsx` ~1163–1167), ensure the server result is **merged** into state via `updateBossKillCounts` / `updateRaidKillCounts` **and written back to IndexedDB** (`setSetting('bossKillCounts'/'raidKillCounts')`), so the next cold load has a warm cache. Confirm these setters trigger a Preact re-render (they should via state setters).
2. Guard against a slow/failed fetch leaving stale UI: keep local cache as the immediate value, overwrite with server value when it arrives (server is authoritative for KC).
3. Verify the merge doesn't drop keys: replace empties with server data; prefer `max(local, server)` per id to avoid a transient empty server response zeroing the display.

(If product later prefers correctness-over-speed, the alternative is to `await fetchKillCounts()` before `setGameReady(true)` with a short timeout fallback — noted but not chosen here to protect load time.)

### Tests
- Logic test for the merge function: empty local + server data → server values; stale local + newer server → server (or `max`) values; failed fetch → local retained.

### Risk / files
Low–medium. Files: `App.jsx`, `src/cloud/killCounts.js` (verify), `gameState.jsx` (cache write), new merge unit test.

---

## Feature 4 — Noted items in Construction & log→plank (Gather)

Scope per decision: **noted support only**, conversions stay at the existing 4 tiers. No new plank items.

### Pattern to reuse
Magic Alchemy already handles noted matching: predicate `!!slot?.noted === !!selected.noted`, and `countInventoryItem(inventory, itemId, predicate)` in `src/engine/skipPreflight.js:7`. Consumption order requirement: **un-noted first, then noted**.

### Construction — `src/screens/ConstructionScreen.jsx`
- Counting (~84–89): count availability as `unnoted + noted` across inventory **and** bank for the material (`countItem` already sums both; bank stores noted/un-noted under the same id but the bank entry may carry a `noted` flag — confirm bank shape during impl).
- Consumption (~97–110): change to a two-pass removal — **first** remove from un-noted inventory slots, **then** noted inventory stacks, **then** bank (un-noted then noted). Use a predicate-aware remove rather than the noted-blind `removeItem`.

### Gather — `src/screens/GatherScreen.jsx`
- The 4 existing `convert_*_log_to_plank` tasks (~168–221) stay as-is in count/product.
- Availability (~317–322) and consumption (~323–349): apply the same un-noted-first-then-noted ordering for the `materials` (logs) so noted logs in inventory/bank are accepted.

### Shared engine support
- Add an optional `predicate`/`noted` parameter to `removeItem` in `src/engine/inventory.js` (or a new `removeItemMatching`) so both screens consume by noted status without duplicating loops.
- Ensure Gather/Construction **skip-hour preflight** (`src/engine/skipPreflight.js`) counts noted materials too, so offline/skip computation matches live behavior.

### Tests
- Construction with only noted planks in inventory → builds, consuming noted.
- Mixed noted + un-noted → un-noted consumed first.
- Gather log→plank with noted logs in bank → converts.
- Skip-hour preflight counts noted materials identically.

### Risk / files
Medium (shared engine helper + two screens + preflight). Files: `ConstructionScreen.jsx`, `GatherScreen.jsx`, `inventory.js`, `skipPreflight.js`, tests.

---

## Feature 5 — Buy skill capes from the Trading Post (require level 99)

### Current blockers
All 20 capes in `src/data/items.json` have `isUntradeable: true` and `isGeneralStore: false`, each with `requirements: { <skill>: 99 }` and `shopValue: 99000`. Untradeable is rejected by both `isTradingPostListable()` (`functions/_lib/game/tradingPost.js` ~42–48) and the purchase gate (`getPurchaseRestriction` in `src/engine/storeRules.js`, `assertPurchasable` in `functions/api/purchase.js`). Equip is already gated at 99 by `checkEquipRequirements` (`src/engine/equipment.js` ~15–28).

Capes are **not** order-book items (not boss/raid/clue uniques) → they belong on the **general-store buy** path (executes against the game via `/api/purchase`), not player-to-player matching.

### Implementation (server-authoritative buy with 99 requirement)
1. **Make capes buyable on the general-store path** without making them player-listable:
   - Preferred: keep `isUntradeable: true` (so players can't list/sell them and they stay off the order book) and instead **whitelist skill capes for purchase** in the store rules. Add an explicit allow in `storeRules.js` (`getPurchaseRestriction`) and the trading-post search/visibility (`isStoreVisibleItem`) for items identified as skill capes (e.g., a `isSkillCape: true` flag added to each cape in `items.json`, or a known id set).
   - This avoids the side effect of flipping `isUntradeable` (which would also enable selling/instant-sell/listing and Ironman implications).
2. **Server-side level-99 validation** in `functions/api/purchase.js`: when the purchased item is a skill cape, read the character's authoritative skill XP, compute level via the shared level helper, and reject with a clear error if `< 99` for the cape's required skill. Reuse the `requirements` map already on the item. Debit `shopValue` (99,000) coins and grant the cape server-side (existing `subtractCoins` + `addItemToInventory`/`addItemToBank` flow). Emit an **audit event** (per CLAUDE.md §14, progression-affecting mutation).
3. **Client/UI** (`src/screens/TradingPostScreen.jsx`): surface capes as buyable general-store entries; show price (99,000) and a "Requires level 99" state when the player isn't eligible (mirror the equip-requirement messaging). Block the buy button client-side too for good UX, but the server check is the real gate.
4. **Ironman**: keep existing behavior — these remain non-general-store/untradeable for Ironman unless product says otherwise (capes stay self-obtained). Confirm during impl.

### Tests
- Purchase endpoint: player with level 99 in skill + enough coins → granted, coins debited, audit emitted.
- Player < 99 → rejected, no debit, no grant.
- Insufficient coins → rejected.
- Cape still not listable/sellable on the order book (untradeable preserved).

### Risk / files
Medium–high (server endpoint + store rules + UI + economy). Files: `functions/api/purchase.js`, `src/engine/storeRules.js`, `functions/_lib/game/tradingPost.js` (visibility), `src/data/items.json` (add `isSkillCape` flag), `src/screens/TradingPostScreen.jsx`, server + logic tests.

---

## Feature 6 — Re-add the Magic skilling screen (dedicated screen)

### Root cause / current state
There is **no `MagicScreen` in git history** (repo history is a single squashed root commit), but Magic is **UI-orphaned**: all engine + data are intact, yet nothing routes to Magic skilling.

What still exists (no changes needed — verify only):
- **Engine**: `src/engine/runes.js` (`hasRequiredRunes`, `getRunesToConsume`, elemental-staff handling), Magic idle logic in `src/engine/idleEngine.js` (alchemy ~201–298, superheat, enchant, utility spells, rune consumption ~183/240), `src/engine/skipPreflight.js` (rune checks ~80–86, alchemy selection ~86–91), combat magic in `src/engine/combat.js`.
- **Data**: `src/data/skills.json` `magic` actions (`curse`, `high_alch`, `superheat`, `enchant_sapphire/ruby/diamond/dragonstone`), `src/data/spells.json` (combat spells), all rune items + elemental staffs in `src/data/items.json`.

Why it's unreachable:
- Magic is in `COMBAT_SKILLS` (`src/utils/constants.js:41`), so it's excluded from `SkillingScreen`'s `trainableSkills` (GATHERING + PRODUCTION only, `SkillingScreen.jsx` ~29–33).
- Not in `SPECIAL_SKILLS`, no `SCREENS.MAGIC`, no `navTabs` entry, no `renderScreen` case, not in `build_single.cjs`.
- No dangling references to a removed component, so re-adding adds new wiring rather than repairing broken links — low breakage risk.

### Implementation (dedicated screen — chosen)
1. **Create `src/screens/MagicScreen.jsx`** — model on `ConstructionScreen.jsx`/`AgilityScreen.jsx`. Responsibilities:
   - Read `magic` actions from `skills.json`; gate by level.
   - **Rune display + cost check** via `runes.js` (`hasRequiredRunes`/`getRunesToConsume`), accounting for equipped elemental staffs.
   - **Action types**: alchemy (needs an **item picker** for which item to High Alch — reuse the existing `selectedAlchemyItem` shape already consumed by `idleEngine.js`), superheat (materials + runes → bar), enchant (jewellery → enchanted), utility (curse).
   - Drive idle/active training through the **same engine entry points** the idle loop already uses — do not fork the consumption math. The screen sets the active action/selection; the engine consumes runes/materials and grants XP.
   - **Noted items**: alchemy already supports noted via `idleEngine`; keep the un-noted-first behavior consistent if Feature 4's helper lands first.
2. **`src/utils/constants.js`**: add `MAGIC: 'magic'` to `SCREENS`.
3. **`build_single.cjs`**: add `'screens/MagicScreen.js'` to **both** `sourceFiles` **and** `GAME_CHUNK_FILES` (it's an in-game screen), following the existing ordering convention (group near other skilling screens). Keep top-level names globally unique; `npm run check:single` must pass.
4. **`src/App.jsx` `renderScreen`** (~2060–2081): add `case SCREENS.MAGIC: return <MagicScreen .../>` mirroring the Construction delegation (pass `initialActionId`, `idleResult`, `onNavigate`).
5. **Navigation entry**: add a Magic entry so players can reach it. Two routes — pick during impl to match UX:
   - Add to `SkillingScreen`'s `SPECIAL_SKILLS` so the Skills tab shows a Magic tile that delegates to `MagicScreen` (consistent with Construction/Agility/etc. — **preferred**, keeps Magic under the Skills hub), **or**
   - Add a top-level `navTabs.js` entry. Avoid doing both (duplicate access). Recommended: `SPECIAL_SKILLS` delegation only.
6. **Skip-hour / idle**: confirm `skipPreflight.js` already validates magic rune/alchemy selection (it does) so skip-hour and offline catch-up work for the newly-reachable actions. No new server work (client-authoritative skilling, §14).

### Tests
- Magic appears in the skill picker and routes to `MagicScreen` without console errors.
- Each action type: sufficient runes → action succeeds, runes consumed (incl. elemental-staff discount); insufficient runes → blocked.
- Alchemy item-picker selection flows into the engine and consumes the correct noted/un-noted item.
- `npm run check:single` passes (no duplicate top-level identifiers across core + chunk).

### Risk / files
Low (additive UI/routing; engine untouched). Files: new `src/screens/MagicScreen.jsx`, `src/utils/constants.js`, `build_single.cjs`, `src/App.jsx`, `src/screens/SkillingScreen.jsx` (delegation), tests. **No engine/data changes.**

---

## Cross-cutting notes
- **Commit gate** before every commit/push (see top). Don't commit generated root `index.html` in normal changes; it's a build artifact.
- **Single-file build**: any new shared helper must keep globally-unique top-level names; run `npm run check:single`. No new in-game screens are introduced here, so `GAME_CHUNK_FILES` is unaffected.
- **Item naming**: any new/edited item `name` stays Title Case (no new items planned except possibly an `isSkillCape` flag, which is non-name).
- **Server authority (§14)**: only Feature 5 adds a server mutation — it must validate level server-side and emit an audit event. Bank ordering, KC merge, and noted consumption remain client-authoritative by design.
