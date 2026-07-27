---
paths:
  - "functions/api/pvp/**"
  - "functions/_lib/pvp*.js"
  - "functions/api/leaderboard.js"
  - "src/engine/pvp*.js"
  - "src/data/pvpBots.json"
  - "world/server/PvpMatchRoom.ts"
---

# PvP Rules (Current Lockdown)

Path-scoped rule — auto-loads when working on PvP code. See `CLAUDE.md` §10 for the pointer. The core combat tick model and prayer/combo invariants live in `CLAUDE.md` §4 and §6.

- Server-authoritative under `/api/pvp/*`.
- Matchmaking constraints: combat level ±10; Ironman and One-Life blocked.
- Save/idle/purchase/skip-hour writes are **locked** while `characters.active_match_id` is set.
- Tick cadence: 600ms; deterministic ordering by tick + character ids.
- PvP special energy: starts at 100, regenerates **+10 every 30s**, capped at 100.
- **Equipment swap never adds an attack delay** (OSRS parity): equipping/unequipping leaves `attackTimer` untouched — a ready attack swings with the newly equipped weapon on the same tick; mid-cooldown swaps keep the remaining cooldown, and the new weapon's speed applies from the next swing.
- Simultaneous deaths tie-breaker: lower `characterId`.
- Protection prayers disabled in PvP v1 (only offensive prayers apply, and they drain the prayer pool — see `CLAUDE.md` §4).
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
