# AGENTS.md — PocketRPG Contributor Guide

> **Purpose**: Fast, reliable instructions for AI/human contributors. Keep this file aligned with the live codebase and scripts.

## 1) Project Snapshot
- **Game**: Menu-driven idle/simulation fantasy RPG.
- **Engine tick**: 600ms.
- **Experience goals**: Mobile-first UI, offline-first gameplay, deterministic core logic.

## 2) Tech Stack (Current)
- **UI**: Preact.
- **Styling**: Tailwind via CDN in `index.html` (single-file build also injects CDN).
- **Persistence**: IndexedDB + `idb` + localStorage.
- **Build tooling**: Vite + TypeScript transpile for single-file bundle.

## 3) Repository Layout Rules
- `src/engine/`: Pure game logic. **No UI imports**.
- `src/screens/`: Top-level UI screens.
- `src/state/`: Preact context/hooks and app state wiring.
- `src/db/`: Persistence/data access.
- `src/data/`: Static JSON definitions (treat as immutable content data).
- `tests/**/*.test.ts`: Logic regression tests.

## 4) Core Gameplay Invariants
- Always use `Math.floor()` for gameplay rounding.
- Inventory capacity is a hard 28-slot limit.
- HP regeneration: +1 HP per 60s.
- Auto-bank trigger: full inventory; delay scales from 5m (Agility 1) to 10s (Agility 99).
- Combat style bonuses:
  - Accurate/Aggressive/Defensive: +3 relevant effective level.
  - Controlled: +1 to attack/strength/defence effective levels.
- Dragonfire: 33% proc, max 50 hit, fully blocked by `otherBonus.antiDragon: true`.

## 5) XP & Leveling
- Level range: 1–99.
- XP cap: 200,000,000.
- XP formula:
  - `totalXP(L) = floor(sum(x=1..L-1, floor(x + 300 * 2^(x/7)) / 4))`
- Starting HP level baseline: level 10 (1,154 XP).
- XP gains:
  - Combat: 4 XP per damage to primary skill, 1.33 XP per damage to HP.
  - Magic: base spell XP + 2 XP per damage.

## 6) Combat Tick Model
- Global tick: 600ms.
- Melee max hit:
  - `floor(0.5 + effectiveStr * (bonus + 64) / 640)`
- Accuracy:
  - `maxRoll = effectiveLevel * (bonus + 64)`
  - if `attackRoll > defRoll`: `1 - (defRoll + 2) / (2 * (attackRoll + 1))`
  - else: `attackRoll / (2 * (defRoll + 1))`
- Auto-fight restart delay after kill: 1.2s.

## 7) Special Attacks
- PvE special energy (`combatState.specialAttackEnergy`) is 0–100.
- PvE behavior: starts each fight at 100, drains on use, refills on kill.
- Manual trigger only via combat UI (`⚡ Special Attack`).
- No automatic/offline special attack firing.

### Adding a weapon with a special attack
1. Confirm the weapon has an existing PocketRPG design and maintain PocketRPG-owned fantasy naming.
2. Confirm adaptation design with the user for PocketRPG-specific behavior.
3. Add `specialAttack` object to item in `src/data/items.json`.
4. Implement behavior in `applySpecialAttack()` in `src/engine/combat.js`.
5. Add label entry in `specLabels` in combat screen handling.

Schema:
```json
"specialAttack": {
  "type": "string",
  "energyCost": 25,
  "description": "Player-facing description",
  "stunTicks": 33,
  "minHeal": 10,
  "lightningMax": 16
}
```

## 8) Drops & Data Authoring
- Before adding a monster drop, ensure every referenced item exists in `src/data/items.json`.
- **Item Naming**: All item `name` fields must use **Title Case** (each word capitalized), e.g., "Bronze Dagger", "Oak Logs", "Iron Ore".
- Stackables (coins/runes/arrows): quantity as `[min, max]`.
- Non-stackable equipment: `quantity: 1`.
- Collection log upkeep: whenever adding a new boss unique, raid unique, minigame reward item, or clue reward item, add the matching slot to `src/data/collectionLog.json` in the same change and include/update a regression test.

## 9) UI/Styling Rules
- Minimum tap target: 44×44px.
- Prefer Tailwind utility classes + CSS variables from `index.html`.
- Avoid inline `style={{}}` unless value is truly dynamic per render (e.g., computed widths/colors).
- Do not use Tailwind `/N` opacity modifiers; use solid CSS variable colors.
- Reuse shared components in `src/components/` before inventing new wrappers.
- If introducing a new shared component, register it in `build_single.cjs` `sourceFiles` with existing component ordering conventions.

## 10) PvP Rules (Current Lockdown)
- Server-authoritative under `/api/pvp/*`.
- Matchmaking constraints:
  - combat level ±10,
  - Ironman and One-Life blocked.
- Save/idle/purchase/skip-hour writes locked while `characters.active_match_id` is active.
- Tick cadence: 600ms; deterministic ordering by tick + character ids.
- PvP special energy:
  - starts at 100,
  - regenerates +10 every 30s,
  - capped at 100.
- Equipment swap anti-abuse: `attackTimer = max(currentTimer, newWeaponSpeed)`.
- Simultaneous deaths tie-breaker: lower `characterId`.
- Protection prayers disabled in PvP v1.
- Forfeit treated as death for loot transfer.

### PvP Bot System
- Bot characters live in the `characters` table with `is_bot=1` and a `bot_template_id` referencing `src/data/pvpBots.json`.
- Bots are seeded once via `scripts/seed-pvp-bots.cjs` (outputs SQL for `wrangler d1 execute`). Add `npm run seed:bots` to run it.
- **Four integration seams**:
  1. **Lobby** — `GET /api/pvp/waiting` UNIONs virtual bot entries (no real waiting-room rows) for the player's CB band.
  2. **Auto-accept** — `POST /api/pvp/invitations` detects `target.is_bot` and calls `createMatch()` immediately, bypassing the normal accept handshake.
  3. **AI injection** — `tick.js` calls `computeBotIntents(state, botId, itemsData)` before `processPvpTick` and merges intents in-memory (no DB writes for bot actions).
  4. **Post-match reset** — `resetBotSave(env, botCharacterId)` rebuilds the bot's save from its template after every match end or stall-abort.
- **Loot on bot match end** (server-authoritative, in `finalizeTerminalMatch`):
  - Human wins → `rollBotLootBox()` grants coins (~70% 1k–10k, ~28% 10k–50k) or a Zesta unique (~2%); loot goes to the human's bank via `fillBank()`. Collection log entry written for Zesta drops.
  - Bot wins → `splitInventoryByTradeable()` strips human's tradeable gear (item sink); untradeable items stay.
  - Normal PvP loot transfer (`applyLootTransfer`) is bypassed entirely for bot matches.
- **Reward items** (untradeables, collection log category `pvp` / section `pvp_bots`): `zesta_longsword`, `zesta_vest`, `zesta_skirt`.
- Bot template format: see `src/data/pvpBots.json`. `aiProfile` field selects behaviour in `src/engine/pvpBotAI.js`.
- Bots are excluded from the PvP kill-count rank ladder (`pvpRanks.js` CTE filters `is_bot = 0`).

## 11) Build/Test Commands (Authoritative)
Use these npm scripts as the source of truth:
- `npm test` → full Vitest run.
- `npm run build` → runs `prebuild` (`test:logic`) then Vite build.
- `npm run rebuild` → transpile + single-file concat via `build_single.cjs`.
- `npm run check:single` → duplicate identifier/syntax safety for single-file output.
- `npm run ci` → required validation bundle (`build` + `rebuild` + `check:single`).

### Commit gate (required)
Before commit/push, run either:
- `npm test && npm run build && npm run rebuild && npm run check:single`, **or**
- `npm run ci` **and** `npm test`.

Do not commit with failing checks.

## 12) Single-file Build Safety
- `index.html` is generated by concatenating transpiled modules.
- Top-level declarations must be globally unique.
- Treat duplicate identifier syntax errors as release-blocking.
- Prefer shared helpers from `src/utils/helpers.js` over redefining common top-level names.

### Code-split: core script + lazy game chunk
- `build_single.cjs` emits **two CLASSIC scripts** (not `type="module"`): the inline core in `index.html`, and a content-hashed `game-<hash>.js` chunk with the heavy in-game screens (listed in `GAME_CHUNK_FILES`). The chunk loads lazily once the player enters the game (`cloudPhase === 'ready'`) via `globalThis.__loadGameChunk`, keeping ~130 KiB of unused JS off the landing/login page (Lighthouse "Reduce unused JavaScript").
- Classic scripts share one global lexical environment, so the chunk references core's bindings and `App.renderScreen` references the chunk's screens — all by **source name**. Both bundles are minified with `minifyIdentifiers: false` to keep those names stable; do not re-enable identifier minification.
- Unique top-level names matter **across both files**. `npm run check:single` syntax-checks each artifact plus the combined concatenation to catch cross-script redeclarations.
- Adding a new **in-game** screen: add it to `sourceFiles` **and** `GAME_CHUNK_FILES`. Landing/auth-reachable screens must stay out of `GAME_CHUNK_FILES`, and nothing in core may reference a chunk binding at module-evaluation time (only inside `renderScreen`).
- `gameIconsData` (the ~126 KiB icon glyph map) is injected into the **chunk**, not core — the mobile landing never renders icons. Core icon code (`GameIcon`, `itemIcons`, `skillArt`) guards every access with `typeof gameIconsData !== 'undefined'` and falls back to an emoji until the chunk loads; the desktop landing fetches the chunk on mount to swap real icons in. Keep those guards if you touch icon code.

## 13) Contribution Best Practices for Agents
- Keep changes minimal and scoped; avoid unrelated refactors.
- Update tests with new gameplay logic (deterministic, logic-only).
- Prefer source-of-truth edits in `src/**`; generated output should follow from build scripts.
- Generated root `index.html` is a build artifact from `npm run rebuild`; do not commit `index.html` changes in normal PRs.
- If instructions in this file conflict with direct user/developer/system instructions, higher-priority instructions win.
- When this guide becomes stale, update it in the same PR as the behavior/script changes.

## 14) Production Security Model (Server Authority)
- PocketRPG is offline-first: live skilling, idle/offline catch-up, and skip-hour compute XP, coins, and drops on the **client** and persist them through `/api/save`. There is no server-side game engine to recompute against, so XP/coins (and any client-created items: idle/offline loot, crafted/smithed/cooked products, skill capes) are **client-authoritative by design**. The leaderboard is best-effort, not cheat-proof — do not add `/api/save` checks that try to police economy/item *increases*; they break the core loop and provide no real protection while XP/coins remain client-side.
- Integrity is enforced where it actually *can* be server-authoritative, not on the trusted save:
  - **High-value reward grants** — boss/raid/clue/minigame/dungeoneering uniques are granted by the server-side completion endpoints (`/api/actions/**`), which roll loot RNG server-side, record kill-counts and collection-log entries, and claim a nonce for replay protection. These are the legitimate grant path for the honest client; the save merely carries the already-granted item.
  - **Purchases** — `/api/purchase` debits coins and grants the item server-side.
  - **Credits** — debited atomically by `/api/skip-hour` and `/api/slayer/skip`; never bumped from `/api/save`.
  - **PvP settlement / trading post** — their own server-authoritative paths.
- `/api/save` enforces exactly two write guards, both integrity (not anti-cheat): stale-write rejection (`save_revision`) and the total-level regression guard (account-wipe protection — a save whose total level drops below the stored one is refused).
- New API mutations that can materially change economy/progression must emit audit events.

## 15) MCP Server (`/api/mcp`)
- A stateless MCP (Model Context Protocol) server lives in the Pages app at `functions/api/mcp.js` (JSON-RPC 2.0 over POST). It lets AI assistants view characters and run server-authoritative actions, and serves context via `instructions` + resources (`functions/_lib/mcp/reference.js`). Roadmap: `docs/mcp-roadmap.md`. Gap-closure plan: `docs/mcp-gap-plan.md`.
- Tools never duplicate game logic: each `tools/call` forwards the caller's bearer token to the matching `/api/*` handler via `functions/_lib/mcp/bridge.js`, so all auth/locks/audit run in the existing endpoints. Adding a tool = add it to `functions/_lib/mcp/schema.js` (metadata) and `functions/_lib/mcp/tools.js` (dispatch).
- Auth is **OAuth 2.1** (PKCE + Dynamic Client Registration), tailored for ChatGPT custom connectors. PocketRPG is its own authorization server (`functions/api/oauth/**`, `functions/.well-known/**`, `functions/_lib/oauth/**`, migration `0022`); the issued access token is the normal session JWT, verified by `requireAuth` like every other route. The in-app consent screen is `src/screens/OAuthConsentScreen.jsx` (reached via `/?oauth=…`, must stay out of `GAME_CHUNK_FILES`). No new secrets — reuses `JWT_SECRET`.

### MCP extension rule (how to add or change a tool)
1. **Default to a bridge tool** — import the real `/api/*` handler and call it via `callHandler` in `tools.js`. API changes (auth, locks, audit, validation) propagate for free; nothing in `intents.js` needs to change.
2. **Use a save-intent only when no endpoint exists** — write a pure function in `functions/_lib/mcp/intents.js` that mutates the decoded save object in place and throws `GameApiError` on bad input. Intents **must** reuse shared `src/engine` helpers (especially `applyTaskResult` from `src/engine/applyTaskResult.js` for any idle-sim result) — never re-code reward application.
3. **Adding a tool always requires three files**: `schema.js` (metadata + JSON Schema input), `tools.js` (dispatch handler), and a test in `tests/mcpIntents.test.ts` or `tests/mcpServer.test.ts`. The parity test in `tests/mcpServer.test.ts` ("every advertised tool has a dispatch handler") enforces schema ↔ dispatch lockstep.
4. **`src/engine/applyTaskResult.js` is the single source of truth** for applying idle simulation results (XP, bank, inventory, HP, ammo/charges, dungeoneeringTokens) to a save. Both the MCP (`intents.js`) and the browser (`gameState.jsx`) import it. Never copy-paste this logic — extend the shared module instead.
- Keep scope to three kinds of action: reads, server-authoritative bridge tools (the legitimate grant/spend paths), and *constrained* save intents — pure, validated mutations that reuse `src/engine` helpers (idle-sim claims, bank/gear moves, instant prayer/construction/magic training, farming). Never expose a raw/arbitrary save write: the save blob is not a free-form write target, and anything that grants a high-value unique or spends credits/points must go through its existing endpoint, not an intent. See `docs/mcp-roadmap.md` for the shipped surface and the deliberately-excluded set.