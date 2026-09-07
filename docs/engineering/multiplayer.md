# Multiplayer contributor reference

Read for changes in this domain. Code paths are repository-relative; numbered
sections and cross-references use the stable numbering in AGENTS.md. Explicitly
read applicable .claude/rules files when the host does not load them.

## 10) PvP — the Wilderness (open world only)
PvP is **one open-world zone** (`wilderness`), entered from the Combat screen's card → `openWorld(api, 'wilderness')`. There is no lobby and no duel: `/api/pvp/*`, `PvpMatchRoom` and the `pvp_matches`/`pvp_waiting_room`/`pvp_invitations` tables were deleted in migration 0035 once the zone shipped — **don't rebuild a second PvP path**, `world/shared/pvpArea.ts` is the only gate. Safe camp with a bank chest in the south, a walled line with three gates, open PvP north of it. ±10 combat bracket, single combat, protection prayers live, **death drops pack AND worn gear**. Ironman **and Grindman** may fight and keep bot drops but never player drops (`takesOwnLootOnly` in `world/server/loot.ts` is the one funnel for both, and for all floor loot they don't own); One Life ends there like anywhere else. Roaming bots (`src/data/pvpBots.json` templates) are the offline opponent and the only Zesta source, and exist only while a player is north of the line. Full rules → path-scoped rule **`.claude/rules/pvp.md`** (Claude hosts may auto-load on `src/engine/pvp*`, `world/server/pvp*`, `world/shared/pvpArea.ts`, `src/data/pvpBots.json`, `functions/api/leaderboard.js`). Tick model §6; prayer/combo `.claude/rules/gameplay-engine.md`.

## 20) Co-op Boss Fights (`/api/coop/**`)
Several players versus one shared boss, in the idle game — a server-authoritative Durable Object session (`CoopBossRoom`) with loot shared across everyone who reaches a 10% damage threshold. Full mechanics, invariants and traps (the WebSocket push protocol, save-lock/heartbeat rules, kill-settlement idempotency, chat/loot broadcasts): path-scoped rule **`.claude/rules/coop-raids.md`** (Claude hosts may auto-load on `functions/api/coop/**`, `world/server/CoopBossRoom.ts`, and the co-op client/engine files).

## 21) Raid Parties (`/api/coop/raid/**`)
A raid run as a co-op session (§20 is the substrate — same room, same tick, same save lock, same 10% loot gate), with a lobby, host-started run, and one payout at the end across the whole run. Full mechanics: the same **`.claude/rules/coop-raids.md`** rule as §20.

