# PvP System Review Findings (Pre-Merge)

Date: 2026-04-27
Reviewer: Codex

## Summary

This review compares implementation against `pvp-architecture.txt` and identifies issues that should be addressed before merging.

## Blockers

1. **Special attacks are queued but not resolved in PvP engine**
   - `queue_special` sets `specialAttackQueued = true`.
   - Tick resolution does not consume queue, spend energy, or apply a special attack effect.

2. **One-active-match invariant is not fully enforced**
   - Schema enforces unique `character_a` and unique `character_b` separately.
   - This does not prevent the same character from appearing as `character_a` in one match and `character_b` in another active match.
   - Accept path updates `active_match_id` with `WHERE ... active_match_id IS NULL` but does not assert both rows were updated.

3. **Intent validation is too permissive**
   - `/intent` validates shape + tick bounds only, then stores action JSON.
   - The architecture expects server-side validation against current combatant state.

4. **Accept lifecycle mismatch with architecture**
   - Client accept flow does not retry once on `stale_save` after a second `pushNow()`.
   - Client accept flow does not pause ticks / delete idle / clear `pocketrpg_activeTask` after match accept.

## Additional Gaps

- Sweep-on-poll is not consistently invoked by every PvP endpoint (`GET /api/pvp/invitations`, `POST /api/pvp/match/:id/forfeit` do not sweep).
- PvP test coverage is currently minimal relative to architecture claims.

## What is implemented correctly

- Save lockouts are wired on `/api/save`, `/api/idle` (PUT+POST), `/api/purchase`, and `/api/skip-hour`.
- Loot transfer logic matches design intent for coins override, untradeables retained, and bank overflow accounting.

## Verification commands run

- `npm test` (fails due to unrelated non-PvP tests)
- `npm run -s test -- pvpEngine` (passes)
