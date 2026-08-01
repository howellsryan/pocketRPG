# Item-loss safety net

Why it exists: a loadout-preset bug (PR #895) wrote a stale copy of one holdings
container over the live one and destroyed most of a player's bank. There was
already a guard meant to catch exactly that — and it did not fire.

## Why the old guard missed it

`detectBankWipe` (`functions/_lib/game/saveValidation.js`) is still live and
still rejects what it was built for, but it is narrow in four separate ways:

1. It triggers only when ≥90% of the **distinct bank item ids** vanish. Half a
   bank is 50%.
2. It counts ids, not units. A 10,000 → 1 stack collapse is invisible to it, so
   every resource — runes, ammo, food, potions, ore — is unprotected.
3. It runs only in `functions/api/save.js`. `writeSave`
   (`functions/_lib/game/save.js`) — the trading post, `/api/purchase`, MCP
   intents, admin grants, co-op write-backs, the world's grant flush — had no
   loss guard at all.
4. Cloud pushes are debounced 120s (`PUSH_DEBOUNCE_MS`, `src/cloud/sync.js`).
   One revision routinely covers two minutes of eating, alching and selling, so
   any threshold loose enough to avoid false positives is also loose enough to
   let a real loss through. **Threshold tuning alone cannot close this.**

Point 4 is why the design below ends in a declared-intent guard rather than a
better threshold.

## Phase 1 — recoverability (shipped)

`save_history` (migration 0036) keeps the blob each write overwrites.
`functions/_lib/game/saveHistory.js` owns it.

- The snapshot is an `INSERT ... SELECT` off the `saves` row, ordered **first**
  in the writer's existing D1 batch — no extra read, no second gzip, and it must
  stay first because D1 runs a batch in order.
- Cadence and retention: `routine` at most once per character per 6h, kept 3
  days (≈12 rows per character); `item_loss` forced whenever Phase 2 flags,
  rate-limited to one per 5 minutes so a flag storm cannot fill the table, kept
  14 days; `pre_restore` written unconditionally by an admin restore, so a
  restore to the wrong snapshot is itself undoable.
- Pruned by age on a 2% probabilistic gate on the save path.

Recovery is `/api/admin/restore-save` (`ADMIN_SECRET` only, same as
`grant-item`), surfaced as the **Salvage** panel in `/admin`:

- `GET ?character_id=` lists snapshots; `GET ?character_id=&history_id=` decodes
  one and reports what the live save has lost since it — the direct answer to
  "is this the one from before it went missing".
- `POST` restores. It honours the co-op and world save locks and the revision
  guard, refuses a character with no save row (a One-Life death deletes it, and
  a restore must not resurrect a finished run), and writes the snapshot's
  **content as the next revision** rather than rewinding `save_revision` — a
  rewind would leave the player's client pushing saves the server rejects as
  stale.

## Phase 2 — detection (shipped, shadow mode)

`functions/_lib/game/holdingsDelta.js` measures what a write destroys, in both
writers. **It rejects nothing.** `/api/save` still refuses exactly two writes
(total-level regression, bank wipe), so CLAUDE.md §14 holds unchanged.

- Holdings are read across bank ∪ inventory ∪ equipment, quantity-aware, with
  charges and coins tracked as their own scalars. A unit that moved between
  containers is not a loss; a unit that left all three is.
- Both sides are canonicalised (`canonicalItemId`) so the legacy→canonical id
  rewrite does not read as one item vanishing and another appearing.
- Classification is by `items.json` `type`, not `stackable`: `ammo`, `currency`,
  `food`, `junk`, `potion`, `quest`, `resource`, `rune`, `seed` are **resources**
  (bulk-churn); everything else is **durable**. `stackable` is the wrong axis —
  food and materials are non-stackable but consumed in bulk, runes and ammo are
  stackable but pure consumables.
- Flags: ≥2 durable units lost **and** (≥50,000 gp of them **or** ≥6 units); or
  ≥1,000,000 gp of resources. A flag writes an `item_loss_detected` audit event
  and forces a history snapshot.
- The baseline is captured in `hydrateCharacterSave` and carried in a WeakMap,
  because every server-side writer mutates its save in place — by write time the
  "before" is gone. Callers that write a *rebuilt* object (co-op's
  `applyMemberToSave`) pass `baselineFrom` explicitly; a caller with no baseline
  is skipped, never guessed at.

Shadow mode is not a soft launch, it is the measurement that makes Phase 3
safe: enforcement can only be turned on once real traffic produces no
unexplained flags.

## Phase 3 — enforcement (not built)

The mechanism, and the reason it is a separate phase: **the threat model is
bugs, not cheaters.** §14 already concedes the save blob is client-trusted, so
there is nothing to defend against a determined player here. But a buggy path
does not know it is destroying items — the preset bug wrote a stale container
wholesale and never called `removeItemFromInventory`. That asymmetry is
exploitable in our favour:

> Every legitimate item removal goes through a small set of engine helpers. Make
> those helpers write a loss ledger. Require the server-computed holdings delta
> to be **covered** by that ledger. Uncovered destruction is, by construction, a
> bug.

Double-entry bookkeeping for items. It generalises what the world already does
right: `world/server/grants.ts` passes explicit `consumed` / `movedToBank` /
`bankToInventory` lists rather than a wholesale container write.

Work items:

1. **`src/engine/lossLedger.js`** — `recordItemLoss(itemId, qty, reason)`,
   aggregated by itemId, persisted to IndexedDB, cleared **only** on a
   successful push and reset on a cloud pull. Ships as a compact `losses` field
   on the save payload. Server-side `writeSave` callers pass theirs explicitly;
   the world flush's existing delta lists convert directly.
2. **Ledger coverage** — wire it into every removal helper: `inventory.js`,
   `bankMutations.js`, `applyTaskResult`, `holdingsReconcile`, consumables,
   alching, shop sell, trading-post listing. *This is the whole risk of the
   design.* A missed path is a false rejection, which is a player who cannot
   save.
3. **Destructive actions become critical saves** — add `ITEM_DESTROYED` /
   `ITEM_SOLD` to `CRITICAL_SAVE_REASONS` so a sell or a drop pushes inside the
   3s coalesce window instead of sitting in the 120s debounce. This is what
   makes "at most one item lost per revision" true rather than aspirational.
4. **Asymmetric enforcement.** Durables: uncovered loss ≥2 units → 409
   `ITEM_LOSS_UNEXPLAINED`. One free unit as slack, because a single lost item is
   support-recoverable while a false positive blocks saving entirely. Resources:
   audit and snapshot, but **allow** — idle catch-up and skip-hour legitimately
   burn thousands of units per revision, and a tight rule there breaks the core
   loop for the class of loss that is cheapest to re-earn. Phase 1 is the net
   for those.
5. **Register the code client-side.** `ITEM_LOSS_UNEXPLAINED` goes in
   `CONFLICT_CODES` (`src/cloud/saveErrors.js`) — mandatory, per the comment
   there — so the client rolls back to the intact cloud copy instead of treating
   it as a hard save failure. The rejection then *restores* the bank.
6. **Flip enforcement only after the Phase 2 audit is clean** for a week of real
   traffic.

## Known gaps (deliberate, not oversights)

- `world/server/grants.ts` writes `equipment` wholesale (`saveObject.equipment =
  payload.equipment`) — a second instance of the preset-bug pattern. Phase 2 now
  observes it; converting it to a delta is its own change.
- The trading post's escrow sequence (`functions/api/trading-post/list.js`) makes
  three separate writes with a partial-failure window between them.
- `detectBankWipe`'s constants are untouched. Phase 2 supersedes it; retuning
  both at once is churn. Retire it once the shadow data justifies the
  replacement.
