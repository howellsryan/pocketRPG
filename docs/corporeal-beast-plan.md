# The Corporeal Horror — boss + drop table plan

Plan only. No code written yet. Adapts the OSRS Corporeal Beast (spear-gated damage sponge, spirit-shield drop chain) into PocketRPG-owned naming and this repo's data/engine conventions.

## 1) Naming

| OSRS | PocketRPG |
|---|---|
| Corporeal Beast | **The Corporeal Horror** (`corporeal_horror`) |
| Dark energy core | **Dread Core** (phase-2 stretch, §7) |
| Spirit shield | **Wraithbone Shield** (`wraithbone_shield`) |
| Holy elixir | **Sanctified Elixir** (`sanctified_elixir`) |
| Blessed spirit shield | **Hallowed Wraithbone Shield** (`hallowed_wraithbone_shield`) |
| Arcane sigil / shield | **Runeward Sigil** → **Runeward Wraithbone Shield** |
| Elysian sigil / shield | **Aegis Sigil** → **Aegis Wraithbone Shield** |
| Spectral sigil / shield | **Vigil Sigil** → **Vigil Wraithbone Shield** |

Precedent for literal naming exists (`king_black_dragon`), but §8 prefers owned names and `data-contracts.test.ts` blocks the legacy-name list, so everything above is PocketRPG-owned. Keep `legacy_id` / `legacy_item_id` fields for provenance, as existing entries do.

## 2) Monster definition — `src/data/monsters.json`

Slots between the God Wars tier (580–650) and the raid bosses (940–1040). No Slayer requirement (not a slayer monster in OSRS, and `slayerMasters.js` should not list it).

```jsonc
"corporeal_horror": {
  "id": "corporeal_horror",
  "name": "The Corporeal Horror",
  "boss": true,
  "combatLevel": 785,
  "hitpoints": 2000,
  "questRequirement": "the_heart_of_shadows",
  "stats": { "attack": 320, "strength": 320, "defence": 310, "magic": 350, "ranged": 150 },
  "attackSpeed": 4,
  "attackStyle": "crush",
  "attackBonus": 200,
  "strengthBonus": 180,
  "defenceBonus": { "stab": 25, "slash": 200, "crush": 200, "magic": 150, "ranged": 200 },
  "resistance": { "multiplier": 0.5, "exemptWeaponClass": "spear" },
  "dropRolls": 1,
  "drops": [ /* §4 */ ],
  "legacy_id": "corporeal_beast"
}
```

Notes:
- Low `stab` defence + the spear exemption is what makes a spear the correct answer without hard-locking any other style out.
- `questRequirement` is already honoured by `checkBossRequirementsPure` (`src/engine/combatRequirements.js:38`) — data-only gate, no code change. `the_heart_of_shadows` is the closest existing Master-tier quest; a bespoke unlock quest is the alternative (§9, decision 1).
- Target kill time with best-in-slot melee + Krylth Spear: **~2.5–3.5 min**. Verify with `npm run check:drops -- corporeal_horror` and compare XP/hr against the GWD bosses (CLAUDE.md §4 keeps boss XP/hr ≤ ~2× the best regular monster).

## 3) The spear mechanic (the one real engine change)

Non-spear weapons deal **half damage**. PvE damage is computed in two independent places — live combat and the idle sim — so the rule must be shared, not duplicated:

1. New pure module `src/engine/monsterDamageRules.js`:
   ```js
   export function monsterDamageMultiplier(monster, weapon) // 1 or monster.resistance.multiplier
   ```
   No imports from UI; no top-level reads of other modules' bindings (§12).
2. Tag the spears in `src/data/items.json` with `"weaponClass": "spear"` — `bronze_spear`, `krylth_spear`, `gorath_s_warspear`. Data-driven so future spears/hastas inherit it.
3. Apply in `src/engine/combat.js` at the player-damage site (post-roll, pre-clamp, `Math.floor`), and in `src/engine/idleEngine.js` at the `avgDmgPerHit` calculation (~`idleEngine.js:998`) so idle/offline/skip-hour kill rates match live.
4. Register the new file in `build_single.cjs` `sourceFiles` (engine → core, **not** `GAME_CHUNK_FILES`).
5. **Out of scope for PvP.** `pvpEngine.js` / `combatPrimitives.js` are untouched — the field lives on monsters, and no PvP path reads monster definitions.

Tests: `tests/monsterDamageRules.test.ts` (multiplier resolution incl. no-weapon/unarmed), plus one live-combat and one idle-sim assertion that a spear kills roughly twice as fast as an equal-DPS non-spear.

## 4) Drop table

`dropRolls: 1`; every entry rolls independently, matching `rollMonsterRewardsById` (`functions/_lib/game/monsterRewards.js`). Server rolls loot from this same table, so **no separate server loot table is needed** — `/api/actions/monster/complete` already resolves through `monsters.json`.

### Uniques

| Item | Chance | Notes |
|---|---|---|
| `wraithbone_shield` | `0.015625` (1/64) | Base shield, tradeable |
| `sanctified_elixir` | `0.0078125` (1/128) | Combines onto the base shield |
| `runeward_sigil` | `0.000733` (~1/1365) | Magic sigil |
| `aegis_sigil` | `0.000733` (~1/1365) | Defence sigil |
| `vigil_sigil` | `0.000733` (~1/1365) | Prayer sigil |

All five get `isBossUnique: true`, a positive finite `shopValue` (required by `data-contracts.test.ts` for PvP coin conversion), and must be added to `EXPECTED_BOSS_UNIQUE_ITEM_IDS` in `tests/data-contracts.test.ts` or the "marked isBossUnique but not verified" assertion fails.

### Commons

| Item | Qty | Chance |
|---|---|---|
| `big_bones` | 1 | 1 |
| `coins` | 40,000–100,000 | 0.5 |
| `blood_rune` | 60–150 | 0.2 |
| `death_rune` | 50–120 | 0.18 |
| `soul_rune` | 30–80 | 0.12 |
| `runeforged_ore` | 5–12 | 0.15 |
| `uncut_onyx` | 1 | 0.004 |
| `rynarr_weed` | 3–6 | 0.1 |
| `snapdrake` | 2–4 | 0.08 |
| `clue_scroll_master` | 1 | 0.025 |

Deliberately **no** spear drop — the boss requires one, and dropping it collapses the gear check.

## 5) The shield chain — `src/data/items.json`

Uses the existing one-step `combineWith` / `combineResult` pattern (`InventoryScreen.jsx:161`), chained exactly like the three Duskmare orbs:

```
Wraithbone Shield  + Sanctified Elixir  → Hallowed Wraithbone Shield
Hallowed Wraithbone Shield + <sigil>    → Runeward / Aegis / Vigil Wraithbone Shield
```

Each sigil carries `"combineWith": "hallowed_wraithbone_shield"` and its own `combineResult`. All are `slot: "shield"`, so the **Armoury lists them automatically** (§8) and `describeObtainment` picks up the source once the drop and recipe exist.

Proposed stats (tiered above `arcane_kiteshield` / `dragon_kiteshield`, below raid gear):

| Item | Def (stab/slash/crush/magic/ranged) | Other | Requirements | shopValue |
|---|---|---|---|---|
| Wraithbone Shield | 40/40/40/5/40 | prayer +2 | defence 70 | 5,000,000 |
| Hallowed Wraithbone Shield | 45/45/45/8/45 | prayer +3 | defence 75 | 30,000,000 |
| Runeward Wraithbone Shield | 40/40/40/55/40 | atk magic +30, magicDamage +5, prayer +3 | defence 75, magic 75 | 350,000,000 |
| Aegis Wraithbone Shield | 65/65/62/15/65 | meleeStrength 0, prayer +3 | defence 80 | 400,000,000 |
| Vigil Wraithbone Shield | 50/50/50/60/45 | prayer +5, `prayerDrainReduction: 0.5` | defence 75, prayer 75 | 350,000,000 |

- **Runeward** intentionally beats `arcane_kiteshield` (magic 50 / magicDamage 8 defence-bonus profile) on attack bonus rather than raw magic damage, so it complements rather than obsoletes it.
- **Aegis**: v1 is **stats-only**. The OSRS 70%/25% damage-reduction proc would touch the shared damage-taken path (and therefore PvP), so it is deferred (§9, decision 2).
- **Vigil**: `prayerDrainReduction` is the one perk worth shipping in v1 because it has a clean, contained home — `getActivePrayerDrainPerTick` in `src/engine/prayerDrain.js` (the CLAUDE.md §4 source of truth). Must be **mirrored in `src/engine/idleSupplies.js`**, which keeps its own idle prayer pool, or idle and live diverge. PvP already forces protection prayers off, so the perk only affects offensive-prayer drain there — note it in `.claude/rules/pvp.md` if PvP drain parity is asserted anywhere.

## 6) Wiring checklist (data + UI, all mechanical)

| File | Change |
|---|---|
| `src/data/collectionLog.json` | New `monsters` section `corporeal_horror` with the 5 uniques + 3 crafted shields |
| `scripts/seed-collection-log.cjs` | Re-run / verify the seeded section |
| `src/data/dailyTasks.json` | Grandmaster entry `slay_corporeal_horror`, `boss_kill` trigger, target 5 |
| `src/data/worldActivities.json` | `{ kind: 'combat', ref: 'corporeal_horror' }` at **`edgevale`** ("last town before the wilds" — closest to the OSRS wilderness lair). Prefer re-running `node scripts/seedWorldContent.cjs` and committing the output |
| `src/screens/CombatScreen.jsx` | New `COMBAT_CATEGORIES` entry (own category, icon 👁️) |
| `src/utils/combatArt.js` | `MONSTER_ART` entry (glyph must exist in `gameIcons.json` or `bespokeIcons.json` — `combatArt.test.ts` enforces this) |
| `src/utils/monsterIcons.js` | Emoji fallback |
| `src/data/equipmentModels.json` | *Optional* `monsters` entry — enables the 3D arena, needs a GLB per `docs/gear-asset-process.md`. Ship without it; paper-doll/HP-bar fallback is automatic |
| `docs/game-guide.md` + `npm run gen:knowledge` | Player-visible mechanic → guide + regenerated knowledge index, committed |

Server: **no new endpoint**. Grants flow through the existing `/api/actions/monster/complete` → `rollMonsterRewardsById` path, which is already the §14 server-authoritative route for boss uniques.

## 7) Stretch: Dread Core phase (not v1)

`multiForm` already exists (`verzik_vitur` in `monsters.json:5831`) and would support a two-form Horror where a "Dread Core" form periodically spawns, drains the prayer pool, and must be killed before damage resumes. It needs form-switch tuning plus an idle-sim story (the idle sim flattens phases into average DPS). Defer until v1 is balanced.

## 8) Build order

1. Items: 5 uniques + 3 crafted shields + spear `weaponClass` tags.
2. Monster entry + drop table.
3. `monsterDamageRules.js` + `combat.js` / `idleEngine.js` application + `build_single.cjs` registration.
4. `prayerDrain.js` + `idleSupplies.js` drain-reduction hook.
5. Collection log, daily task, world activity, combat screen/art/icons.
6. Tests (§ below), `npm run check:drops -- corporeal_horror`, economy eyeball.
7. `docs/game-guide.md` + `npm run gen:knowledge`.
8. Commit gate: `npm run ci`.

## 9) Decisions needed before implementation

1. **Unlock gate** — reuse `the_heart_of_shadows` (data-only, recommended) or author a bespoke unlock quest (larger scope: `quests.json`, journey content, `build_quests.cjs`)?
2. **Aegis perk** — ship stats-only in v1 (recommended), or implement the damage-reduction proc now and accept the shared damage-taken/PvP surface?
3. **Drop rates** — the 1/1365 sigil rate is OSRS-faithful but this game's kill rates differ (idle catch-up, skip-hour). Confirm after `check:drops` reports gp/hr, or loosen to ~1/800.
4. **3D model** — ship without the arena entry, or budget the GLB work?

## 10) Tests to add

- `tests/corporeal-horror.test.ts` — monster exists, drop items all resolve, uniques marked `isBossUnique`, collection-log section covers every unique (the §8 regression-test requirement).
- `tests/monsterDamageRules.test.ts` — spear vs non-spear multiplier, unarmed, monsters without `resistance`.
- Idle-sim parity: spear vs non-spear kill count over a fixed window.
- `tests/prayerDrain.test.ts` — extend for `prayerDrainReduction`, plus the `idleSupplies` mirror.
- `tests/data-contracts.test.ts` — add the 5 uniques + 3 shields to `EXPECTED_BOSS_UNIQUE_ITEM_IDS`.
