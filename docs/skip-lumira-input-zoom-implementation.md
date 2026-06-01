# Implementation Guide — Boss Skip, Lumira Brew Eat, and Mobile Input Zoom

> **Scope**: Three independent feature requests bundled into one guide. Each section is
> self-contained (current behaviour → design → step-by-step changes → tests). They can be
> shipped together or in separate PRs.

## Summary of requests

1. **Skip works on boss/raid fights as an instant single kill.** Today the "Skip 1h" button
   is hard-blocked during boss/raid combat. The new behaviour: while in a boss or raid
   fight, the button relabels to **"Skip"** and, instead of simulating an hour, instantly
   kills the *current* monster (one lethal blow, charged like any other skip).
2. **Lumira Brew becomes unlimited and wired into Eat.** Today only one Lumira Brew (any
   `effect: "hp"` potion) can be active at a time. The new behaviour: a brew heals through
   the **Eat** path as well as the potion path, can be drunk any number of times, and **wipes
   all active potion effects** when consumed (e.g. an active Super Combat boost is cleared).
   The player may re-potion immediately after.
3. **Stop mobile browsers from zooming when an input is focused.** Tapping any text/number
   input currently triggers the iOS Safari focus-zoom. We want that suppressed (mobile only).

---

## Feature 1 — Boss/Raid "Skip" = instant single kill

### Current behaviour

The skip pipeline blocks boss/raid combat in **three** places that must all change:

- `src/engine/skipPreflight.js:106`
  ```js
  if (activeTask.type === 'combat' && (activeTask.monster?.boss || activeTask.raid)) return invalid('Cannot skip boss/raid combat.', 'combat', false)
  ```
- `src/App.jsx:1444-1448` — `handleSkip1h()` early-returns with a toast for boss/raid.
- `src/engine/idleEngine.js:896-897` — `simulateIdleCombat()` returns `null` for `monster.boss === true || task.raid === true`.

The Header button always reads "Skip 1h" (`src/components/Header.jsx:81`).

The live fight loop and death handling already exist and are the pieces we want to reuse:

- `processCombatTick` is imported and driven on every engine tick in
  `src/screens/CombatScreen.jsx:380`, and its emitted `events` are processed by the big
  `for (const ev of events)` loop at `src/screens/CombatScreen.jsx:390`.
- `checkMonsterDeath(state, monster, events)` in `src/engine/combat.js:166-299` already
  encapsulates *all* death semantics: Verzik phase advance, double-kill regen, **raid boss
  advancement**, raid completion, and normal boss death (it emits `monsterDeath` /
  `raidComplete` / `raidBossAdvance` events and flips `state.active`).

The `monsterDeath` event handler in CombatScreen (`src/screens/CombatScreen.jsx:720+`) already
performs KC tracking, slayer updates, and the **cloud-authoritative** loot/raid completion
(`api.completeRaid`, `api.completeMonster`). The whole point of the design below is to route
the instant kill through this exact path so loot, collection log, KC, slayer, and server
authority all "just work".

### Design

> **One Skip press = one lethal blow on the current monster form**, delivered through the
> existing death pipeline. We do **not** simulate an hour and we do **not** add a parallel
> boss-loot path.

Concretely:

1. Set `combatRef.current.monster.currentHP = 0`.
2. Run `checkMonsterDeath` once to produce the correct `events`.
3. Feed those `events` through the *same* event-processing loop the tick uses.

This naturally handles every boss type:
- Normal boss → true death, loot rolls, combat ends.
- Raid boss → advances to next boss (`raidBossAdvance`), or completes the raid on the final
  boss. "Skip" therefore clears one raid boss per press — matching "it only skips 1 kill".
- Multi-phase (Verzik) / double-kill bosses → advances exactly one phase/round per press.
  (If product wants one press to fully clear phases, loop step 2 until it returns `true`; the
  recommended default is one blow per press for predictability and to keep the spec bar / HP
  carry-over semantics intact.)

Because the kill resolution lives in `CombatScreen` (which owns `combatRef`) but the button
lives in the global `Header`/`App`, bridge the two with a registered imperative handle.

### Step-by-step

**1. Export an instant-kill helper from the engine** (`src/engine/combat.js`).

`checkMonsterDeath` is currently module-private. Add a thin exported wrapper near it:

```js
// Force the current monster to die this instant, reusing all death/phase/raid
// semantics. Returns the events array (monsterDeath / raidBossAdvance / raidComplete / …).
export function applyInstantKill(state) {
  const events = []
  if (!state || !state.monster) return events
  state.monster.currentHP = 0
  checkMonsterDeath(state, state.monster, events)
  return events
}
```

**2. Refactor CombatScreen's event loop into a callable function.**

The `for (const ev of events) { … }` block starting at `src/screens/CombatScreen.jsx:390`
is large. Extract it into a stable callback so both the tick handler and the instant-kill
path use identical event handling:

```js
const processCombatEvents = useCallback((events) => {
  for (const ev of events) {
    // …existing body, unchanged…
  }
}, [/* same deps the effect already closes over */])
```

Then the tick handler calls `processCombatEvents(events)`. (If extraction is too invasive for
the PR, keep the loop inline in the tick handler and have the instant-kill path dispatch the
events into the same handler — but extraction is cleaner and avoids duplication.)

**3. Add the force-kill handler and register it for the global button.**

In `CombatScreen`:

```js
import { applyInstantKill } from '../engine/combat.js'

// Returns true if a kill was actually resolved (a live fight was in progress).
const forceKillCurrentMonster = useCallback(() => {
  const state = combatRef.current
  if (!state || !state.active || !state.monster) return false
  const events = applyInstantKill(state)
  combatRef.current = state
  setCombat({ ...state })
  processCombatEvents(events)
  return true
}, [processCombatEvents])
```

Register this imperative handle so `App` can invoke it. Mirror the existing context-setter
pattern (`setActiveTask`, etc.). The simplest addition is a shared ref provided by
`gameState` (e.g. `combatSkipHandlerRef`) that CombatScreen populates on mount and clears on
unmount:

```js
useEffect(() => {
  combatSkipHandlerRef.current = forceKillCurrentMonster
  return () => { combatSkipHandlerRef.current = null }
}, [forceKillCurrentMonster])
```

(Alternative: a `window` CustomEvent like the existing `CLOUD_SAVE_STATUS_EVENT` pattern. A
ref is preferred here because `handleSkip1h` needs a synchronous "did a kill happen?" answer
before charging a credit.)

**4. Branch `handleSkip1h` for boss/raid combat** (`src/App.jsx:1436+`).

Replace the early-return block at `src/App.jsx:1444-1448` with a dedicated branch *after* the
cloud-account check and *before* the generic preflight:

```js
const task = activeTaskRef.current
const inBossRaid = task?.type === 'combat' && (task.monster?.boss === true || task.raid === true)

if (inBossRaid) {
  const killHandler = combatSkipHandlerRef.current
  if (!killHandler) {
    addToast('Open the fight to skip a kill.', 'info')
    isSkippingRef.current = false
    return
  }
  // Charge first (server-authoritative credit spend), then resolve the kill.
  const result = await api.skipHour()
  setCredits(result?.credits_remaining ?? credits)
  const killed = killHandler()
  if (!killed) addToast('No active fight to skip.', 'info')
  else addToast('⏭️ Skipped to the kill', 'info')
  isSkippingRef.current = false
  return
}
```

> **Note on credit spend ordering**: charge before the kill so the spend is authoritative and
> consistent with the existing `api.skipHour()` flow (used for all other skips). If product
> prefers "only charge if a fight is live", call `killHandler()` first, and only call
> `api.skipHour()` when it returns `true`.

Also fix the `finally`/early-return bug visible at `src/App.jsx:1439-1442`: the non-cloud
branch returns **without** resetting `isSkippingRef.current = false`. Wrap the body in
`try/finally` or reset the flag on every exit while you're here.

**5. Remove the preflight and idle-sim blocks** so the generic (non-boss) path is unaffected
but the boss path is no longer hard-blocked:

- `src/engine/skipPreflight.js:106` — delete the boss/raid `invalid(...)` line. (The boss
  branch never reaches preflight because `handleSkip1h` handles it earlier, but removing the
  line keeps the module honest and unblocks any direct callers/tests.)
- `src/engine/idleEngine.js:896-897` — leave the `simulateIdleCombat` boss guard **in place**.
  Boss/raid kills must *not* go through the hour simulation; the guard correctly keeps idle
  simulation away from bosses. Only the live instant-kill path handles bosses.

**6. Relabel the Header button** (`src/components/Header.jsx`).

Add a prop so the button knows the active task is a boss/raid fight:

```js
export default function Header({ /* …existing… */, skipMode = 'hour' }) {
  // …
  <span>{skipMode === 'kill' ? 'Skip' : 'Skip 1h'}</span>
  // title attr: skipMode === 'kill' ? 'Skip to the kill (requires 1 credit)' : 'Skip 1 hour (requires 1 credit)'
```

Wire it from `App.jsx:1920` where `<Header … />` is rendered:

```js
skipMode={activeTask?.type === 'combat' && (activeTask?.monster?.boss === true || activeTask?.raid === true) ? 'kill' : 'hour'}
```

Use the reactive `activeTask` state (not the ref) so the label re-renders on task change.

### Edge cases & gotchas

- **Boss fights only exist while CombatScreen is mounted.** Idle/background does not tick boss
  combat (the idle guard). If a boss task is active but the screen is unmounted,
  `combatSkipHandlerRef.current` is `null` → show the "Open the fight to skip a kill." info
  toast and **do not** charge a credit.
- **Cloud authority**: the reused `monsterDeath` handler already calls `api.completeRaid` /
  the monster completion path for loot. Instant kill must therefore only set HP to 0 and emit
  events — never fabricate loot client-side. This preserves the security model in
  `CLAUDE.md §14`.
- **Phased/raid bosses**: one press = one form/boss. Document this in the PR; if product wants
  full-clear-per-press, loop `applyInstantKill` until `state.active === false` (raids still
  advance one boss at a time because each press is "one kill").
- **`isSkippingRef`**: ensure it is reset on the boss path too (see step 4).

### Tests

- `tests/skipPreflight.test.ts` (or wherever preflight is covered): remove/adjust the
  assertion that boss/raid returns `canSkip: false`.
- New `tests/combat-instant-kill.test.ts`:
  - `applyInstantKill` on a normal boss → emits a `monsterDeath` event and sets
    `state.active === false`.
  - On a mid-sequence raid boss → emits `raidBossAdvance`, keeps `state.active === true`,
    increments `currentBossIndex`.
  - On the final raid boss → emits `raidComplete` + `monsterDeath`, sets `state.active === false`.
  - On a Verzik-phased / double-kill boss → first call advances phase/round (returns combat
    still active), subsequent calls eventually reach true death.

---

## Feature 2 — Lumira Brew: Eat-compatible, unlimited, wipes potions

### Current behaviour

- Item def `src/data/items.json:8259` — `lumira_brew`: `type: "potion"`, `effect: "hp"`,
  `boost: 22`, `duration: 300`, `stackable: true`.
- `handlePotion(potionItemId)` in `src/screens/CombatScreen.jsx:1143-1198`:
  - Blocks a second potion of the **same `effect`** via the `hasPotionOfType` check
    (`src/screens/CombatScreen.jsx:1154-1161`) — this is what limits the player to one brew.
  - For `effect: 'hp'`, heals immediately, **and** still registers the brew in
    `activePotions[potionItemId] = durationTicks` (`:1178`), which is pointless for a pure heal
    and is what triggers the "already active" block on the next drink.
- `handleEat()` / `handleEatItem()` / `consumeFoodAt()` (`src/screens/CombatScreen.jsx:1068-1113`)
  only match `itemsData[...].type === 'food'`; brews are ignored by Eat entirely.
- Active potions are stored in `combatState.activePotions` and decremented every tick at
  `src/engine/combat.js:345-353`; their stat bonuses are applied at `combat.js:366-374`.

### Design

A Lumira Brew should behave like a **consumable heal that clears buffs**:

1. **Heals immediately** for `boost` (22) HP, capped at max HP — same as today.
2. **Does not register an ongoing `activePotions` entry** (it has no stat-over-time effect),
   so there is no "already active" gate → it is inherently **unlimited / repeatable**.
3. **Wipes all active potion effects**: set `combatState.activePotions = {}` on consume. After
   that the player can immediately re-drink Super Combat etc. (re-potion up).
4. **Eat path also drinks a brew**: the Eat button and direct inventory taps should treat a
   brew as a valid heal source, applying identical semantics.

> Decision to confirm with product: define "is a Lumira Brew" by item id (`lumira_brew`) or by
> a generic flag. **Recommended**: add `"wipesPotions": true` to the brew's item def and treat
> `type === 'potion' && effect === 'hp'` (or the flag) as the brew family. A data flag keeps the
> engine generic and lets future brews reuse the behaviour without code edits.

### Step-by-step

**1. (Recommended) Tag the brew in data** — `src/data/items.json:8259`:

```json
"lumira_brew": {
  "id": "lumira_brew",
  "legacy_item_id": "saradomin_brew",
  "name": "Lumira Brew",
  "type": "potion",
  "stackable": true,
  "shopValue": 5000,
  "icon": "🧪",
  "effect": "hp",
  "boost": 22,
  "duration": 300,
  "wipesPotions": true,
  "isGeneralStore": false
}
```

**2. Add a shared "consume brew" helper** in `CombatScreen` (next to `consumeFoodAt`):

```js
const isLumiraBrew = (item) => !!item && item.type === 'potion' && (item.wipesPotions === true || item.effect === 'hp')

// Drink a brew from a specific inventory slot: heal, wipe active potions, no duration entry.
const consumeBrewAt = (idx, newInv) => {
  const brew = itemsData[newInv[idx].itemId]
  if (!brew) return
  if (newInv[idx].quantity > 1) newInv[idx] = { ...newInv[idx], quantity: newInv[idx].quantity - 1 }
  else newInv[idx] = null
  updateInventory(newInv); inventoryRef.current = newInv

  const maxHP = getMaxHP()
  const healing = brew.boost || 10
  const newHP = Math.min(hpRef.current + healing, maxHP)
  updateHP(newHP); hpRef.current = newHP

  if (combat) {
    const newState = { ...combatRef.current, activePotions: {} } // wipe all buffs
    const eaten = applyEat(newState)                              // reuse eat-delay binding
    setCombat(eaten); combatRef.current = eaten
  }

  setLog(prev => [...prev.slice(-20), {
    text: `Drank ${brew.name}, healed ${healing} HP (potions cleared)`,
    type: 'heal', time: Date.now(),
  }])
}
```

> `applyEat(state)` (`src/engine/combat.js`, imported at `CombatScreen.jsx:15`) binds the
> post-consume tick delay so brew spam respects the same cadence as eating food. Reusing it
> keeps brew/food timing consistent. Confirm whether brews should share the food eat-cooldown
> or be independent — default to sharing it (simplest, prevents infinite same-tick healing).

**3. Route Eat through the brew helper** — update `handleEat` /
`handleEatItem` (`src/screens/CombatScreen.jsx:1068-1082`):

```js
const handleEat = () => {
  const newInv = [...inventoryRef.current]
  // Prefer food; fall back to a brew so "Eat" works with brews too.
  let idx = newInv.findIndex(s => s && itemsData[s.itemId]?.type === 'food')
  if (idx !== -1) return consumeFoodAt(idx, newInv)
  idx = newInv.findIndex(s => s && isLumiraBrew(itemsData[s.itemId]))
  if (idx !== -1) return consumeBrewAt(idx, newInv)
  addToast('No food!', 'error')
}

const handleEatItem = (itemId) => {
  const item = itemsData[itemId]
  const newInv = [...inventoryRef.current]
  const idx = newInv.findIndex(s => s && s.itemId === itemId)
  if (idx === -1) return
  if (item?.type === 'food') return consumeFoodAt(idx, newInv)
  if (isLumiraBrew(item)) return consumeBrewAt(idx, newInv)
}
```

**4. Make the potion tap path drink the brew too** — in `handlePotion`
(`src/screens/CombatScreen.jsx:1143`), short-circuit before the `hasPotionOfType` gate:

```js
const potion = itemsData[potionItemId]
if (!potion) return
if (isLumiraBrew(potion)) {
  const idx = newInv.findIndex(s => s && s.itemId === potionItemId)
  if (idx !== -1) consumeBrewAt(idx, newInv)
  return
}
// …existing hasPotionOfType gate + normal potion logic for non-brew potions…
```

This removes the "already active" block for brews only; all other potions keep their
one-per-effect rule. The inventory `onClick` routing at
`src/screens/CombatScreen.jsx:2066-2067` (`type === 'food'` → eat, `type === 'potion'` →
potion) needs no change because brews are `type: "potion"` and `handlePotion` now forwards them
to the brew path.

**5. UI labels (optional polish)** — the potion-detail strings at
`src/screens/CombatScreen.jsx:2462-2469` describe `effect === 'hp'` as `+N HP`. Optionally
append "· clears potion effects" for brews so the wipe behaviour is discoverable.

### Edge cases

- **Brew no longer shows in the active-potions HUD** (`CombatScreen.jsx:2086-2098`) — correct,
  since it has no lingering effect. Verify no code assumes `activePotions[lumira_brew]` exists.
- **Wipe semantics**: `activePotions = {}` removes *all* timed buffs (attack/strength/combat/
  etc.). This matches "if a super combat is applied, it won't be after a player applies it."
  Confirm with product that wiping **all** buff potions (not just combat) is intended.
- **Idle combat brews**: idle combat consumes supplies via `idleCombatSetup.potions`
  (`src/App.jsx:1610`, engine `simulateIdleCombat`). This request is about the **live** Eat/
  potion UI. If brews should also wipe buffs during idle simulation, that is a separate change
  in `idleEngine.js` — out of scope unless product asks.

### Tests

New `tests/lumira-brew.test.ts` (logic-only; extract the wipe/heal core into a pure helper if
needed so it is testable without Preact):

- Drinking a brew with an active Super Combat → `activePotions` becomes `{}` and HP increases
  by `boost` (capped at max).
- Brew can be consumed N times in a row (no "already active" rejection).
- After a brew wipe, applying Super Combat again succeeds (re-potion up).
- Eat path with no food but a brew present consumes the brew and heals.

---

## Feature 3 — Suppress mobile input focus-zoom

### Current behaviour

- Viewport: `src/index.html:5` → `width=device-width, initial-scale=1.0, viewport-fit=cover`.
- No global form-control font-size rule exists in `src/index.css` (base styles at
  `src/index.css:36-50`).
- There are ~14 `<input>`/`<select>`/`<textarea>` elements (auth, bank, inventory amount,
  trading post, equipment, etc.), many styled with small Tailwind text sizes (`text-xs`, etc.).

**Root cause**: iOS Safari auto-zooms when a focused form control has a computed
`font-size < 16px`. Any input smaller than 16px triggers the zoom.

### Design

The reliable, accessibility-friendly fix is to ensure focused form controls render at
**≥ 16px**. Do **not** rely on `maximum-scale=1, user-scalable=no` — modern iOS ignores
`user-scalable=no` for accessibility and it also disables legitimate pinch-zoom.

Add a single global rule to `src/index.css` (this file feeds **both** the Vite build and the
single-file build — see `build_single.cjs:224` and `:298`, so one edit covers all outputs):

```css
/* Prevent iOS Safari from auto-zooming when focusing form controls.
   Any computed font-size below 16px triggers the zoom, so floor it at 16px. */
input,
select,
textarea {
  font-size: 16px;
}
```

> **Why 16px and not a transform hack**: 16px is the documented threshold and also satisfies
> the 44×44px tap-target rule in `CLAUDE.md §9`. The visual size of the affected inputs grows
> slightly — verify the handful of dense layouts below still look right; if any input must stay
> visually tiny, scope the rule away from it explicitly rather than dropping below 16px.

### Step-by-step

1. Add the rule above to `src/index.css` (near the base element styles around line 36-50).
2. Audit the small-text inputs and confirm layouts hold (these are the dense ones):
   - `src/screens/BankScreen.jsx:357,501,673`
   - `src/screens/InventoryScreen.jsx:766,806`
   - `src/components/TradingPostSellForm.jsx:22,35`
   - `src/screens/TradingPostScreen.jsx:524,537,610`
   - `src/screens/AuthScreen.jsx:185,201,228`
   - `src/screens/EquipmentScreen.jsx:374`
3. If a specific input visually regresses, keep it ≥16px but adjust padding/width rather than
   reducing font-size. (Tailwind `text-base` = 16px; replace `text-xs`/`text-sm` on inputs.)
4. Rebuild the single file and confirm the rule is present in generated `index.html`
   (`npm run rebuild`; the rule flows in via `customCSS` at `build_single.cjs:298`).

### Tests / verification

This is CSS/visual — no Vitest coverage. Verify manually (or via the `verify`/`run` skills):

- iOS Safari (or Chrome devtools iPhone emulation): tap each input type (bank amount, auth
  email/password, trading post price/qty) → **no zoom**, no layout overflow.
- Desktop: inputs unchanged functionally.

---

## Build / test / commit checklist (from `CLAUDE.md §11`)

Run the full commit gate before pushing:

```bash
npm test && npm run build && npm run rebuild && npm run check:single
# or: npm run ci && npm test
```

- `src/index.html` regenerates as a build artifact — **do not** hand-commit `index.html`
  changes; let `npm run rebuild` produce it (per `CLAUDE.md §13`).
- New shared logic helpers (e.g. brew-wipe core) belong in `src/engine`/`src/utils`; keep
  `src/engine` UI-free.
- Add regression tests for Features 1 & 2 (Feature 3 is visual-only).
- Branch: `claude/skip-lumira-input-zoom-asqli`.

## Suggested PR split

| PR | Feature | Risk | Server-authority touch |
|----|---------|------|------------------------|
| 1 | Mobile input zoom (CSS only) | Low | None |
| 2 | Lumira Brew eat/unlimited/wipe | Medium | None (live UI only) |
| 3 | Boss/raid instant Skip | Higher | Reuses existing cloud loot/raid paths |

Ship PR 1 first (trivial), then PR 2, then PR 3 (most integration surface).
