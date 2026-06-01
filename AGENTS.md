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

### Monster max hit — stats are the single source of truth
- A monster's max hit is **always derived from its stats**, never authored as a standalone number. The engine computes it from the offensive stat matching the monster's `attackStyle`:
  - `ranged` → `stats.ranged`
  - `magic` → `stats.magic`
  - melee (`stab`/`slash`/`crush`) → `stats.strength`
  - Formula (same as the player's): `floor(0.5 + (stat + 8) * ((strengthBonus || 0) + 64) / 640)`.
- **Do NOT add a top-level `maxHit` field to a monster.** It is not read by the combat engine for normal monsters; tune the relevant offensive stat (and `strengthBonus`) instead so the derived value matches the intended hit. A regression test (`tests/monster-maxhit-by-style.test.ts`) enforces that the raid bosses carry no override.
- **Accuracy is independent of the damage stat.** Monster attack rolls read `stats.magic || stats.attack`, not `stats.strength`/`stats.ranged`. So raising a ranged/melee monster's damage stat changes only its max hit, not its hit chance — exploit this to retune damage without touching difficulty-via-accuracy.
- **Only exception — multi-form / phased bosses** (e.g. Olm, Verzik, Nylocas, Sotetseg): each form declares a per-form `maxHit` inside its `forms.<key>` block, which the engine copies into the runtime-only `formMaxHit`. This is the *one* place a literal max hit is authored, because forms do not carry their own per-form stat block. Never set top-level `maxHit` even on these bosses.
- When changing the max-hit formula or the stat-selection logic in `src/engine/combat.js` / `src/engine/idleEngine.js`, keep both call sites in sync and update `tests/monster-maxhit-by-style.test.ts`.

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
- **New monsters: stats are the source of truth for damage.** Set `attackStyle` plus the matching offensive stat (`stats.strength` for melee, `stats.ranged` for ranged, `stats.magic` for magic) so the engine derives the intended max hit — do **not** add a top-level `maxHit` field. See §6 "Monster max hit — stats are the single source of truth" for the formula and the multi-form exception.
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
- `build_single.cjs` emits **two CLASSIC scripts** (not `type="module"`): the inline core in `index.html`, and a content-hashed `game-<hash>.js` chunk with the heavy in-game screens (listed in `GAME_CHUNK_FILES`). The chunk is fetched lazily once the player enters the game (`cloudPhase === 'ready'`) via `globalThis.__loadGameChunk`, keeping ~130 KiB of unused JS off the landing/login page (Lighthouse "Reduce unused JavaScript").
- Classic scripts share one global lexical environment, so the chunk references core's bindings and `App.renderScreen` references the chunk's screens — all by **source name**. That's why both bundles are minified with `minifyIdentifiers: false`; do not re-enable identifier minification (it would break cross-script references).
- Globally-unique top-level names matter **across both files** now. `npm run check:single` syntax-checks each artifact and the combined concatenation to catch cross-script redeclarations.
- Adding a new **in-game** screen: add it to `sourceFiles` **and** `GAME_CHUNK_FILES`. A screen reachable on the landing/login path (landing/auth) must stay out of `GAME_CHUNK_FILES`. Nothing in the core script may reference a chunk binding at module-evaluation time (only inside `renderScreen`, which runs after the chunk loads).

## 13) Contribution Best Practices for Agents
- Keep changes minimal and scoped; avoid unrelated refactors.
- Update tests with new gameplay logic (deterministic, logic-only).
- Prefer source-of-truth edits in `src/**`; generated output should follow from build scripts.
- Generated root `index.html` is a build artifact from `npm run rebuild`; do not commit `index.html` changes in normal PRs.
- If instructions in this file conflict with direct user/developer/system instructions, higher-priority instructions win.
- When this guide becomes stale, update it in the same PR as the behavior/script changes.

## 14) Production Security Model (Server Authority)
- Treat browser/client state as untrusted for progression/economy outcomes.
- API/server must authoritatively validate and mutate important outcomes (items, coins, XP, points, unlocks, collection log, PvP settlement, credits usage).
- `/api/save` must reject stale writes (`save_revision`) and reject unauthorized protected reward/economy deltas.
- High-value/protected rewards (boss/raid/clue/minigame/dungeoneering and restricted items) require server-authoritative mutation paths with regression tests.
- New API mutations that can materially change economy/progression must emit audit events.
