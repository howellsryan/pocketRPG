# Multiplayer Bossing — Review & Priority Plan (2026-07-18)

Review of the open-world companion app (`world/`) ahead of a first multiplayer bossing release. Scope: current state, bugs/exploits, boss-fight quality, multiplayer scalability, engine soundness, idle-game account sync, the known paths/realism gap, and automation. Items are numbered in priority order. Skilling expansion is phase 2 (post-release) and excluded.

## Current state

Phases 0–7 plus the terrain track are code-complete and self-verified: auth handoff from the idle game, zone DO with 600ms ticks, A\* movement + run energy, mining/woodcutting/smithing/cooking, real-engine combat (melee/magic/ranged reach), shared-kill damage attribution, floor loot, banking with provenance pools, equipment visuals, presence/chat, reconnect carry-over, six zones (pasture, forest, Lumbright, Varrick, Varrick Dungeon, plus fixtures), and the D1-backed world editor. Varrick Dungeon holds three bosses — Warlord Grondar (GLB model, two-hand smash), Krylth the Defiler, and Venomcoil Matriarch (both procgen blend-shell) — all dropping collection-log uniques and ~20k coins per kill.

The engine foundation is sound and worth keeping: combat is the real `src/engine/combat.js` (no re-implemented maths), grants are idempotent (`world_grants` key + save-revision retry) with clamped removals that block most dupe vectors, every flush is audited, reconnects carry the live session over losslessly, and zones are validated on load. The problems below are almost all *missing enforcement or missing features*, not a broken core.

---

## P0 — Integrity and exploit blockers (fix before release)

### 1. Enforce world ↔ idle-game session exclusivity
The whole grant design assumes "a world session and the main game are never played simultaneously by design" (`world/server/grants.ts:31`) — but nothing enforces it. Both clients write the same save concurrently:

- **Equipment clobber / dupe**: a world flush with `equipmentDirty` overwrites `save.equipment` wholesale (`grants.ts:164`). If the idle game equipped something new meanwhile, that item is erased; if both sides unequip the same item, the world's minted grant plus the idle game's inventory copy duplicate it.
- **Stale views**: `bankView` and the seeded pack are snapshots from hello; idle-game consumption after that makes clamped removals silently vanish items the world player is still holding.
- **Revision churn**: world flush retries win against idle-game PUTs, giving the idle client stale-write rejections mid-play.

Fix: a `world_sessions` row (character id, heartbeat, TTL) written at hello and cleared at disconnect flush. `/api/save` PUT returns 409 while it's live (same pattern as the PvP lockdown at `functions/api/save.js:138`), and the idle client shows "You're adventuring in the World". Cheap, and it converts the design assumption into a guarantee.

### 2. Close the PvP save-lockdown bypass
`/api/save` enforces `assertNotInActiveMatch`, but the world's `flushGrants` → `writeSave` path does not, and neither `/api/world-token` nor the DO hello checks for an active match. A player in a locked PvP match can mutate their save (equipment, items, XP) through a world session. Add the active-match check to world-token issuance and to `handleHello`, and assert it inside `flushGrants` as defence in depth.

### 3. Add food consumption timing
`handleInvAction` eat runs instantly outside the tick loop with no cooldown (`world/server/WorldZone.ts:672`) — the 15 msg/s soft limit allows ~9 heals per 600ms tick. Spam-eating outheals any boss, which trivialises all three dungeon fights. Enforce the main game's consumable timing (§4: one food + one combo item per cooldown window) server-side in the tick model.

### 4. Line of sight + real chase pathing (kills the safespot exploit)
`withinRange` is pure Chebyshev distance (`world/server/tick.ts:188`) — walls and pillars don't block ranged/magic in either direction — and `chaseStep` is a greedy one-tile step that wedges on obstacles (`world/server/npc.ts:129`). The boss hall has 45 blocked pillar tiles: stand behind one within magic range (7) and every boss dies without ever landing a hit. Grondar's magic defence is 0, so this is the obvious meta from day one. Fix: Bresenham tile LOS required for ranged/magic attacks (both player and monster), and chase via the existing `pathAdjacent` A\* callback with a short repath cadence instead of the greedy step.

### 5. Record boss kills server-side: collection log, kill counts, per-kill audit
Main-game boss kills flow through `/api/actions/monster/complete` → `_completeShared.js` (collection_log insert, kill counts, nonce, audit). World kills roll drops in the DO and flush through `world_grants` only — a `grondar_hilt` from the world never appears in the collection log, no boss KC increments, and there's no per-kill audit row for a ~1/500 unique. `docs/open-world-next-phases-scope.md` already decided world boss kills "must emit the same server-side collection-log/kill-count side-effects" — that requirement is now due, since all three dungeon bosses drop log uniques. Implement in `killNpc`/the flush path, keyed per kill, plus emitting the daily-task/event-bus signals where applicable.

### 6. Fix ranged ammo accounting
Two related bugs in `world/server/combat.ts`: the engine consumes ammo by mutating session equipment, but combat never sets `equipmentDirty`, so consumed arrows are never removed from the save — ranged ammo is free in the world. And the engine's `noAmmo` event isn't handled in `stepCombat`'s event loop, so an out-of-ammo fight silently stalls forever instead of stopping with a message. While here, audit charge-carrying items end-to-end (session inventory/equip snapshots drop `charges` fields; the bank view already excludes them, the pack path doesn't).

---

## P1 — Make the boss fights actually good

### 7. Prayer in the world
No prayers exist in world combat (`processCombatTick` receives `{}` for active prayers). Protection prayers are *the* OSRS boss mechanic, and the dungeon already covers two styles (Grondar/Krylth melee, Venomcoil ranged). Reuse `src/engine/prayerDrain.js` (the declared source of truth): prayer pool seeded from the save at hello, a prayer tab in the HUD, drain per tick, restore via potions (item 8). Without this, bossing is eat-tanking only.

### 8. Potions
`drink` is currently refused with a message. Boost infra (temporary stat deltas + decay per tick) unlocks combat/prayer/restore potions — the supply half of every boss trip. The engine already understands boosted levels; the world needs the session-side boost state and decay.

### 9. Real multi-player boss behaviour
Today the first attacker claims `npc.attackerId` and holds it for the whole fight — the boss never hits the other N−1 players, so group bossing is free DPS for everyone but one. Move monster swings out of the per-player engine sessions into a zone-side attack driver that picks targets (top-damage threat, or random per swing), and give bosses:
- **Aggression radius** in boss rooms (all monsters are currently passive until clicked — walking past Grondar unbothered undercuts the fantasy; D5's "all passive" decision predates bossing).
- **AoE/specials**: Grondar's two-hand smash should hit every melee-range player; a Graardor-style secondary ranged hit would make protection-prayer choice meaningful. Author these as per-boss data (attack table with style/range/AoE flags), not code per boss, so item 18's pipeline can scale it.
- **Sane respawn pacing**: 25 ticks (15s) between kills of a 255-HP, 20k-coin boss invites farming loops; benchmark GP/hr and XP/hr against the §4 boss guardrails and lengthen accordingly.

### 10. Death and entry rules for the dungeon
Dying respawns you at the *dungeon's own spawn* tile with no penalty, full HP, ~40 tiles from the boss. Decide the death model (respawn in Varrick is the minimum; item-risk can wait) and make dungeon entry a deliberate trip. Also give the three bosses separated wings — their wander rects currently overlap (Grondar x15–24 / Krylth x9–18 / Venomcoil x23–32 all share z16–20), so they drift into each other and stack.

### 11. Boss-fight presentation and group feedback
A boss HP frame (not just the overhead bar), damage-contribution readout so the top-damage loot rule (D1) is legible mid-fight, a kill feed, and a zone-wide broadcast when a unique drops. Cheap DOM work on the existing event channel, big multiplayer payoff.

### 12. Decide (and audit) floor-drop item transfer
Dropped items go public after ~10s and anyone can pick them up into their save — that is unrestricted cross-account item transfer with no audit trail, live today. If intended as proto-trading, add an audit event on picking up another player's drop and a value cap; if not, restrict public pickup to world-minted loot.

---

## P2 — Scalability and operations

### 13. Instancing/sharding before the player counts arrive
One Durable Object per zone name means **one global Varrick Dungeon and one Grondar for the entire playerbase**. The tick is O(players × entities) on a single-threaded DO with per-player JSON serialization in `broadcastDiffs`, and every player's save flushes on the same tick every 100 ticks (`tick()` bottom) — spiky D1 bursts. Plan, in order:
- Per-zone player cap with shard rooms (`varrick_dungeon#2` — the DO already keys by room name, so this is a shard-picker in `/api/world/session` plus a presence registry) and/or party-instanced boss rooms, which also solves boss-kill contention between strangers.
- Stagger timed flushes by `charId % CHECKPOINT_EVERY_TICKS`.
- Pre-serialize the shared diff payload once per tick; add per-player interest filtering only when zones get big.
- **Measure first**: log tick duration + player count per zone, and build a load-test bot harness (N WebSocket drivers replaying walk/fight traffic) to find the real per-DO ceiling before players do.

### 14. Multiplayer hygiene: moderation
Chat is sanitized and rate-limited but has no profanity filter, mute/block, or report path. A public world with open chat needs at least client-side mute + a server report log before release.

### 15. Ops follow-through
Confirm Workers Builds auto-deploy is connected for `world/` (left as a dashboard task in `docs/world-progress.md`), alert on `[World][grants] flush failed` logs (each one is silent player item/XP loss), and rotate `WORLD_EDITOR_TOKEN` periodically — it's a static bearer secret guarding production zone edits and a raw teleport endpoint.

---

## P3 — World realism (the known paths gap)

### 16. Roads and paths
Nothing connects places visually — the known gap. Recommended shape: zone JSON gains `roads: [{points: [[x,z],…], width}]`; the terrain material blends a packed-earth strip along the polyline (same `onBeforeCompile` ramp technique as the existing elevation/slope blend — no new textures needed); generators auto-route roads between gates/POIs using the existing A\* over the collision grid, then dress them (fences, lanterns, signposts from kits already in `assets/open-world/`). Bonus: minimap draws them, and NPC/quest hubs read as connected.

### 17. The rest of the realism stack, in payoff order
Ambient audio (the client has none — footsteps, boss roars, zone beds are the single cheapest immersion win), water for river/coast zones, the T5 terrain editor brush + heightmap PNG import so authored places stop relying on procedural relief, and a day/night tint cycle.

---

## P4 — Automation to build faster

### 18. One-command boss pipeline
Everything a boss needs exists but as manual steps across two package roots. Build `npm run new:boss <monsterId>` scaffolding: creatures3d spec stub (or GLB build script), `monsterModels.ts` bounds via `inspect-glb`, zone npc entry, examine text, collection-log slot check, appearance/zone tests, and `render-proc`/`shoot-zone` screenshots — then extend the `add-content` skill with the world-boss checklist so agent sessions follow it. Per item 9, boss attack tables should be data so this pipeline covers mechanics too.

### 19. Promote the throwaway e2e drivers into CI
Every phase was verified with ad-hoc WebSocket driver scripts that were then discarded — the highest-value automation already exists and keeps being rewritten. Land them as `world/e2e/` (wrangler dev + local D1 + WS drivers + Playwright screenshots) and run them in `world-check.yml`; attach zone screenshots as CI artifacts for visual review of content PRs.

### 20. Shared zone-generation library
Each `gen-*.mjs` re-implements walls, prop footprints, flood-fill reachability, and blocking passes. Extract a shared generator lib (footprint blocking + reachability + road routing from item 16) so new zones are declarative descriptions, and wire the same checks into the editor's save validation.

---

## P5 — OSRS-feature backlog (post-release)

Deliberately after the bossing release, roughly ordered: friends list/private chat · a real trade screen (supersedes item 12's floor trading) · world map across zones · slayer-task integration (world kills counting toward tasks, boss tasks pointing at the dungeon) · agility shortcuts in zones · clue steps in the world · bank placeholders/presets in the world bank UI · music per zone · more bosses on the item-18 pipeline (green_dragon lair remains the decided next boss after the dungeon trio) · skilling parity (phase 2, per the release plan).
