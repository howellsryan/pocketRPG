# PvP vs co-op bossing: should the duel move into a Durable Object?

Review of `/api/pvp/*` against the co-op boss room (`world/server/CoopBossRoom.ts`), written after
co-op moved off the D1 tick loop. Verdict: **yes, but stage it** — the cheap half of the win needs no
DO and should land first.

## 1. How the two differ today

| | Co-op boss (after migration 0031) | PvP duel (now) |
|---|---|---|
| Who advances the tick | the room's own 600ms `setInterval` | whichever client's `POST .../tick` wins the race |
| State home | DO memory | `pvp_matches.state_json`, read + written per tick |
| Intents | queued in room memory | a `pvp_intents` row per action, sweep-collected later |
| D1 per ordinary tick | 0 | ~11 statements per request, ×2 clients |
| What a client sees | state + every event after the tick it acknowledged | state only on the beat it won; `state: null` otherwise |
| Settlement | after the tick commits, keyed by a D1 idempotency row | inside the same request that computes the tick |

## 2. What the review found

**a. Losing the tick race blanks the poll.** `functions/api/pvp/match/[id]/tick.js:270` returns
`state: null, events: []` when another poller already advanced the beat. Two clients on the same
600ms cadence means each renders roughly every other beat — the same class of bug as co-op's
"~1 tick in 8", at 1-in-2. It is survivable only because `recentEvents` carries history and
`PvpCombatScreen.jsx:288` filters by tick, so splats batch up rather than vanish.

**b. The fight's pace is the clients' pace.** A backgrounded tab polls at 1500ms
(`PvpCombatScreen.jsx:28`). Both players backgrounded → the duel crawls, then trips the 15s stall
sweep and **aborts with no loot transfer** (`functions/_lib/pvp.js:76`). A server clock deletes the
whole class: the fight resolves whether anyone is watching or not, which is also the stronger
anti-rage-quit posture.

**c. Settlement runs before the tick is durable.** `finalizeTerminalMatch` rolls loot, reads both
saves and computes the transfer, then finds out whether its tick counted — structurally the bug that
double-granted co-op drops. PvP escapes it because the whole thing is one `DB.batch()` transaction
and the save writes are guarded on `saves.updated_at`, so the loser of the race no-ops. The
two-attempt retry loop is then safe only because attempt 1 already stripped the loser. That is an
invariant held by circumstance, not by a key.

**d. `sweepStaleRows` runs on every hot-path request.** Seven statements — including a
`characters LEFT JOIN pvp_matches` correlated update that scans the character table — on every tick
poll *and* every intent post (`tick.js:258`, `intent.js:102`). At two clients × 1.67Hz that is
~23 sweep statements/second per active match, and it scales with concurrent matches, not with
anything that needs sweeping. The lobby/waiting/invitation call sites are the ones that actually
need it.

**e. Actions cost a full round-trip each.** A gear swap posts one intent per item, serially
(`PvpCombatScreen.jsx:484`), each ~11 D1 statements including a `MAX(character_seq)` read and a
durable row write, all to deliver a value the next tick consumes and discards.

### Not broken — leave alone
- Two combatants, not eight: the state-blob fan-out that made co-op urgent is 4× smaller here.
- `characters.active_match_id` as the save lock. The room should hold it exactly as co-op does.
- Lobby, waiting room, invitations, ranks, bot seeding — low frequency, D1 is right.
- Bot AI injection is already in-memory with no DB writes (`tick.js:307`).

## 3. Recommendation

**Phase 0 — do this regardless of the DO decision (~half a day).**
1. Drop `sweepStaleRows` from `tick.js` and `intent.js`. Keep it on lobby/waiting/invitations/save,
   where it already runs on natural traffic. Removes ~65% of PvP's D1 statements on its own.
2. On `advance: false`, return the current state and the events after the caller's `sinceTick`
   instead of `state: null`. Fixes (a) with no architecture change.
3. Accept a batch of actions in the tick request body so a full armour swap is one round-trip.

Phase 0 is worth landing even if phase 1 never ships, and it does not conflict with it — steps 2 and
3 are the same API shape the room will speak.

**Phase 1 — move the live match into `PvpMatchRoom`.** Justified by (b) and (c), which phase 0
cannot reach: only a server clock fixes pacing, and only single-threading plus a settlement claim
makes exactly-once structural rather than incidental. The pattern is already proven and the engine is
portable — `processPvpTick(state, intents, itemsData, now)` is the same pure shape as
`processCoopTick`.

## 4. Phase 1 shape

- **Class** `world/server/PvpMatchRoom.ts`, hosted in `pocketrpg-world` (a Pages project cannot
  export a DO class), bound cross-script as `PVP_ROOM`. Addressed `pvp:<matchId>`, so one match is
  one object.
- **Proxies**: `/api/pvp/match/[id]/{tick,intent,forfeit}` become thin authenticated proxies over
  `callPvpRoom`, mirroring `functions/_lib/game/coopRoom.js`. One D1 read (ownership) per request,
  none in the fight.
- **Unchanged**: match creation (`pvpMatchCreate.js`) still writes the row, seeds `state_json` and
  sets `active_match_id`; the room hydrates from it on first touch, exactly like `ensureLoaded`.
- **Intents**: in-memory queue, per-member cap. `pvp_intents` stops being written; keep the table and
  drop it in a later migration once no deployed client can still reach the old path.
- **Checkpoint into DO storage, not D1.** This is where PvP should diverge from co-op. Co-op
  checkpoints to D1 every 25 ticks because the boss picker needs live HP columns; a duel has no such
  reader, so the eviction backstop belongs in the DO's own transactional storage — cheap enough to
  write every tick. A 15s D1 cadence would let an eviction resurrect a dead duellist or refund eaten
  food. Mirror to D1 only on settlement.
- **Settlement**: keep the existing single `DB.batch()` — the two-sided loot move must stay one
  transaction — but claim the terminal first with a conditional
  `UPDATE pvp_matches SET status = 'settling' WHERE status = 'active'` so a DO evicted mid-grant
  cannot replay it. The `saves.updated_at` guards stay as defence in depth.
- **Stall handling** moves into the room: it keeps swinging while at least one client polls (a closed
  tab must still lose the duel), and aborts only after every member has gone quiet past the timeout.
  The global 15s sweep in `pvp.js` stays as the crash backstop for rooms that never come back.
- **Degradation**: a missing `PVP_ROOM` binding reports PvP unavailable in the lobby, the way co-op
  does. Do not keep the D1 tick path as a live fallback — two settlement implementations is exactly
  the thing that rots. Deploy the Worker before Pages.

**Not in scope.** WebSockets. `WorldZone` already runs `partyserver`, so a socket transport is
available, but the DO's clock is what fixes (b) — polling a room that ticks itself is already
correct, and swapping the transport is an independent change worth doing on its own evidence.

## 5. Cost

Per active match, ordinary tick, D1 statements per second: **~37 now → ~3 after phase 0 →
~3 after phase 1** (the ownership read on each proxied poll), with the remaining writes moving to
settlement and DO storage. The bigger win in phase 1 is correctness, not volume — PvP concurrency is
low enough that D1 cost alone would not justify it.

Effort: phase 0 half a day. Phase 1 ~400 lines of room (largely mirroring `CoopBossRoom`), ~100 of
proxies, settlement relocation, small client change (send `sinceTick`, stop branching on `advanced`),
plus tests alongside `tests/coopBossRoom.test.ts`.
