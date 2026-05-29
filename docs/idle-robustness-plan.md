# Idle Robustness & Unified Activity Engine — Implementation Guide

> **Status:** Plan for review / handover. No code changes yet.
> **Owner branch:** `claude/idle-function-robustness-Mghpe`
> **Audience:** the engineer/agent who will implement this. Read §1–§4 for the design, §5+ for the concrete work.

---

## 1. Problem statement (player feedback)

Players are told they can "switch tabs and keep progressing", but in practice the **last known action is silently wiped** when they move away from a screen. The idle behaviour is inconsistent and confusing:

- **Closing/backgrounding the tab** persists the task (a `sendBeacon` fires) and offline progress is simulated on return.
- **Navigating to another screen inside the app** *wipes* the task for everything except quests, minigames, and one-shot gather tasks — so gathering, clues, combat, skilling, agility, thieving, and hunter all lose their action.

The two paths disagree, which is the root of the confusion.

### Goals
1. **Background activities** (quests, minigames, gathering, clues, agility, thieving, hunter, dungeoneering, farming) must **never lose progress**. Progress is **saved server-side per activity** and **read back on resume**, so a half-finished minigame/quest picks up exactly where it left off — even across sessions and devices.
2. **Foreground activities** (combat, processing skills) must make it **explicit** that they are *running* and will **stop** if you leave — you can only idle them while the modal/screen stays open.
3. Make the idle reward path **server-authoritative**: the server owns the clock, issues/verifies single-use nonces, and **re-validates + caps** the rewards a client claims before they are banked.
4. **Unify the skills/activity logic** into one shared engine to remove the per-skill duplication that exists today.

---

## 2. Decisions locked with product (do not re-litigate)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Server-authority depth | **Validate + cap client results.** Client keeps computing idle outcomes with the existing engine; the server owns the clock, claims/verifies nonces, and re-validates & caps rewards before persisting. (Not a full server-side port.) |
| 2 | Away-progress semantics | **Active task keeps accruing offline up to the max window (24h), as today.** *Additionally*: when the player **switches to a different activity**, the outgoing activity's partial progress **must be saved server-side** keyed by that activity, and **read back before the player restarts it**. |
| 3 | Background-persistent activities | Quests, Minigames, Clues, Gathering (WC/Mining/Fishing), **Agility, Thieving, Hunter, Dungeoneering**, and Farming (already passive wall-clock). |
| 4 | Foreground modal-bound activities | **Combat** and **processing Skilling** (cooking/smithing/crafting/fletching/herblore/runecraft/magic/firemaking/construction). |
| 5 | Deliverable | This committed markdown doc. |

> **Key clarification of Decision 2:** there is still only **one** active task accruing offline at a time. "Running while away" applies when the player leaves the *app* with a task active. When the player *switches* activities in-app, the previous activity is **banked** (frozen) into a per-activity ledger so it resumes later. Switching is the new "save", not a "wipe".

---

## 3. Current architecture (as-is)

### 3.1 The single active-task slot
- State: `activeTask` in `src/state/gameState.jsx` (`useState(null)`, ~line 44). Mutated via `setActiveTask` (~line 639) which writes `localStorage('pocketrpg_activeTask')` and fire-and-forget `pushIdleState(task)`.
- Task shapes (discriminated by `type`):
  - `skill` — `SkillingScreen.jsx`, `ConstructionScreen.jsx` (processing skills).
  - `gather` — `GatherScreen.jsx` (WC/mining/fishing), `CluesScreen.jsx` (`isClue:true`), one-shot minigame gather tasks (`gatherTask.oneShot`).
  - `combat` — `CombatScreen.jsx`.
  - `agility` / `thieving` / `hunter` — their dedicated screens.
  - `quest` — `QuestsScreen.jsx`.
  - `minigame` — `MinigamesScreen.jsx`.
  - Farming — wall-clock based in `src/engine/farming.ts`; **no** `activeTask`.

### 3.2 The wipe-on-navigate bug
`src/App.jsx` `navigate()` (~lines 1198–1212):
```js
const isGatherMinigame = activeTask?.type === 'gather' && activeTask?.gatherTask?.oneShot
const shouldPreserve = activeTask?.type === 'quest' || activeTask?.type === 'minigame' || isGatherMinigame
if (!shouldPreserve) setActiveTask(null)   // <-- wipes gather/clue/combat/skill/agility/thieving/hunter
```
So clues and gathering (both `type:'gather'`, non-oneShot) and the active-loop skills are wiped on in-app navigation, while a tab-close `beacon` keeps them. **This is the inconsistency to fix.**

### 3.3 Offline simulation (client-side today)
- `src/engine/idleEngine.js` (~1400 lines): pure functions `simulateIdleSkilling`, `simulateIdleGather` (handles `isClue` and `oneShot`), `simulateIdleCombat`, `simulateIdleHPRegen`; re-exports `simulateIdleAgility`. Also `simulateIdleThieving` (`thieving.js`), `simulateIdleHunting` (`hunter.js`).
- `src/engine/questIdleCascade.js`: `simulateQuestIdleCascade` advances the active quest + queued quests over elapsed time using `ticksRemaining`.
- Boot + tab-return apply these in `gameState.jsx` (loadGame, ~lines 136–429) and `App.jsx` (visibility handler, ~lines 510–866). Elapsed time is computed from the **server-stamped** `lastActiveAt` (preferred) via `computeIdleElapsedMs` (`src/utils/idleElapsed.js`), capped at 24h, with a `pocketrpg_maxObservedAt` clock-rollback watermark.

### 3.4 Server (Cloudflare Pages Functions + D1)
- `functions/api/idle.js`: GET/PUT/POST(beacon)/DELETE on `character_idle_state` (migration `0004_idle_state.sql`: `character_id`, `last_active_at`, `active_task`, `updated_at`). **Server stamps `last_active_at` with its own clock** on every write.
- `functions/_lib/game/idleClaim.js`: `validateIdleClaimWindow` (clock authority: rejects rollback, caps at 24h, adds 1h for skip) + a thin `applyIdleClaimRewards` (coins/items-per-hour only — **not** the full sim).
- `functions/api/skip-hour.js`: debits 1 credit only; rewards are computed **client-side** in `App.jsx handleSkip1h`.
- **Nonce + reward validation infra already exists** and is the backbone for "validate + cap":
  - `functions/_lib/game/nonces.js`: `claimActionNonce(env, characterId, nonce)` — atomic single-use claim against `action_nonces` (migration `0017`).
  - `functions/_lib/game/actionCompletion.js`: `settleActionCompletion(...)` — grants rewards only if `isValidRewardSourceItem(sourceType, sourceId, itemId)` passes (clue/minigame/dungeoneering/raid/monster reward tables).
  - `functions/api/actions/{clue,minigame,dungeoneering,raid,monster}/complete` already exist; client wrappers in `src/cloud/api.js` (`completeClue`, `completeMinigame`, `completeDungeoneering`, …).
  - Audit events table: migration `0016_audit_events.sql` (per CLAUDE.md §14).

### 3.5 Per-skill duplication (unification target)
`processSkillingTick` (`skilling.js`), `processAgilityTick` (`agility.js`), `processThievingTick` (`thieving.js`), `processHunterTick` (`hunter.js`) are near-identical (`ticksRemaining--`, `justCompleted`, totals, emit `actionComplete`). Their screens repeat the same `onTick` subscribe/cleanup boilerplate. Combat and Farming are genuinely different and are **out of scope** for unification.

---

## 4. Target design

### 4.1 Activity taxonomy (single source of truth)
Introduce an explicit policy per activity, not per screen. Create `src/engine/activityRegistry.js` exporting a lookup keyed by task `type` (and skill for `skill` tasks):

```js
// persistence: 'background' = save & resume; 'modal' = stop when you leave
export const ACTIVITY_POLICY = {
  quest:       { persistence: 'background' },
  minigame:    { persistence: 'background' },
  clue:        { persistence: 'background' }, // see §4.6: split clues out of 'gather'
  gather:      { persistence: 'background' }, // WC / mining / fishing
  agility:     { persistence: 'background' },
  thieving:    { persistence: 'background' },
  hunter:      { persistence: 'background' },
  dungeoneering:{ persistence: 'background' },
  // farming has no activeTask — passive wall-clock, inherently persistent
  combat:      { persistence: 'modal' },
  skill:       { persistence: 'modal' },   // cooking/smithing/crafting/... + construction
}
export function getActivityPolicy(task) { /* resolve by task.type */ }
export function isBackground(task) { return getActivityPolicy(task)?.persistence === 'background' }
```

> **Note on dungeoneering:** today its long "reward" actions run as `type:'skill'` (see `idleEngine.js` `category === 'reward'` branch). To make it background-persistent, it needs its own `type:'dungeoneering'` (or a `persistence` flag on the task) so the registry can classify it as background while normal `skill` stays modal. Pick one approach and apply consistently.

### 4.2 The per-activity progress ledger (the core new concept)
Every background activity is identified by a **stable `activityKey`** and has its progress stored server-side, independent of the single live active-task slot.

**`activityKey` derivation** (must be deterministic & stable):
| Type | activityKey example |
|------|--------------------|
| quest | `quest:a_realm_divided` |
| minigame | `minigame:ba_fighter_torso` |
| clue | `clue:medium` |
| gather | `gather:woodcutting:oak` (skill + action id) |
| agility | `agility:<courseId>` |
| thieving | `thieving:<npcId>` |
| hunter | `hunter:<actionId>` |
| dungeoneering | `dungeoneering:<actionId>` |

**Ledger entry shape:**
```ts
{
  progressTicks: number,   // ticks accrued toward this activity
  totalTicks?: number,     // for fixed-duration activities (quests, minigame oneShot, dungeon reward)
  state?: object,          // activity-specific (e.g. clueLevel, selectedAlchemyItem)
  updatedAt: number,       // server-stamped
}
```
- **Fixed-duration** activities (quest, minigame oneShot, dungeoneering reward): completion when `progressTicks >= totalTicks`. Resuming seeds `ticksRemaining = totalTicks - progressTicks`. This is the "resume at 1 hour" behaviour.
- **Continuous-loop** activities (gather, agility, thieving, hunter, clue chains): `progressTicks` carries the fractional progress toward the next action/clue; resets each completion. Saving it makes "switch and come back" lossless and uniform, even though the carried remainder is small.

### 4.3 Lifecycle (background activity)
1. **Start activity A** → look up `ledger[A.activityKey]` (from the boot fetch; see §6) and seed `progressTicks`/`ticksRemaining`. Build `activeTask` including `activityKey`. `setActiveTask(A)` → server stamps `last_active_at`, stores `active_task`.
2. **Live ticks** (app/modal open) → accrue `progressTicks`; mirror into ledger on the existing 30s heartbeat.
3. **Leave app** (tab hidden/closed) with A active → on return, compute elapsed from server clock (cap 24h), run the existing `simulateIdle*` for A, advance `progressTicks`, apply rewards **through the server validate+cap path** (§6), update `ledger[A]`.
4. **Switch to activity B** (`setActiveTask(B)` where `B.activityKey !== A.activityKey`) → **flush A's current `progressTicks` into `ledger[A]` server-side first**, then seed and start B. **No wipe.**
5. **Navigate to a neutral screen** (Bank, Stats, …) with A active and *no* new activity started → A **remains** the active task and keeps accruing offline. (This is the behaviour change vs. today's wipe.)
6. **Completion** (fixed-duration) → claim via the relevant `/api/actions/*/complete` (nonce + reward-source validation), then clear `ledger[A]`.

### 4.4 Lifecycle (modal-bound activity: combat, skill)
- Progresses only while the modal/screen is mounted **or** while the app is backgrounded **with that modal still open** (offline-sim on return — unchanged).
- **Navigating away / closing the modal STOPS it** (keep today's `setActiveTask(null)` for these types) — combat = "you flee", skilling = "you stop". No ledger entry, no resume.
- Add **explicit UX** (see §8) so the player understands the rule before it bites them.

### 4.5 Server validate + cap (Decision 1)
Reuse the nonce + settle infra:
- The server continues to **own the clock** (`last_active_at` + `serverNow`), already true in `idle.js`.
- For any idle/skip reward batch the client wants to bank, route it through a server endpoint that: (a) `claimActionNonce` to prevent replay, (b) recomputes the **maximum plausible** rewards for the elapsed window per activity (rate caps: max XP/hr, max items/hr, max actions = `floor(elapsedTicks / actionTicks)`), (c) clamps the client-submitted deltas to those caps, (d) validates protected reward items via `isValidRewardSourceItem`, (e) writes to the save and **emits an audit event**.
- Extend `idleClaim.js` with per-activity cap helpers instead of the current coins/items-per-hour-only `applyIdleClaimRewards`.

### 4.6 Split clues out of the `gather` type
Clues currently masquerade as `type:'gather'` with `isClue`. For a clean registry + ledger, promote them to `type:'clue'` (keep the existing `simulateIdleGather` `isClue` math, just dispatch by the new type). Low risk, improves clarity. (Optional but recommended; if skipped, the registry must special-case `gather + isClue → background/clue`.)

### 4.7 Unified activity engine (Decision 4 / "bring skills into unity")
- New `src/engine/activityLoop.js`:
  - `createActivityState(def)` → `{ active, activityKey, skill, action, ticksRemaining, totalActions, totalXP, justCompleted, ... }`.
  - `processActivityTick(state)` → `{ state, events }` (decrement, completion event) — replaces `processSkillingTick`/`processAgilityTick`/`processThievingTick`/`processHunterTick`.
- New hook `src/hooks/useActivityLoop.js`: encapsulates the `onTick` subscribe + cleanup + event dispatch boilerplate repeated across the skill screens.
- Reward application stays pluggable per activity (drops/products/coins/xp), called from the shared completion event.
- **Leave alone:** `combat.js` (multi-timer) and `farming.ts` (wall-clock). They keep bespoke logic.
- The idle simulators (`simulateIdle*`) should expose a single dispatcher `simulateActivity(task, elapsedMs, ctx)` that routes by `type`, so boot/tab-return/skip all call one function.

---

## 5. Data model changes

### 5.1 New migration `migrations/0021_activity_progress.sql`
Two valid options — **prefer Option A** (one row per activity, easy to cap & query):

**Option A — dedicated table:**
```sql
CREATE TABLE IF NOT EXISTS character_activity_progress (
  character_id  INTEGER NOT NULL REFERENCES characters(id),
  activity_key  TEXT    NOT NULL,
  progress_ticks INTEGER NOT NULL DEFAULT 0,
  total_ticks   INTEGER,
  state_json    TEXT,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (character_id, activity_key)
);
```
**Option B — JSON column on the idle row** (`ALTER TABLE character_idle_state ADD COLUMN activity_progress TEXT;`). Simpler, but you must cap key count + byte size in code.

> Whichever you pick, the **server is authoritative** for these values and must bound them (cap number of keys per character, cap `progress_ticks <= total_ticks`, reject impossible values).

### 5.2 `activeTask` shape additions
Add `activityKey` and (for fixed-duration) `totalTicks`/`ticksRemaining` to every background task. Keep within the 16 KB `MAX_TASK_BYTES` limit in `idle.js`.

---

## 6. Server changes (`functions/`)

1. **`functions/api/activity-progress.js`** (new) — GET (return all ledger rows for the character) and PUT (upsert one `{ activityKey, progressTicks, totalTicks, state }`). Reuse `requireAuth`, `assertCharacterOwned`, `assertNotInActiveMatch`, server-stamped `updated_at`, and the same JSON-size guards as `idle.js`.
2. **Boot read** — `GET /api/idle` (or a combined endpoint) should also return the ledger so the client can seed resumes without an extra round-trip.
3. **Validate + cap claim path** — extend `functions/_lib/game/idleClaim.js`:
   - `computeIdleCaps(activeTask, elapsedMs, ctx)` → max actions/XP/items for the window.
   - On the reward-banking endpoint(s), `claimActionNonce` first, clamp client deltas to caps, validate protected items via `isValidRewardSourceItem`, then `settleActionCompletion`-style write + **audit event**.
4. **Skip-hour** — keep the credit debit in `skip-hour.js`, but run the resulting reward batch through the same validate+cap+nonce path instead of trusting the client.
5. **One-Life / PvP** — preserve existing behaviour: `DELETE /api/idle` on One-Life death must also clear `character_activity_progress`; the PvP `assertNotInActiveMatch` lock must guard the new endpoints too.

---

## 7. Client changes (`src/`)

1. **`src/engine/activityRegistry.js`** (new, §4.1) — taxonomy + `activityKey` derivation + `isBackground`.
2. **`src/state/gameState.jsx`**
   - Hold the ledger in state, hydrate it on `loadGame` from the boot fetch.
   - `setActiveTask`: when replacing a **background** task with a different `activityKey`, **flush the outgoing task's progress to the ledger** (local + `PUT /api/activity-progress`) before swapping. When the incoming task is background, **seed it from the ledger**.
   - Add `getActivityProgress(activityKey)` / `saveActivityProgress(...)` helpers.
3. **`src/App.jsx`**
   - Fix `navigate()` (§3.2): replace the `quest|minigame|oneShot` allow-list with `isBackground(activeTask)`. Background → preserve (and flush ledger); modal → stop (today's behaviour) + fire the "stopped" toast/messaging.
   - Make the offline-resume + skip handlers dispatch through the single `simulateActivity` and the server validate+cap claim path.
   - On return from hidden, after simulating, update the ledger for the active background task.
4. **Screens** — each background screen (`GatherScreen`, `CluesScreen`, `AgilityScreen`, `ThievingScreen`, `HunterScreen`, dungeoneering path, `QuestsScreen`, `MinigamesScreen`) must, **on mount/start, read prior progress** for the selected activity and resume from it (Decision 2: "read how much progress someone has made before they start"). Show a "Resuming — 1h 12m done" indicator.
5. **`src/hooks/useActivityLoop.js`** + refactor the background skill screens onto it (§4.7).

---

## 8. UX / messaging spec

**Background activities** (quests/minigames/gathering/clues/agility/thieving/hunter/dungeoneering):
- On the activity card show: "Runs in the background — progress is saved if you leave or switch."
- When resuming a partially-done activity, show prior progress (e.g. a progress bar pre-filled to 1h12m / 5h).

**Foreground activities** (combat, skilling):
- Persistent banner in the modal: **"Combat only continues while this screen is open — leave and you'll flee."** / **"Skilling stops when you leave this screen. Keep it open to keep going."**
- When the player navigates away from an active combat/skill, fire a clear toast: "You fled combat." / "You stopped skilling." (No silent wipe.)
- Optional: a confirm dialog on navigate-away if a modal-bound action is active (gauge with playtesting; may be annoying — banner + toast may suffice).

> The messaging is the actual fix for the player complaint: background = honestly persists; foreground = honestly stops, and says so.

---

## 9. Rollout, migration & backwards-compat

- **Schema migration** `0021` is additive; no destructive change to `saves`/`character_idle_state`.
- **Legacy active tasks** without `activityKey`: derive one on read (registry can compute from `type`+`skill`+`action.id`); if it cannot, treat the task as having zero stored progress (no regression vs. today).
- **localStorage mirrors** stay as the offline fallback (`pocketrpg_activeTask`, `pocketrpg_lastTick`, plus a new `pocketrpg_activityProgress` mirror). Cloud is authoritative when signed in.
- **Single-file build:** any new top-level symbol must be globally unique and registered where required (`build_single.cjs`); run `npm run check:single` (CLAUDE.md §11–§12).
- Ship behind a small feature flag if you want a staged rollout (optional).

---

## 10. Testing plan (logic-only, deterministic — `tests/**/*.test.ts`)

1. **Registry** — every `type` maps to the correct `persistence`; `activityKey` is stable for the same activity and distinct across activities.
2. **Ledger flush/seed** — switching A→B flushes A's `progressTicks`; restarting A seeds `ticksRemaining = totalTicks - progressTicks`; fixed-duration completion clears the ledger.
3. **Navigate semantics** — background task survives navigation to a neutral screen; modal task is stopped (extend/adjust any existing `navigate` tests).
4. **Offline accrual still works** — active background task advances over elapsed window and is capped at 24h (reuse `tests/idle-skilling.test.ts`, `tests/idleElapsed.test.ts`, `tests/questIdleCascade.test.ts`).
5. **Server validate + cap** — claims above the per-window cap are clamped; replayed nonce → `STALE_REPLAYED_ACTION`; invalid reward source → `INVALID_REWARD_SOURCE`; audit event emitted (mirror `tests/actionCompletionAuthority.test.ts`, `tests/clueRewardsServer.test.ts`).
6. **Unified engine parity** — `processActivityTick` reproduces the old `process*Tick` outputs for skilling/agility/thieving/hunter (snapshot the pre-refactor behaviour first).
7. **One-Life / PvP** — One-Life death clears the ledger; activity-progress writes are blocked during an active PvP match.

**Commit gate (CLAUDE.md §11):** `npm test && npm run build && npm run rebuild && npm run check:single` (or `npm run ci && npm test`). Do not commit on red.

---

## 11. Suggested work breakdown (order for the implementing agent)

1. **Registry + taxonomy** (`activityRegistry.js`) + unit tests. No behaviour change yet.
2. **Fix `navigate()`** to use `isBackground` (stops the wipe for gathering/clues/agility/thieving/hunter) + add foreground stop messaging. Ship this first — it directly resolves the complaint with the least risk.
3. **Migration `0021` + `/api/activity-progress`** endpoint + client helpers + boot hydration.
4. **Ledger flush/seed in `setActiveTask`** + per-screen "resume from saved progress" on start. This delivers Decision 2.
5. **Clue type split** (`gather`→`clue`) (optional but recommended).
6. **Server validate + cap + nonce path** for idle/skip reward banking + audit events (Decision 1).
7. **Unify skills engine** (`activityLoop.js` + `useActivityLoop`) and refactor the background skill screens; parity tests.
8. **Full UX pass** (banners, resume indicators, toasts).

Steps 1–4 deliver the player-visible fix; 5–8 harden and clean up.

---

## 12. Open questions / risks to confirm during implementation

- **Processing-skill idle today:** `simulateIdleSkilling` currently *does* simulate offline skilling. Under Decision 4, processing skills are modal-bound — confirm whether backgrounding the tab **with the skilling modal open** should still grant offline skilling (recommended: yes, consistent with combat), while in-app navigation stops it.
- **Dungeoneering reward actions** are entangled with `type:'skill'` (`idleEngine.js` `category==='reward'`). Decide the cleanest way to give it `persistence:'background'` without disturbing normal skilling.
- **Cap calibration:** the server caps must match the client engine's deterministic output for honest clients (avoid false "you cheated" clamps). Derive caps from the same action-tick math the client uses.
- **Single active-task slot vs. multiple background activities:** confirmed single slot + ledger (per Decision 2). If product later wants several activities accruing at once, the ledger already supports it but the offline-accrual loop would need to fan out.
