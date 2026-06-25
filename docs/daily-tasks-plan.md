# Daily Tasks — Feature Delivery Plan

> Menu-driven daily challenge system. Each UTC day a character is issued **5 tasks** (one per
> difficulty tier), drawn from a large pool. Completing a task grants **+1 credit**, added to the
> account's existing balance. Credits are premium currency, so the grant is **server-authoritative**
> (CLAUDE.md §14) — never moved through `/api/save`.

## 0) Decisions (locked)
- **Reset boundary:** `00:00 UTC`. Day key = `YYYY-MM-DD` (UTC). Single global reset; no per-user TZ state.
- **Selection:** exactly **one task per tier** — Novice, Intermediate, Experienced, Master, Grandmaster.
  Guarantees the difficulty spread and maps 1:1 onto the quest colour tiers.
- **Trust model:** *bounded trust + audit*. The server **owns the grant** (atomic, idempotent, audited)
  and trusts the client's "completed" claim — the same boundary the save blob already uses for skilling
  (§14). Cheap server-side cross-checks are applied where the data already exists (boss/raid via
  `kill_counts`); skilling tasks are trusted.
- **Quantities:** tasks carry a `target` count (default 1). Higher tiers can require more. Progress is
  tracked toward the target; your examples (“kill a lesser fiend”) are just `target: 1`.

- **Reward:** flat **+1 credit** per task regardless of tier (per request). No all-5 bonus in v1.
- **Account requirement:** credits exist only for cloud accounts, so the feature (header button + modal)
  is shown for cloud accounts only — mirrors the existing Credits pill in `Header.jsx`.

## 1) Tier colours (reuse quest scheme)
Currently hard-coded in `src/screens/QuestsScreen.jsx`:
```
Novice #7fbf7f · Intermediate #7bb3f0 · Experienced #d4af37 · Master #e57373 · Grandmaster #b265e0
```
**Action:** extract this map + tier order to a shared util `src/utils/complexityColors.js`
(`COMPLEXITY_COLORS`, `COMPLEXITY_ORDER`) and import it from both `QuestsScreen.jsx` and the new daily
code. Avoids the §12 duplicate-identifier risk and keeps one source of truth. Register the util in
`build_single.cjs` `sourceFiles`.

---

## 2) Architecture overview

```
            ┌────────────────────────── CLIENT ──────────────────────────┐
boot/ready ─┤ App.jsx fetches GET /api/daily-tasks → state {dailyTasks,date}│
            │ Header.jsx  → 📋 button (x/5 badge) → opens DailyTasksModal   │
game events │ gameState.recordGameEvent(evt) ─► dailyTasks tracker          │
 (kills,    │   matchTaskProgress() increments local progress              │
 skilling,  │   on target reached → api.completeDailyTask() ─┐             │
 idle catch)│   response.credits → setCredits() (header live) │             │
            └─────────────────────────────────────────────────┼────────────┘
                                                               ▼
            ┌────────────────────────── SERVER (Pages Functions) ──────────┐
            │ GET  /api/daily-tasks         → ensureDailyTasks() (issuance) │
            │ POST /api/daily-tasks/complete→ atomic credit grant + audit   │
            │ _lib/game/dailyTasks.js       → seeded selection, day key     │
            │ D1 table character_daily_tasks (durable, outside save blob)   │
            └──────────────────────────────────────────────────────────────┘
```

Why a durable D1 table (not a deterministic seed or the save blob): the idempotent **credit-once**
guarantee and per-day progress must survive last-write-wins save merges — same reasoning as
`kill_counts` (0019) and `collection_log` (0011). The issued row *is* the idempotency key.

---

## 3) Data layer

### 3.1 Content pool — `src/data/dailyTasks.json` (immutable content, §8)
Array of task definitions. `trigger.type` is the event category the tracker matches against.

```json
[
  {
    "id": "craft_leather_chaps",
    "tier": "Novice",
    "name": "Craft Leather Chaps",
    "description": "Craft a pair of leather chaps.",
    "icon": "leather_chaps",
    "trigger": { "type": "skill_produce", "skill": "crafting", "itemId": "leather_chaps", "target": 1 }
  },
  {
    "id": "cut_sapphire",
    "tier": "Novice",
    "name": "Cut a Sapphire",
    "description": "Cut an uncut sapphire.",
    "icon": "sapphire",
    "trigger": { "type": "skill_produce", "skill": "crafting", "itemId": "sapphire", "target": 1 }
  },
  {
    "id": "kill_lesser_fiends",
    "tier": "Intermediate",
    "name": "Cull the Lesser Fiends",
    "description": "Defeat 20 lesser fiends.",
    "icon": "lesser_fiend",
    "trigger": { "type": "monster_kill", "monsterId": "lesser_fiend", "target": 20 }
  },
  {
    "id": "slay_king_black_dragon",
    "tier": "Master",
    "name": "Slay the King Black Dragon",
    "description": "Defeat the King Black Dragon.",
    "icon": "king_black_dragon",
    "trigger": { "type": "boss_kill", "monsterId": "king_black_dragon", "target": 1 }
  },
  {
    "id": "complete_a_raid",
    "tier": "Grandmaster",
    "name": "Conquer a Raid",
    "description": "Complete any raid.",
    "icon": "raid",
    "trigger": { "type": "raid_complete", "raidId": "any", "target": 1 }
  }
]
```

**Trigger taxonomy** (extensible; one matcher each in the engine):
| type | fields | source event |
|---|---|---|
| `monster_kill` | `monsterId`, `target` | regular monster death (CombatScreen / idle catch-up) |
| `boss_kill` | `monsterId`, `target` | boss completion (`completeMonster`) |
| `raid_complete` | `raidId` (`"any"` allowed), `target` | raid completion (`completeRaid`) |
| `skill_produce` | `skill`, `itemId`, `target` | crafting/smithing/cooking/fletching/gem-cutting output |
| `skill_gather` | `skill`, `itemId`, `target` | woodcutting/mining/fishing/farming harvest |
| `skill_xp` | `skill`, `target` (xp) | any XP gain in a skill |
| `clue_complete` | `tier?`, `target` | clue completion |
| `minigame_complete` | `minigameId`, `target` | minigame completion |
| `quest_complete` | `target` | quest completion |
| `slayer_task_complete` | `target` | slayer task completion |

**Authoring rule (§8 regression):** every `monsterId` must exist in `monsters.json`, every `raidId` in
`raids.json`, every `itemId` in `items.json`. Covered by a pool-integrity test (§8 below). Author a
large pool (target ≥ ~12–15 per tier so days feel varied); the 5 sample entries above are the seed.

### 3.2 Migration — `migrations/0025_daily_tasks.sql`
```sql
-- Per-character daily task issuance + progress. Server-authoritative; lives
-- outside the save blob (like kill_counts/collection_log) so the credit-once
-- grant and progress survive last-write-wins save merges.
CREATE TABLE IF NOT EXISTS character_daily_tasks (
  character_id INTEGER NOT NULL REFERENCES characters(id),
  task_date    TEXT    NOT NULL,            -- 'YYYY-MM-DD' (UTC)
  slot         INTEGER NOT NULL,            -- 0..4
  task_id      TEXT    NOT NULL,
  tier         TEXT    NOT NULL,
  target       INTEGER NOT NULL DEFAULT 1,
  progress     INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,                     -- ms epoch; NULL = incomplete
  credited     INTEGER NOT NULL DEFAULT 0,  -- 1 once +1 credit granted (idempotency flag)
  issued_at    INTEGER NOT NULL,
  PRIMARY KEY (character_id, task_date, slot)
);
CREATE INDEX IF NOT EXISTS idx_daily_tasks_char_date
  ON character_daily_tasks(character_id, task_date);
```
No new nonce table needed — the `(character_id, task_date, slot)` row plus the `credited` flag is the
idempotency key (atomic `UPDATE … WHERE credited = 0`). Reuses the existing `audit_events` table (0016).

---

## 4) Server

### 4.1 `functions/_lib/game/dailyTasks.js` (shared lib)
- `utcDayKey(nowMs = Date.now())` → `new Date(nowMs).toISOString().slice(0, 10)`.
- `nextResetMs(nowMs)` → ms until next 00:00 UTC (for the modal countdown, also exported to client via a
  tiny shared helper or recomputed client-side).
- Seeded RNG: `hashSeed("\`${characterId}:${dateKey}\`")` (xfnv1a) → `mulberry32`. Deterministic so a
  concurrent double-issue picks the same set.
- `selectDailyTasks(characterId, dateKey, pool)` → for each tier in `COMPLEXITY_ORDER`, filter pool by
  tier, sort by `id` (stable), pick `hash % len`. Returns 5 `{ slot, taskId, tier, target }`.
- `ensureDailyTasks(env, characterId, dateKey)`:
  1. `SELECT * FROM character_daily_tasks WHERE character_id=? AND task_date=?`.
  2. If 5 rows → return them.
  3. Else `selectDailyTasks(...)`, `INSERT OR IGNORE` all 5 in a `DB.batch` (PK-safe under first-login
     races), then re-`SELECT` and return. (`OR IGNORE` + re-select makes concurrent first-logins safe.)

### 4.2 `GET /api/daily-tasks` — `functions/api/daily-tasks/index.js`
`requireAuth` + `X-Character-Id` (validate ownership, same guard as `kill-counts.js`).
```
const dateKey = utcDayKey()
const rows = await ensureDailyTasks(env, characterId, dateKey)
return json({
  date: dateKey,
  resetInMs: nextResetMs(),
  tasks: rows.map(r => ({
    slot: r.slot, taskId: r.task_id, tier: r.tier,
    target: r.target, progress: r.progress,
    completed: !!r.completed_at
  }))
})
```
This is the **"first login of the day"** surface — called on boot and again on a detected day rollover.
Issuance is lazy: the first GET of a new UTC day creates the set.

### 4.3 `POST /api/daily-tasks/complete` — `functions/api/daily-tasks/complete.js`
Modelled on `skip-hour.js` (atomic credit mutation + audit + PvP lockdown).
```
auth + characterId (ownership check)
assertNotInActiveMatch(env, characterId)         // credits must not move mid-match
body = { taskId, slot, date }
// 1. Validate row matches an issued, uncredited task
// 2. (cheap cross-check) if trigger is boss/raid: require kill_counts.updated_at >= issued_at
//    else (skilling/quest/etc): trust the claim (bounded-trust model)
const claimed = await DB.prepare(`
  UPDATE character_daily_tasks
     SET progress = target, completed_at = ?1, credited = 1
   WHERE character_id = ?2 AND task_date = ?3 AND slot = ?4
     AND task_id = ?5 AND credited = 0
  RETURNING task_id, tier
`).bind(now, characterId, date, slot, taskId).first()

if (!claimed) {
  // already credited OR no such issued task → idempotent no-op
  return json({ ok: true, alreadyCompleted: true, creditsGranted: 0 })
}

const grant = await DB.prepare(`
  UPDATE characters SET credits = credits + 1
   WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NULL
  RETURNING credits
`).bind(characterId, auth.identity.id).first()

await auditLog(env, 'daily_task.completed',
  { characterId, identityId: auth.identity.id, taskId, tier: claimed.tier,
    credits_remaining: grant?.credits ?? 0 }, { swallow: true })

return json({ ok: true, taskId, creditsGranted: 1, credits: grant?.credits ?? 0 })
```
Ordering: the `credited=0` guard flips **first** (the idempotency point); the credit grant follows. If
the grant query were ever to fail, the audited completion row is the recovery record. Replays return
`creditsGranted: 0` — no double grant.

### 4.4 (Optional) `POST /api/daily-tasks/progress`
Persists partial progress server-side so quantity tasks survive a device switch:
`UPDATE … SET progress = MAX(progress, ?) WHERE … AND credited = 0`. v1 can skip this and keep partial
progress client-side (save blob / local), syncing only the terminal completion that grants credit. Add
later if cross-device partial progress is desired.

---

## 5) Client

### 5.1 Cloud client — `src/cloud/api.js`
```js
getDailyTasks:    () => request('/api/daily-tasks'),
completeDailyTask: (payload) =>
  request('/api/daily-tasks/complete', { method: 'POST', body: JSON.stringify(payload) }),
```

### 5.2 Engine — `src/engine/dailyTasks.js` (pure, no UI imports — §3)
- `import pool from '../data/dailyTasks.json'`; `taskById(id)`.
- `matchTaskProgress(task, event)` → integer increment (0 if no match). Pure mapping of the trigger
  taxonomy in §3.1. `raidId: "any"` matches any `raid_complete`.
- `isComplete(taskState)` → `progress >= target`.
- Re-exports `COMPLEXITY_COLORS`/`COMPLEXITY_ORDER` from `src/utils/complexityColors.js`.

### 5.3 Event surfacing — `src/state/gameState.jsx`
There is currently **no global event bus** for item/kill gains (confirmed by grep). Add a minimal one:
- Context method `recordGameEvent(evt)` where `evt` is `{ kind, ...payload }` matching §3.1.
- A `dailyTaskTracker` (in `gameState` or a `useDailyTasks` hook) holds the day's task states, and on
  each event runs `matchTaskProgress` against the 5 assigned tasks, increments local progress, and when
  a task first reaches `target` **and** is not yet credited:
  - calls `api.completeDailyTask({ taskId, slot, date })`,
  - on success `setCredits(res.credits)` (reuses the existing header `credits` state + the
    `credits_remaining` live-update pattern already used by skip — `App.jsx:1517/1834/2201`),
  - shows a toast (`addToast('Daily task complete! +1 💎', 'success')`),
  - marks the local task completed (guards against duplicate POSTs).

**Emit sites** (wire `recordGameEvent` at existing mutation boundaries — minimal, scoped, §13):
| Event | Where |
|---|---|
| `monster_kill` | regular monster death in `CombatScreen.jsx` (and idle-combat catch-up) |
| `boss_kill` / `raid_complete` | where `completeMonster`/`completeRaid` are called (`CombatScreen.jsx`, raid flow) |
| `skill_produce` / `skill_gather` | skilling product grant in the activity/idle engines (live + idle catch-up, aggregated counts) |
| `skill_xp` | XP-award helper |
| `clue/minigame/quest/slayer _complete` | their respective completion handlers |

**Idle / offline catch-up:** when idle progress is claimed, feed the aggregated kill/item/xp deltas as
events too, so offline gains count toward tasks.

### 5.4 Boot + rollover — `src/App.jsx` / `src/cloud/sync.js`
- On `cloudPhase === 'ready'` (character selected), fetch `api.getDailyTasks()` alongside the existing
  `me()` / `getKillCounts()` / `getCollectionLog()` boot fetches; store `dailyTasks`, `dailyTaskDate`,
  `dailyTaskResetInMs` in state.
- **Day rollover while open:** on tick/visibility-change, if `utcDayKey()` !== `dailyTaskDate`, re-fetch
  `getDailyTasks()` (server issues the fresh set; uncompleted tasks are abandoned by design).
- Pass to `Header`: `onDailyTasks` (open modal), `dailyTasksCompleted` (count of completed), total `5`.
- Render `DailyTasksModal` from `App.jsx` (same pattern as `BuyCreditsModal` at `App.jsx:2636`).

### 5.5 Header — `src/components/Header.jsx`
- New props: `onDailyTasks`, `dailyTasksCompleted = 0`, `dailyTasksTotal = 5`, gated on `isCloudAccount`.
- Add a 📋 button in the left group, beside Skip / Credits, 44×44 tap target (§9), styled like the
  existing pills (Tailwind utilities + `:root` variables, no `/N` opacity). Badge text `x/5`; gold
  (`var(--color-gold)`) when `x === 5`.

### 5.6 Modal — `src/components/DailyTasksModal.jsx`
- Built on the shared `Modal` (like `BuyCreditsModal`). Title “Daily Tasks”.
- Sub-header: `X/5 complete · resets in HH:MM:SS (UTC)` countdown from `resetInMs`.
- 5 rows sorted by `COMPLEXITY_ORDER`; each row:
  - left border / tier chip in `COMPLEXITY_COLORS[tier]`,
  - `GameIcon` (with emoji fallback per §12 guard) + name + description,
  - progress `12/20` or a `GildedComplete` ✓ when done,
  - `+1 💎` reward marker.
- Tasks the player can't yet do are **still shown** (the whole point — encourages account growth); no
  blocking, optionally a faint “Requires …” hint derived from item/monster data. No requirement gating.

---

## 6) Build / registration checklist (§9, §11, §12)
- `src/data/dailyTasks.json` — content (immutable).
- `src/utils/complexityColors.js` — new shared util → add to `build_single.cjs` `sourceFiles`; update
  `QuestsScreen.jsx` to import it (removes its local `COMPLEXITY_COLORS`/`COMPLEXITY_ORDER`).
- `src/engine/dailyTasks.js` — engine (core).
- `src/components/DailyTasksModal.jsx` — new shared component → register in `build_single.cjs`
  `sourceFiles`. **Core, not chunk** (rendered from `App.jsx`, like `BuyCreditsModal`); do **not** add to
  `GAME_CHUNK_FILES` — the header that opens it is core and always present.
- `src/cloud/api.js`, `src/state/gameState.jsx`, `src/components/Header.jsx`, `src/App.jsx` — edits.
- `functions/_lib/game/dailyTasks.js`, `functions/api/daily-tasks/index.js`,
  `functions/api/daily-tasks/complete.js` — server.
- `migrations/0025_daily_tasks.sql`.
- Watch §12 duplicate-identifier: extracting the colour map (not redefining it) avoids a clash with
  `QuestsScreen`.

---

## 7) Tests (`tests/**/*.test.ts`, Vitest, logic-only)
- `dailyTasksPool.test.ts` — pool integrity: tier coverage (≥1 per tier), unique ids, every
  `monsterId`/`raidId`/`itemId` resolves in `monsters.json`/`raids.json`/`items.json` (§8 regression).
- `dailyTasksSelect.test.ts` — `selectDailyTasks` is deterministic per `(characterId, dateKey)`, returns
  exactly one per tier, and is idempotent on re-issue.
- `dailyTasksMatch.test.ts` — `matchTaskProgress` per trigger type (incl. `raidId:"any"`); `isComplete`.
- `dailyTasksComplete.test.ts` — endpoint: grants +1 once; replay returns `creditsGranted: 0` (no double
  grant); unknown/unissued task → no-op; active-match lockdown returns the lock; credit increment is
  atomic. (Mirror `tests/slayerSkipEndpoint.test.ts` / `bossSkipCost.test.ts`.)

**Commit gate (§11):** `npm test && npm run build && npm run rebuild && npm run check:single`
(or `npm run ci && npm test`). Don't commit with failing checks.

---

## 8) Docs
Update **CLAUDE.md** in the same change (repo rule): add a Daily Tasks bullet to §4/§14 —
“5 tasks/day, one per tier, **00:00 UTC** reset, **+1 credit** each; server-authoritative grant via
`/api/daily-tasks/complete` (idempotent `credited` flag + audit), **never** via `/api/save`; issuance is
lazy on `GET /api/daily-tasks`; durable table `character_daily_tasks` (outside the save blob).”

---

## 9) Edge cases & rollout
- **Non-cloud / local accounts:** no credits → hide the header button + modal (gate on `isCloudAccount`).
- **New character mid-day:** first `GET /api/daily-tasks` issues today's set immediately.
- **Day rollover mid-session:** re-issue on UTC date change; uncompleted tasks drop (reroll daily).
- **PvP active match:** completion endpoint refuses (`assertNotInActiveMatch`), consistent with credits.
- **Character reset / one-life death:** tasks key on `character_id`; a new/reset character starts fresh.
- **No backfill:** table starts empty; first GET per day per character issues lazily.
- **Timezone:** everything UTC; modal countdown computed to the next UTC midnight.

---

## 10) Phased delivery order
1. **Migration + server lib + endpoints** (`0025`, `_lib/game/dailyTasks.js`, GET + complete) + endpoint
   tests. Verifiable in isolation.
2. **Content pool** `dailyTasks.json` (≥~12/tier) + pool/select/match tests.
3. **Shared colour util** extraction + `QuestsScreen` refactor (no behaviour change).
4. **Client wiring:** `api.js`, `gameState` event bus + tracker, boot/rollover fetch in `App.jsx`.
5. **UI:** `Header` button + `DailyTasksModal`, registered in `build_single.cjs`.
6. **Emit sites:** wire `recordGameEvent` at combat/skilling/idle/completion boundaries.
7. **Docs** (CLAUDE.md) + full commit gate.
