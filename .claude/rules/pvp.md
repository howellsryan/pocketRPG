---
paths:
  - "functions/api/pvp/**"
  - "functions/_lib/pvp*.js"
  - "functions/api/leaderboard.js"
  - "src/engine/pvp*.js"
  - "src/data/pvpBots.json"
  - "world/server/PvpMatchRoom.ts"
  - "world/server/pvp*.ts"
  - "world/shared/pvpArea.ts"
---

# PvP Rules

Path-scoped rule — auto-loads when working on PvP code. See `CLAUDE.md` §10 for the pointer. The core combat tick model and prayer/combo invariants live in `CLAUDE.md` §4 and §6.

## PvP is the Wilderness (the live system)

The lobby/duel system below is **unreachable**: nothing in the client opens it. All PvP is the open-world `wilderness` zone.

- **Rules live in `world/shared/pvpArea.ts`** — the line (`PVP_LINE_Z`, north is decreasing z), the ±10 bracket, the single-combat lock, and `pvpAttackRefusal`, which is the ONE gate every attack passes. The world client imports the same module for its menu rows, so a menu never advertises an attack the server refuses.
- **The swing maths are `resolveSwing` in `src/engine/pvpEngine.js`**, exported for `world/server/pvpCombat.ts`. Do not write a second PvP damage path — specials, magic runes, ranged ammo and stat-draining specs all come from that one function. What the world adds on top is reach + line of sight, the single-combat lock, and **protection prayers** (`protectionReduction` in `world/shared/prayer.ts`, mirroring `combat.js`'s private rule).
- **Crossing the line is gated at `takeSteps` (`ctx.blockStep`), not at each path assignment** — a walk, a follow and an approach path all funnel through it, so there is exactly one place a player can cross. Consent is armed by `{t:'pvpConsent'}` and **spent by the crossing** (`pvpCrossed`), so the prompt returns on the next trip north; clearing it on "is in the camp" alone would cancel it in the tick it was given.
- **Death drops everything** — pack and worn gear both (`collectDeathDrops`). The pack drains the provenance pools; worn gear does NOT (it leaves the save through the emptied `equipment` snapshot, so draining it too removes the same units twice). The flush is immediate, never debounced.
- **Ironman may fight and may keep bot drops, but never player drops.** `LootEntity.fromPlayer` refuses them in both `mayTake` and `isVisibleTo`, *including when they are the owner* — winning the fight does not make somebody else's account theirs.
- **Bots are players, not npcs** (`world/server/pvpBots.ts`): diffed `kind:'player'`, attacked through the same gate, driven by `computeBotIntents` + the engine's own `applyIntent` — which is what refuses protection prayers for every future prayer too. They drop `rollBotLootBox()`, never their gear, and they exist **only while a real player is north of the line** (the DO's tick loop stops on an empty room; a surviving bot would be a room that never idles out).
- Player kills increment `characters.total_pvp_kills` (`recordPvpKill`); **bot kills do not** — a ladder farmable off the offline opponent is not a ladder. Zesta uniques hit the collection log at the kill via `persistPvpBotCollectionLog`, the same writer settlement used.
- Occupancy for the idle game's card is `GET /api/world/pvp-count` on the **world Worker** (Pages has no WorldZone binding), CORS-open and cached — a failed fetch hides the number, never the entry card.

## The dormant duel system (`/api/pvp/*`)

Still deployed, no longer reachable from any client entry point. Left in place deliberately; do not build on it.

- Server-authoritative under `/api/pvp/*`.
- Matchmaking constraints: combat level ±10; Ironman and One-Life blocked.
- Save/idle/purchase/skip-hour writes are **locked** while `characters.active_match_id` is set.
- Tick cadence: 600ms; deterministic ordering by tick + character ids.
- PvP special energy: starts at 100, regenerates **+10 every 30s**, capped at 100.
- **Equipment swap never adds an attack delay** (OSRS parity): equipping/unequipping leaves `attackTimer` untouched — a ready attack swings with the newly equipped weapon on the same tick; mid-cooldown swaps keep the remaining cooldown, and the new weapon's speed applies from the next swing.
- Simultaneous deaths tie-breaker: lower `characterId`.
- Protection prayers disabled in the DUEL engine (only offensive prayers apply, and they drain the prayer pool — see `CLAUDE.md` §4). The Wilderness deliberately diverges: protection prayers are live there.
- Forfeit is treated as death for loot transfer.
- **Magic combat (PvE parity)**: all three styles fight in PvP. `combatType` is derived from the equipped weapon; magic uses the shared `resolveMagicSwing` (`src/engine/combatPrimitives.js`). Standard spells consume runes from the combatant's **inventory** per cast (an equipped elemental staff supplies its element rune free, as in PvE; the bank is never consulted in combat) and a cast is blocked with a `no_runes` event when runes run out. Powered staves (`item.poweredStaff`, e.g. Trident) need no spell/runes and scale max hit off magic level. The active spell is seeded from `save.settings.activeCombatSpell` at match start and changed mid-fight via the `change_combat_spell` intent (validated in `intent.js`; resolved against `src/data/spells.json` by the engine).

## PvP Bot System
- Bots live in the `characters` table with `is_bot=1` and a `bot_template_id` referencing `src/data/pvpBots.json`. Seeded once via `scripts/seed-pvp-bots.cjs` (`npm run seed:bots`).
- **Four integration seams**:
  1. **Lobby** — `GET /api/pvp/waiting` UNIONs virtual bot entries for the player's CB band.
  2. **Auto-accept** — `POST /api/pvp/invitations` detects `target.is_bot` and calls `createMatch()` immediately.
  3. **AI injection** — `tick.js` calls `computeBotIntents(state, botId, itemsData)` before `processPvpTick`, merging intents in-memory (no DB writes for bot actions).
  4. **Post-match reset** — `resetBotSave(env, botCharacterId)` rebuilds the bot's save from its template after every match end or stall-abort.
- **Loot on bot match end** (server-authoritative, `finalizeTerminalMatch`): human wins → `rollBotLootBox()` grants coins or a ~2% Zesta unique to the human's bank (collection log written for Zesta); bot wins → `splitInventoryByTradeable()` strips the human's tradeable gear (item sink). Normal `applyLootTransfer` is bypassed for bot matches.
- **Reward items** (untradeables, collection log category `pvp` / section `pvp_bots`): `zesta_longsword`, `zesta_vest`, `zesta_skirt`.
- `aiProfile` in the template selects behaviour in `src/engine/pvpBotAI.js`.
- Bots are excluded from the PvP kill-count rank ladder (the ranking query filters `is_bot = 0`; see `functions/_lib/pvpRanks.js` and `functions/api/leaderboard.js`).
