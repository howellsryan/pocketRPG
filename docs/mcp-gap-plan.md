# PocketRPG MCP — Gap Closure Plan (MCP vs. Browser)

> **Goal:** make the MCP server able to do everything a player can do in the
> browser, and make the tools that already exist behave the same way the
> browser does. **PvP is explicitly out of scope** (see §3).
>
> This document has five parts:
> 1. How the MCP is wired (the recipe every change follows).
> 2. The full gap audit (browser capability → MCP status).
> 3. What is intentionally out of scope.
> 4. The prioritized work orders (WO‑1 … WO‑14) — the actual implementation guide.
> 5. The handoff prompt to give the implementing agent.
>
> Read parts 1–3 once, then execute part 4 **in order, one work order per
> commit**. Part 5 is the prompt you paste to the agent who will do the work.

---

## 1) How the MCP is wired (read this first)

The MCP server is a thin, **stateless** JSON‑RPC layer. It never re‑implements
game logic; it calls the same code the browser/API uses. There are exactly
three files you touch for almost every change:

| File | Role |
| --- | --- |
| `functions/_lib/mcp/schema.js` | Tool **metadata**: name, description, JSON‑Schema input, READ/WRITE annotation. Also holds `SERVER_INSTRUCTIONS` (the text shown to the AI client on connect). |
| `functions/_lib/mcp/tools.js` | Tool **dispatch**: the `TOOLS` object maps each name to a handler. Read‑only tools call `callHandler(...)` against a real `/api/*` endpoint; write tools either bridge to an endpoint or use the save‑intent pattern. |
| `functions/_lib/mcp/intents.js` | Pure **save‑intent** functions: deterministic mutations of a decoded `saveObject` that throw `GameApiError` on bad input. Used for actions that only move/award the character's own save data. |

Supporting files you will sometimes touch:
- `functions/_lib/mcp/reference.js` — static reference datasets + the `get_reference` topic map and `pocketrpg://reference/*` resources.
- `functions/_lib/mcp/idle.js` — read/write the `character_idle_state` row (`getIdleRow`, `setIdleTask`, `clearIdleTask`, `resetIdleActiveAt`, `advanceIdleClock`).
- `functions/_lib/mcp/bridge.js` — `callHandler(handler, env, { method, authorization, characterId, body, query })` invokes a Pages Function exactly like production (auth/locks/audit all run).
- `tests/mcpIntents.test.ts`, `tests/mcpServer.test.ts`, `tests/skilling-tools.test.ts`, `tests/mcpBossFight.test.ts` — the existing test patterns to copy.

### The three change recipes

**Recipe A — a read tool that wraps an existing `/api` GET**
1. `tools.js`: `import { onRequestGet as getX } from '../../api/x.js'`.
2. `tools.js`: add `async x({ character_id }, { env, authorization }) { const id = await resolveCharacterId(env, authorization, character_id); const res = await callHandler(getX, env, { authorization, characterId: id }); if (!res.ok) throw httpError(res); return ok({ characterId: id, ...res.data }) }`.
3. `schema.js`: add a `TOOL_SCHEMAS` entry with `annotations: READ('…')`.

**Recipe B — a write tool that is a server‑authoritative grant (wrap an existing `/api` POST)**
1. `tools.js`: `import { onRequestPost as postX } from '../../api/x.js'`.
2. `tools.js`: resolve the character, then `callHandler(postX, env, { method: 'POST', authorization, characterId: id, body: {…} })`. Return `ok({...})`.
3. `schema.js`: add the schema with `annotations: WRITE('…')`.
4. Use this when the browser path is a `/api/*` endpoint that debits/grants
   server‑side (purchases, credit spends, action completions).

**Recipe C — a write tool that only moves/awards the character's own save (save‑intent)**
1. `intents.js`: write a pure `fooIntent(save, args)` that mutates `save` in place and returns a small summary; throw `new GameApiError(code, message, 400)` on any invalid input. **Mirror the client's load‑time application in `src/state/gameState.jsx` field‑for‑field** so the two paths can't drift.
2. `tools.js`: `foo(args, ctx) { return applySaveIntent(ctx, character_id, (save) => fooIntent(save, …), 'mcp_foo') }`. `applySaveIntent` resolves+owns the character, refuses during PvP, loads → mutates → saves → audits.
3. `schema.js`: add the schema with `annotations: WRITE('…')`.

**Recipe D — a new idle activity (start + claim over real time)**
This is the pattern used by skilling/combat/quests. An idle activity occupies
the single `character_idle_state` slot and accrues over wall‑clock time.
1. `intents.js`: add `buildXTask(save, …)` (validates and returns the task object) and `runXTask(save, task, elapsedMs)` (runs the **existing pure simulator** and applies the result, mirroring `gameState.jsx`).
2. `intents.js`: add the task `type` to `SUPPORTED_IDLE_TYPES` and teach `isClaimableTask` about it.
3. `tools.js`: in `claimIdleCore`, add a branch (or extend `runIdleTask`) for the new `task.type`.
4. `tools.js`: add a `start_X` tool that calls `assertNotInActiveMatch`, `assertNoActiveQuest`, auto‑claims the prior task via `claimIdleCore`, builds the task, and `setIdleTask`.
5. `tools.js`: extend `get_active_activity`'s rendering for the new type.
6. `schema.js`: add the `start_X` schema (and any new reference).

### The commit gate (run before **every** commit)
```
npm test && npm run build && npm run rebuild && npm run check:single
```
or `npm run ci && npm test`. **Never commit with a failing gate.** Generated
`index.html` is a build artifact — do not hand‑edit it. MCP changes are pure
`functions/_lib/**` logic, so they don't need `GAME_CHUNK_FILES` edits, but
`check:single` must still pass.

---

## 2) Gap audit — browser vs. MCP

Legend: ✅ reachable in MCP · ⚠️ partial / parity gap · ❌ not reachable.

### 2.1 Skilling
| Browser capability | MCP status | Notes |
| --- | --- | --- |
| Mining / Woodcutting / Fishing (idle) | ✅ | `start_skilling` (`type:'skill'`). |
| Smithing / Cooking / Crafting / Fletching / Herblore / Runecraft / Firemaking | ✅ | `start_skilling` production skills. |
| Dungeoneering train + spend tokens | ✅ | `start_skilling` + `claim_dungeoneering_reward`. |
| Agility / Thieving / Hunter | ✅ | `start_skilling`. |
| **Gather tasks** (bowstring, sand, seaweed, etc. — `GatherScreen`) | ❌ | `type:'gather'` not buildable or claimable. **WO‑1**. |
| **Prayer** (bury / altar bones, scatter dust) | ❌ | No tool. **WO‑5**. |
| **Magic** (alchemy, superheat, enchant, plank‑make, tan) | ❌ | No tool. **WO‑8**. |
| **Construction** (build planks, unlock perks) | ❌ | No tool. **WO‑6**. |
| **Farming** (plant / harvest patches) | ❌ | No tool. **WO‑7**. |

### 2.2 Combat
| Browser capability | MCP status | Notes |
| --- | --- | --- |
| Idle fight a normal monster | ✅ | `start_fight` + `claim_activity`. |
| Idle fight **credits the active Slayer task** | ⚠️ | `start_fight` passes `slayerTask=null`; kills don't progress the slayer task or grant points. **WO‑2**. |
| Boss kill (credit skip) / real boss sim | ✅ | `kill_boss`, `fight_boss`. |
| Raid clear (credit skip) | ✅ | `kill_raid`. |
| Magic combat setup vs. boss | ⚠️ | `fight_boss` throws for magic setups. **WO‑9** (optional). |
| Special attacks (manual) | ❌ (by design) | Offline/auto specials are intentionally disabled — see §3. |
| One‑Life combat | ❌ (by design) | Permanent death is deferred to the client — see §3. |

### 2.3 Timed reward activities
| Browser capability | MCP status | Notes |
| --- | --- | --- |
| **Clue scrolls** (start → solve → claim) | ❌ | `type:'clue'`; `/api/actions/clue/complete` exists. **WO‑3**. |
| **Minigames** (start → grind → claim) | ❌ | `type:'minigame'`; `/api/actions/minigame/complete` exists. **WO‑4**. |

### 2.4 Quests / Slayer
| Browser capability | MCP status | Notes |
| --- | --- | --- |
| Quests: view / start / queue / remove | ✅ | `get_quests`, `start_quest`, `queue_quest`, `remove_from_queue`. |
| Slayer: status / get task / skip task | ✅ | `get_slayer_task`, `assign_slayer_task`, `skip_slayer_task`. |
| Complete a slayer task (kill its monster) | ⚠️ | Blocked by the combat‑credit gap. **WO‑2**. |
| **Buy Slayer unlocks/perks** (spend slayer points) | ❌ | Save‑authoritative; no tool. **WO‑11**. |

### 2.5 Inventory / bank / economy
| Browser capability | MCP status | Notes |
| --- | --- | --- |
| Deposit / withdraw / equip / unequip | ✅ | `deposit_to_bank`, `withdraw_from_bank`, `equip_item`, `unequip_item`. |
| Buy from shop / sell at shop value | ✅ | `buy_item`, `sell_item`. |
| Trading post: search / list / place / cancel / collect / instant‑sell | ✅ | full set. |
| Place offer / sell **from bank** (`source:'bank'`) | ⚠️ | MCP omits `source`; only inventory is reachable. **WO‑10**. |
| Item charging (venomcoil scales) | ❌ (minor) | Niche; **not scheduled** (note only). |
| Bank tabs / placeholders / reordering | ❌ (cosmetic) | UI‑only; out of scope. |

### 2.6 Account / meta
| Browser capability | MCP status | Notes |
| --- | --- | --- |
| List characters / account / state / collection log / kill counts / leaderboard | ✅ | full read set. |
| **Create a character** | ❌ | `/api/characters` POST exists. **WO‑12**. |
| **Buy permanent credit unlocks** (e.g. `double_slayer_xp`) | ❌ | `/api/unlocks/purchase` exists. **WO‑11**. |
| Skip‑hour / claim idle | ✅ | `skip_hour`, `claim_activity`. |
| Manual save / logout / delete account | n/a | Save is implicit; `logout` explains client disconnect; account deletion is intentionally **not** exposed. |

### 2.7 Reference / docs hygiene
| Item | Status | Notes |
| --- | --- | --- |
| `get_reference` topics | ⚠️ | Missing **construction** and **gather‑task** data. **WO‑13**. |
| `claim_activity` reports for client‑only types | ⚠️ | Should name each unreachable activity precisely. Folded into WO‑1/3/4/14. |
| `docs/mcp-roadmap.md` referenced by `CLAUDE.md §15` | ❌ | File does not exist. **WO‑14**. |

---

## 3) Intentionally out of scope (do **not** build)

- **All PvP** (`/api/pvp/**`, matches, invitations, lobby). Excluded by request.
- **Offline / automatic special attacks.** `CLAUDE.md §7`: specials are manual‑only, never auto/offline. The idle combat sim deliberately fires no specials. Leave as‑is.
- **One‑Life combat via MCP.** Permanent death must be handled in the client; `start_fight`/`fight_boss` correctly refuse One‑Life characters. Keep refusing.
- **Account deletion**, Stripe/credit *purchasing* (real money), OAuth/login flows, raw save writes. Keep these off MCP.
- **Cosmetic UI** (bank tabs, home shortcuts, drag‑reorder, placeholders).
- **Item charging** (venomcoil scales) — note only; not scheduled.

If you think something here actually needs doing, **stop and ask** — do not build it on your own initiative.

---

## 4) Work orders (the implementation guide)

Execute in order. **One work order = one commit** (run the commit gate first).
Each work order is self‑contained. Phases group related risk.

> Conventions used below:
> - "intent" = a pure function in `intents.js` used via `applySaveIntent`.
> - "bridge" = wrap a real `/api/*` handler with `callHandler`.
> - Every new tool needs: a `schema.js` entry, a `tools.js` handler, a test, and
>   (if it changes behaviour the AI should know) a `SERVER_INSTRUCTIONS` line.

### Phase 1 — Parity fixes on existing tools (do first; low risk, high value)

#### WO‑1 — `claim_activity` + `start_gather`: support gather tasks
**Why:** the browser's `GatherScreen` tasks (`type:'gather'`: bowstring, bucket of sand, seaweed, ashes, berries, etc.) cannot be started or claimed via MCP. The pure simulator `simulateIdleGather` already exists.

**Files:** `intents.js`, `tools.js`, `schema.js`, `tests/skilling-tools.test.ts`.

**Steps:**
1. Find the canonical gather‑task list used by `src/screens/GatherScreen.jsx` (trace its `setActiveTask({ type:'gather', gatherTask })` call back to the task data; it lives in the screen/engine). If the list is screen‑local, extract it into a shared module under `src/engine/` or `src/data/` so both the screen and `intents.js` import the same source (do **not** duplicate it).
2. `intents.js`:
   - Add `'gather'` to `SUPPORTED_IDLE_TYPES`.
   - In `isClaimableTask`, return `true` for `type:'gather'` (skip `oneShot`/`isClue` gather tasks — those are not idleable; see `activityRunner.js` `isBackground`).
   - Add `buildGatherTask(save, taskId)` that looks up the gather task, checks any level requirement, and returns `{ type:'gather', gatherTask }`.
   - In `runIdleTask`'s switch, add `case 'gather': sim = simulateIdleGather(task, elapsedMs, toSlotArray(save), save.stats||{}, itemsData, save.bank||{}); break;`. `applyIdleResult` already has a `type==='gather'` branch — verify its banked/inventory handling matches `gameState.jsx`.
3. `tools.js`:
   - Import `simulateIdleGather` is done inside `intents.js`; expose `buildGatherTask` from `intents.js` and import it in `tools.js`.
   - Add a `start_gather({ task_id, character_id }, ctx)` tool mirroring `start_skilling` (PvP lock, `assertNoActiveQuest`, auto‑claim prior, `setIdleTask`).
   - Extend `get_active_activity`'s renderer to describe `type:'gather'`.
4. `schema.js`: add `start_gather` (`WRITE`) with `task_id` (string, required). Add a `SERVER_INSTRUCTIONS` sentence that gather tasks are now trainable.
5. **Tests:** start a gather task, advance the idle clock, `claim_activity`, assert items banked + XP applied. Assert `oneShot` gather tasks are refused.

**Acceptance:** a gather task can be started, runs over time, and `claim_activity` banks its output; `get_active_activity` shows it. Gate green.
**Commit:** `mcp: support gather-task idle activities (start_gather + claim)`.

#### WO‑2 — `start_fight` credits the active Slayer task
**Why:** the browser progresses the player's slayer task when they kill its monster (and grants slayer points/XP on completion). `start_fight` passes `slayerTask=null`, so the slayer loop is broken via MCP.

**Files:** `intents.js` (`buildCombatTask`, `runCombatTask`, `applyIdleCombatResult`), `tools.js` (`start_fight`, `claimIdleCore`), `tests/mcpIntents.test.ts`.

**Steps:**
1. In `buildCombatTask`, read `save.settings.slayerTask`. If it is active **and its `monsterId` matches the monster being fought**, attach it to the task (e.g. `task.slayerTask = save.settings.slayerTask`). Otherwise leave null. Mirror the client's rule for what counts toward a task.
2. In `runCombatTask`, pass the task's slayer task into `simulateIdleCombat(task, elapsedMs, …, slayerTask, …)` (the param already exists). Read the returned slayer progress (kills credited / task completed) — inspect `simulateIdleCombat`'s return shape in `src/engine/idleEngine.js`.
3. In `applyIdleCombatResult`, write the decremented `monstersRemaining` back to `save.settings.slayerTask`, exactly as `gameState.jsx` does on load. **Do not** grant slayer points in the save here.
4. Slayer **points + slayer XP** are server‑authoritative on completion. When the sim reports the task finished, after the save write, have `claimIdleCore`/`start_fight`'s claim path call the slayer completion endpoint (bridge `onRequestPost` from `functions/api/actions/slayer/complete.js`) with the right `sourceId`, `actionNonce`, and `slayerPoints`, exactly as the client does. Trace the client's slayer‑completion call to copy its payload precisely.
5. Surface credited kills / completion in the `claim_activity` result.

**Acceptance:** assign a task, `start_fight` its monster, claim → `monstersRemaining` drops; finishing the task increments `slayerTasksCompleted` and grants points via the completion endpoint. Non‑task monsters never touch the slayer task. Gate green.
**Commit:** `mcp: credit active slayer task during idle combat`.

#### WO‑10 — `place_offer` / `sell_item` accept `source: inventory|bank`
**Why:** the browser lets you list/sell from the bank; `list.js` and `sell-immediate.js` accept `source`. MCP hardcodes inventory.

**Files:** `tools.js` (`place_offer`, `sell_item`), `schema.js`, `tests/mcpServer.test.ts`.

**Steps:**
1. `schema.js`: add `source: { type:'string', enum:['inventory','bank'] }` (optional, default `inventory`) to both `place_offer` and `sell_item`.
2. `tools.js`: pass `source` through in the `body` to `postPlaceOffer` / `postSellImmediate`.
3. **Tests:** place a sell offer with `source:'bank'`; assert it escrows from the bank.

**Acceptance:** selling/listing from bank works via MCP. Gate green.
**Commit:** `mcp: allow trading-post offers and instant-sell to source from bank`.

### Phase 2 — New timed activities (clues, minigames)

#### WO‑3 — Clue scrolls: `start_clue` + claim
**Why:** clues are a background timed activity with a server completion endpoint; not reachable today.

**Files:** `intents.js`, `tools.js`, `schema.js`, tests.

**Steps:**
1. Inspect `src/screens/CluesScreen.jsx` and `src/engine/clueScrolls.js` for the clue‑task shape (`type:'clue'`, clue level, ticks) and how the client gates starting (must hold the clue scroll item).
2. `intents.js`: `buildClueTask(save, clueLevel)` — verify the character holds the scroll, build the `type:'clue'` task. Add `'clue'` to `SUPPORTED_IDLE_TYPES` and `isClaimableTask`.
3. Claiming a clue grants **server‑rolled** rewards, so it is **not** a pure save mutation. In `claimIdleCore`, when a `type:'clue'` task has elapsed enough ticks to finish, call the completion endpoint (bridge `onRequestPost` from `functions/api/actions/clue/complete.js`) with `sourceId = clueLevel` and a unique `actionNonce`, then clear the idle slot. Copy the client's payload (consumptions of the scroll, etc.).
4. `tools.js`: `start_clue({ clue_level, character_id })` mirroring `start_skilling`. Extend `get_active_activity`.
5. `schema.js`: add `start_clue` (`WRITE`). Add a `SERVER_INSTRUCTIONS` line.
6. **Tests:** start a clue with the scroll in inventory; advance past its ticks; claim → completion endpoint called, rewards granted, slot cleared. Refuse if no scroll held.

**Acceptance:** clues start, run, and complete with server‑rolled loot + collection‑log entries. Gate green.
**Commit:** `mcp: support clue-scroll activities (start_clue + server claim)`.

#### WO‑4 — Minigames: `start_minigame` + claim
**Why:** minigames are background timed grinds with a server completion endpoint; not reachable today.

**Files:** `intents.js`, `tools.js`, `schema.js`, tests; data in `src/data/minigames.json`.

**Steps:**
1. Inspect `src/screens/MinigamesScreen.jsx` and `src/data/minigames.json` for the `type:'minigame'` task shape (`minigameTask.id`, ticks/duration) and unlock prerequisites (some minigames need a prior reward, e.g. Rune Defender → Dragon Defender).
2. `intents.js`: `buildMinigameTask(save, minigameTaskId)` — validate prerequisites; build `type:'minigame'`. Add `'minigame'` to `SUPPORTED_IDLE_TYPES`/`isClaimableTask`.
3. In `claimIdleCore`, when a finished `type:'minigame'` task has elapsed, bridge `onRequestPost` from `functions/api/actions/minigame/complete.js` with `sourceId = minigameTask.id` and a unique nonce; clear the slot. The completion endpoint maps collection‑log entries to the parent minigame section.
4. `tools.js`: `start_minigame({ minigame_task_id, character_id })`. Extend `get_active_activity`.
5. `schema.js`: add `start_minigame` (`WRITE`) + a `SERVER_INSTRUCTIONS` line.
6. **Tests:** start a minigame, advance, claim → reward granted; assert prerequisite gating.

**Acceptance:** minigames start, run, and award their unlock item + collection‑log slot. Gate green.
**Commit:** `mcp: support minigame activities (start_minigame + server claim)`.

### Phase 3 — New skilling reach (prayer, construction, farming)

#### WO‑5 — Prayer: `train_prayer` (bury / altar bones)
**Why:** prayer is trained by burying bones or using them on an altar — instant per‑bone XP, consuming bones. Not reachable.

**Files:** `intents.js`, `tools.js`, `schema.js`, tests. Data: `skills.json.prayer.actions` (`bury_*`, `altar_*`, `scatter_*`).

**Steps:**
1. Find where the client applies prayer XP (trace `grantXP` for prayer from `SkillingScreen.jsx`/`gameState.jsx`) to learn the exact rule: which bone each action consumes, XP per action, level gate, and whether it pulls from inventory then bank.
2. `intents.js`: `trainPrayer(save, actionId, quantity)` — a pure intent that, for `quantity` repetitions: checks level, removes the required bone (inventory‑first then bank), and adds `action.xp` to `save.stats.prayer` (cap at `XP_CAP`, recompute level). Stop early (and report) when bones run out. Return `{ actions, xpGained, itemsConsumed }`.
3. `tools.js`: `train_prayer({ action_id, quantity = all, character_id }, ctx) → applySaveIntent(...)`. Default to consuming all available bones if `quantity` omitted.
4. `schema.js`: add `train_prayer` (`WRITE`) with `action_id` (required) and `quantity` (optional int ≥1). `SERVER_INSTRUCTIONS` line.
5. **Tests:** with N big bones in bank, `train_prayer('altar_big_bones')` → prayer XP = N × action.xp, bones consumed, stops at 0.

**Acceptance:** prayer XP can be trained from owned bones, matching the client formula. Gate green.
**Commit:** `mcp: add train_prayer (bury/altar bones)`.

#### WO‑6 — Construction: `train_construction` (build planks)
**Why:** construction is built from planks — instant per‑build XP consuming planks. Action table is in `src/screens/ConstructionScreen.jsx` (`build_plank`, `build_oak_plank`, `build_teak_plank`, `build_mahogany_plank`, each `materials`/`xp`/`level`). The two perk unlocks (`money_purse` L70, `master_rejuvenation` L90) are level‑gated toggles.

**Files:** `intents.js`, `tools.js`, `schema.js`, tests. **First extract** the construction action/perk tables out of the screen into a shared module (e.g. `src/data/construction.json` or `src/engine/construction.js`) and import it from both the screen and `intents.js` — do not duplicate.

**Steps:**
1. Extract the construction action + perk tables to a shared source; update `ConstructionScreen.jsx` to import from it (no behaviour change).
2. `intents.js`: `trainConstruction(save, actionId, quantity)` — level check, consume `materials` (planks) per build inventory‑first then bank, add `xp` to `save.stats.construction`, stop when planks run out.
3. `intents.js`: optionally `unlockConstructionPerk(save, perkId)` — level‑gated, records the unlock in `save.settings` exactly as the client does (trace where `money_purse`/`master_rejuvenation` are stored).
4. `tools.js`: `train_construction` and (optional) `unlock_construction_perk` via `applySaveIntent`.
5. `schema.js`: add the tool(s) + `SERVER_INSTRUCTIONS`. Add construction to `get_reference` here or in WO‑13.
6. **Tests:** build N oak planks → construction XP and planks consumed; perk unlock gated by level.

**Acceptance:** construction trains from owned planks; perks unlock at level. Gate green.
**Commit:** `mcp: add train_construction (+ perk unlocks)`.

#### WO‑7 — Farming: `get_farm`, `plant_seed`, `harvest_patch`/`harvest_all`
**Why:** farming is a patch system (plant a seed → it grows over real time → harvest produce + XP), not a single‑slot idle task. The growth engine is `src/engine/farming.ts`; data is `src/data/farming.json`; UI is `FarmingScreen.jsx` / `FarmPatchView.jsx` / `FarmLocationPicker.jsx`.

**Files:** `intents.js`, `tools.js`, `schema.js`, tests.

**Steps:**
1. Read `src/engine/farming.ts` and `FarmingScreen.jsx` to learn: where patch state lives in the save (location → patch index → `{ seedId, plantedAt, … }`), how `farming.ts` computes growth/ready state from elapsed real time, what produce + XP harvest grants, and any patch capacity rules.
2. `intents.js` (reusing `farming.ts` helpers — **do not** re‑derive growth math):
   - `farmSummary(save)` — read‑only: every location/patch, what's planted, growth stage, ready‑at, harvestable now.
   - `plantSeed(save, location, patchIndex, seedId)` — verify farming level + seed owned + patch empty; consume the seed; write the patch with `plantedAt = now`.
   - `harvestPatch(save, location, patchIndex)` / `harvestAll(save)` — using `farming.ts`, verify the crop is ready, grant produce + farming XP, clear/replant the patch per the client's rule.
3. `tools.js`: `get_farm` (READ), `plant_seed` (WRITE intent), `harvest_patch` + `harvest_all` (WRITE intents).
4. `schema.js`: add all four + `SERVER_INSTRUCTIONS`. Note `pocketrpg://reference/farming` already exists for seed/crop data.
5. **Tests:** plant a seed → patch occupied + seed consumed; advance time past grow time (simulate by back‑dating `plantedAt`); harvest → produce banked + XP granted; harvesting an unripe patch is refused.

**Acceptance:** a full plant→grow→harvest cycle works via MCP and matches `farming.ts`. Gate green.
**Commit:** `mcp: add farming tools (get_farm, plant_seed, harvest)`.

#### WO‑8 — Magic (non‑combat): `cast_magic` (alchemy / enchant / superheat / tan / plank‑make)
**Why:** the magic skill's utility actions (High Alchemy, Superheat, Enchant, Tan Leather, Plank Make) train magic by consuming runes + an input and producing an output. The client runs them via `processSkillingTick` in `MagicScreen.jsx`. **Highest complexity — do last in this phase.**

**Files:** `intents.js`, `tools.js`, `schema.js`, tests. Data: `skills.json.magic.actions`, rune logic in `src/engine/runes.js`.

**Steps:**
1. Study `MagicScreen.jsx` + `src/engine/runes.js` (`hasRequiredRunes`, `getRunesToConsume`, `getEquippedElementalStaff`) and `processSkillingTick` to learn exactly what each magic action consumes (runes, and for alchemy the **target item** the player picks) and produces, plus XP per cast.
2. `intents.js`: `castMagic(save, actionId, { targetItemId, quantity })` — a pure intent that for each cast: verifies magic level, verifies + consumes runes (honoring an equipped elemental staff), consumes the input/target item, produces the output (coins for alch, converted item for superheat/tan/plank, enchanted item for enchant), and adds magic XP. Stop when runes or inputs run out and report. `targetItemId` is required for actions that need a selection (alchemy, enchant, tan, plank‑make, superheat target bar).
3. `tools.js`: `cast_magic` via `applySaveIntent`. Validate that `target_item_id` is present when the action requires one (throw a clear error listing eligible targets, like the quest XP‑choice pattern).
4. `schema.js`: add `cast_magic` (`WRITE`) with `action_id`, optional `target_item_id`, optional `quantity`. `SERVER_INSTRUCTIONS` line. Be explicit that alchemy/enchant need `target_item_id`.
5. **Tests:** High Alchemy an item → magic XP + coins, runes + item consumed; Superheat a bar; missing `target_item_id` is refused with the eligible list.

**Acceptance:** magic utility actions train magic and produce the right output, consuming runes correctly. Gate green.
**Commit:** `mcp: add cast_magic for non-combat magic actions`.

#### WO‑9 (optional) — `fight_boss` supports magic setups
Only if WO‑8 lands cleanly and there's appetite. Extend `simulateBossFight` (`functions/_lib/mcp/bossFight.js`) to handle a magic combat setup instead of throwing. Otherwise leave the explicit "magic setups aren't supported here — use kill_boss/the client" refusal. **Ask before starting** — this touches the combat sim.

### Phase 4 — Account & progression actions

#### WO‑11 — `buy_unlock` (credit unlock) + `buy_slayer_unlock` (slayer‑point perk)
**Why:** two unlock systems are unreachable: permanent credit unlocks (`/api/unlocks/purchase`, e.g. `double_slayer_xp` = 100 credits) and Slayer‑point perks (`src/engine/slayerUnlocks.js`, save‑authoritative).

**Files:** `tools.js`, `schema.js`, `intents.js` (for slayer perks), tests.

**Steps:**
1. **`buy_unlock`** (Recipe B): bridge `onRequestPost` from `functions/api/unlocks/purchase.js`. Tool `buy_unlock({ unlock_id, character_id })`. The endpoint is the server‑authoritative price registry — just forward. Confirm credit spend in the description (it debits credits). Surface `credits_remaining`.
2. **`buy_slayer_unlock`** (Recipe C): read `src/engine/slayerUnlocks.js` + `SlayerScreen.jsx` to learn the perk list, point costs, and where purchased perks are stored in the save. Write `buySlayerUnlock(save, unlockId)` intent: verify enough `slayerPoints`, debit them, record the unlock. Also add a read surface for available perks (extend `get_slayer_task` to include owned + purchasable perks).
3. `schema.js`: add both tools (`WRITE`) + `SERVER_INSTRUCTIONS` (credit unlocks spend credits — confirm first).
4. **Tests:** `buy_slayer_unlock` debits points and records the perk; insufficient points is refused. `buy_unlock` forwards to the endpoint.

**Acceptance:** both unlock systems are reachable; credit/point spends are confirmed and audited. Gate green.
**Commit:** `mcp: add buy_unlock (credits) and buy_slayer_unlock (points)`.

#### WO‑12 — `create_character`
**Why:** the browser can create a character; MCP can only list. `/api/characters` POST exists.

**Files:** `tools.js`, `schema.js`, tests.

**Steps:**
1. Recipe B: bridge `onRequestPost` from `functions/api/characters/index.js`. Tool `create_character({ username, is_ironman = false, is_one_life = false })`.
2. Mirror the endpoint's validation in the description (3–16 chars, alphanumeric/`_`/`-`, uniqueness, reserved names).
3. `schema.js`: add `create_character` (`WRITE`). Note in `SERVER_INSTRUCTIONS` that ironman/one‑life flags are permanent and that One‑Life combat stays in the client.
4. **Tests:** create a character → appears in `list_characters`; invalid username refused.

**Acceptance:** a new character can be created via MCP. Gate green.
**Commit:** `mcp: add create_character`.

### Phase 5 — Reference & docs hygiene

#### WO‑13 — Reference coverage for construction + gather tasks
**Files:** `functions/_lib/mcp/reference.js`, `schema.js` (`get_reference` enum is built from `REFERENCE_TOPIC_NAMES`), tests.

**Steps:**
1. Add `construction` (from the shared construction module created in WO‑6) and a `gather`/gather‑tasks dataset (from WO‑1's shared source) to `reference.js`: a `pocketrpg://reference/{construction,gather}` resource + a `REFERENCE_TOPICS` entry each. The `get_reference` enum updates automatically via `REFERENCE_TOPIC_NAMES`.
2. **Tests:** `get_reference('construction')` and `get_reference('gather')` return data.

**Acceptance:** all trainable systems are documented in `get_reference`. Gate green.
**Commit:** `mcp: add construction and gather reference topics`.

#### WO‑14 — Refresh `SERVER_INSTRUCTIONS`, create `docs/mcp-roadmap.md`, update `CLAUDE.md`
**Files:** `functions/_lib/mcp/schema.js`, `docs/mcp-roadmap.md` (new), `CLAUDE.md`.

**Steps:**
1. Rewrite the "Idle training", "Combat", and closing paragraphs of `SERVER_INSTRUCTIONS` so they reflect the new reach: gather/clue/minigame/prayer/construction/farming/magic are now doable; slayer kills now credit the task; only PvP, offline specials, One‑Life combat, and account/billing remain client/excluded. Remove the now‑false "Combat/farming/prayer/magic idle is still done in the game client" line.
2. Create `docs/mcp-roadmap.md` (referenced by `CLAUDE.md §15` but missing): list the now‑shipped tools, the deliberately‑excluded set (§3 here), and any deferred items (WO‑9, item charging).
3. Update `CLAUDE.md §15` so the "Keep scope to read + already‑server‑authoritative actions" line matches reality (save‑intent skilling actions are also exposed) and the roadmap link resolves.
4. **Tests:** `tests/mcpServer.test.ts` likely snapshots `tools/list` — update expected tool names/count.

**Acceptance:** instructions and docs match the shipped surface; `CLAUDE.md` link resolves. Gate green.
**Commit:** `mcp: refresh server instructions and roadmap docs`.

---

## 5) Summary of new/changed tools

| Tool | Type | WO |
| --- | --- | --- |
| `start_gather` | new (idle) | WO‑1 |
| `claim_activity` (gather/clue/minigame) | changed | WO‑1/3/4 |
| `start_fight` (slayer credit) | changed | WO‑2 |
| `start_clue` | new (idle) | WO‑3 |
| `start_minigame` | new (idle) | WO‑4 |
| `train_prayer` | new (intent) | WO‑5 |
| `train_construction`, `unlock_construction_perk` | new (intent) | WO‑6 |
| `get_farm`, `plant_seed`, `harvest_patch`, `harvest_all` | new | WO‑7 |
| `cast_magic` | new (intent) | WO‑8 |
| `fight_boss` (magic) | changed (optional) | WO‑9 |
| `place_offer`/`sell_item` (`source`) | changed | WO‑10 |
| `buy_unlock`, `buy_slayer_unlock` | new | WO‑11 |
| `create_character` | new (bridge) | WO‑12 |
| `get_reference` (+construction,+gather) | changed | WO‑13 |
| `SERVER_INSTRUCTIONS` + docs | changed | WO‑14 |

---

## 6) Global rules for the implementer

- **Do not duplicate game logic.** Every new tool must reuse an existing `/api/*`
  handler (bridge) or an existing pure engine simulator/helper (intent). If the
  client computes something a way that isn't yet in a shared module, **extract
  it** so the screen and the MCP import one source — never copy‑paste the math.
- **Mirror `src/state/gameState.jsx` load‑time application** for any save mutation,
  so the MCP and client never drift.
- **Respect existing guards:** `assertNotInActiveMatch` (PvP lock) on every write,
  `assertNoActiveQuest` before starting a new idle activity, One‑Life refusal on
  combat, the idle‑food warning on `start_fight`, `XP_CAP` (200,000,000), 28‑slot
  inventory, `Math.floor` rounding.
- **One work order per commit.** Run the commit gate before each commit. Never
  commit a failing gate. Don't hand‑edit generated `index.html`.
- **Audit every mutation** via `auditLog(env, 'mcp_<action>', …, { swallow:true })`,
  matching the existing tools.
- **Stay on branch `claude/mcp-api-gaps-review-ozuimn`.** Push with
  `git push -u origin claude/mcp-api-gaps-review-ozuimn`. Do **not** open a PR
  unless explicitly asked.
- **If a work order is ambiguous or seems to require touching PvP / a design‑excluded
  area, STOP and ask** — do not improvise.
</content>
</invoke>
