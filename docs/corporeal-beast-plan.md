# The Corporeal Horror — boss + drop chain

Design record for the OSRS Corporeal Beast adaptation: a spear-gated damage sponge with a two-form Dread Core mechanic and the Wraithbone shield/sigil drop chain. **Shipped** — this document describes what was built and why.

## 1) Naming

| OSRS | PocketRPG |
|---|---|
| Corporeal Beast | **The Corporeal Horror** (`corporeal_horror`) |
| Dark energy core | **Dread Core** (a form of the boss, not a separate monster) |
| Spirit shield | **Wraithbone Shield** |
| Holy elixir | **Sanctified Elixir** |
| Blessed spirit shield | **Hallowed Wraithbone Shield** |
| Arcane sigil / shield | **Runeward Sigil** → **Runeward Wraithbone Shield** |
| Elysian sigil / shield | **Aegis Sigil** → **Aegis Wraithbone Shield** |
| Spectral sigil / shield | **Vigil Sigil** → **Vigil Wraithbone Shield** |

Every item keeps its OSRS id in `legacy_item_id` / `legacy_id` for provenance. `data-contracts.test.ts` blocks the legacy-name list from player-facing data.

## 2) Monster — `src/data/monsters.json`

Combat level 785, 2,000 hitpoints — between the God Wars tier (580–650) and the raid bosses (940–1040). No Slayer requirement; gated on the quest `the_heart_of_shadows` via the existing data-driven `questRequirement` field (`src/engine/combatRequirements.js:38`). `skipCost: 5` — read by `functions/api/skip-hour.js`, the existing credit-debit authority.

Defences are lopsided (`slash`/`crush`/`ranged` 200, `magic` 150, **`stab` 25**) so a spear is both exempt from the resistance and the accurate choice.

## 3) Spear resistance

```jsonc
"resistance": { "multiplier": 0.5, "exemptWeaponClass": "spear" }
```

Every player hit is halved unless the equipped weapon carries `weaponClass: "spear"` (tagged on `bronze_spear`, `krylth_spear`, `gorath_s_warspear`). Rules live in `src/engine/monsterDamageRules.js` and are applied in both PvE damage paths, which compute damage independently:

- `src/engine/combat.js` — normal swings, and every branch of `applySpecialAttack` (per hit, so reported hits still sum to the damage that landed).
- `src/engine/idleEngine.js` — `avgHitStats`, so idle/offline/skip-hour can't kill the boss twice as fast as live play.

PvP is deliberately untouched: the field lives on monsters and no PvP path reads monster definitions.

## 4) Dread Core — an add, not a phase

The Core is a **second live monster**, not a form of the boss. Both are on the field at once, both attack on their own timers, and the player chooses which to swing at:

| | The Corporeal Horror | Dread Core |
|---|---|---|
| Role | the kill | the punish |
| Hitpoints | 2,000 | 180 |
| Attack | crush, speed 4, max 55 | magic, speed 3, max 25 |
| Extra | halves non-spear damage | **8 prayer points burned per landed hit** |
| Reward | full drop table | none — no loot, no kill count, no slayer credit |

`dread_core` is its own `monsters.json` entry flagged `isAdd: true`; the boss carries the spawn cadence:

```jsonc
"spawnsAdd": { "monsterId": "dread_core", "firstSpawnAfterAttacks": [7, 10], "respawnAfterAttacks": [7, 10] }
```

Spawn delays are counted in **boss attacks**, so the cadence tracks the pace of the fight rather than wall-clock ticks. Killing a Core only clears it — the boss sends another every 7–10 of its own attacks — so the fight is a running trade between damage on the boss and control of the prayer pool. Killing the boss takes its Core off the field.

**Adds are a generic, data-driven capability, not a Corporeal Horror special case.** No engine or UI file mentions `dread_core`. A future boss gets an add by adding data only: point its `spawnsAdd` at a monster and flag that monster `isAdd`. `tests/bossAdds.test.ts` proves it — every behavioural test there runs on a synthetic boss/add pair with invented ids — and pins the contract (`spawnsAdd` resolves to a real `isAdd` monster; adds carry no drops).

Rules live in `src/engine/bossAdds.js` (spec parsing, spawn-delay rolls, target resolution). `combat.js` holds only the wiring:

- `createCombatState(monster, type, stance, spell, monstersData)` resolves the add definition and arms the first spawn.
- `setCombatTarget(state, 'add' | 'boss')` — the only way to switch; a request to target a dead or absent add falls back to the boss, so a stale flag can never strand the player hitting nothing. The screen's target picker reuses the quick-prayer tile styling (`cb-slot.is-active` + ring), so the enemy being hit reads at a glance.
- `resolveEnemySwing` is shared by the boss and the add, so both obey one accuracy/max-hit/mitigation/prayer-burn path. Two `monsterHit` events can land in one tick; the screen subtracts each event's damage rather than reading its `playerHP`, so they apply cumulatively.
- `resolveTargetDeath` splits the two deaths: an add despawns and queues a replacement, only the boss can end the fight.
- Damage events carry `toAdd`, so hit splats land over the HP bar of the enemy actually hit (`splatsFromCombatEvents` returns `{ monster, add, player }`).
- Specials follow the selected target, so a queued spec is never silently redirected to the boss.

Adds only exist on bosses, and `simulateIdleCombat` refuses bosses outright, so no idle-sim modelling was needed. The MCP boss-fight simulator targets the add on sight, the same call a player makes.

## 5) Drop table

`dropRolls: 1`; the server rolls this same table via `functions/_lib/game/monsterRewards.js`, so **no separate server loot table exists**.

### Uniques

| Item | Chance |
|---|---|
| Wraithbone Shield | 1/64 |
| Sanctified Elixir | 1/128 |
| Runeward Sigil | ~1/1,365 |
| Aegis Sigil | ~1/1,365 |
| Vigil Sigil | ~1/1,365 |

### Secondaries (OSRS-shaped)

Coins 20k–40k · blood/death/law/soul runes in 150–400 stacks · **Onyx Bolts (E) 100–200** · **blue/red/green charms** · Runeforged platebody & 2h sword · Rynarr Weed / Snapdrake / Thornspire · Uncut Onyx · Clue Scroll (Elite).

No spear drops from it — the boss requires one, and dropping it collapses the gear check. Pinned by a test.

Economy check: ~1.21m gp per kill on average, ~41m gp/hr at a 1.8-minute spear kill. Roughly 823k of that average is the three sigils, i.e. the mean is lottery-dominated exactly as in OSRS; excluding sigils it sits at ~13m gp/hr, below Threefang Cerberus.

## 6) The shield chain

One-step `combineWith` / `combineResult` recipes (the Duskmare orb pattern), chained:

```
Wraithbone Shield + Sanctified Elixir     → Hallowed Wraithbone Shield
Hallowed Wraithbone Shield + <sigil>      → Runeward / Aegis / Vigil Wraithbone Shield
```

Defensive stats and requirements mirror their OSRS counterparts; all are `slot: "shield"`, so the Armoury lists them automatically.

| Item | Def (stab/slash/crush/magic/ranged) | Other | Requirements |
|---|---|---|---|
| Wraithbone Shield | 40/40/40/5/40 | prayer +2 | 45 Def, 55 Prayer |
| Hallowed Wraithbone Shield | 55/55/55/5/55 | prayer +3 | 70 Def, 60 Prayer |
| Runeward Wraithbone Shield | 55/55/55/5/55 | +20 magic attack, **magicDamage +10**, prayer +3 | 70 Def, 75 Prayer |
| Aegis Wraithbone Shield | 65/65/65/3/65 | prayer +3, **70% chance to cut a hit by 25%** | 75 Def, 75 Prayer |
| Vigil Wraithbone Shield | 55/55/55/25/55 | prayer +3, **halves prayer drain** | 70 Def, 75 Prayer |

### Perk implementation

Perks are **scalar** `otherBonus` keys (`damageReductionChance`, `damageReductionPercent`, `prayerDrainReduction`) because `getEquipmentBonuses` sums `otherBonus` values numerically — an object value there corrupts the sum. They are authored as 0–100 percentages so the equipment screen renders them like any other bonus (labels in `src/utils/bonusLabels.js`); `src/engine/damageReduction.js` clamps and converts them after summing.

- **Aegis** is live in PvE (`combat.js`, rolled after protection prayers so the two stack multiplicatively), in PvP (`pvpEngine.js`, applied to the incoming swing so a multi-hit special's reported hits still sum to its damage), and in the idle sim (as its expected multiplier, since idle models averages rather than rolling hits).
- **Vigil** threads a drain multiplier through `applyPrayerDrainTick` — the §4 source of truth — used by live combat and PvP, and mirrored in the idle sim's separate prayer pool.

## 7) MCP surface

- `inspect_monster` now returns a `mechanics` block (`monsterMechanics` in `functions/_lib/mcp/reference.js`): the resistance in actionable terms, the quest/Slayer gates, the credit skip cost, and every form with its style, weakness, max hit, immunity and prayer burn. Generic — every multi-form or gated boss gains it.
- `inspect_monster` drops now carry item **names**, so a client can read the table without one `inspect_item` per row.
- `itemSources` indexes **combine recipes** in both directions (`combines` on the result, `combinesInto` on each ingredient), so "how do I get an Aegis Wraithbone Shield?" resolves the whole chain instead of dead-ending at the drop. This also fixes the pre-existing Duskmare orb chain.

## 8) Wiring

Collection log section (all 9 items) · Grandmaster daily task (`slay_corporeal_horror`, 3 kills) · world activity at **Edgevale** · Combat screen category · `combatArt` + `monsterIcons` entries · `docs/game-guide.md` + regenerated chat knowledge index · both new engine modules registered in `build_single.cjs` `sourceFiles` (core, not the lazy chunk).

No D1 migration, no new endpoint, no save-format change.

## 9) Tests

- `tests/corporealHorror.test.ts` — monster data, drop table shape and rates, shield chain, resistance and perk helpers, collection log / daily task / world wiring.
- `tests/corporealHorrorCombat.test.ts` — spear vs non-spear damage in live combat *and* the idle sim, Aegis reduction in PvE and PvP (including hits summing to the reduced damage), Dread Core prayer burn and its zero floor.
- `tests/bossAdds.test.ts` — the generic add engine on a synthetic boss: spawn, both enemies swinging in one fight, damage following the selected target, an add death that neither ends the fight nor grants loot, replacement spawns, the add clearing when the boss dies, hit-splat routing, and the JSON contract for adding another one.
- `tests/mcpMonsterMechanics.test.ts` — the mechanics block and combine-recipe sources.
- `tests/data-contracts.test.ts` — the nine new items added to the verified boss-unique list.

## 10) Known gaps

- **`npm run check:drops` is broken on Node 22** (`ERR_IMPORT_ATTRIBUTE_MISSING` on `src/data/world.json`) for *every* monster, not just this one. Pre-existing; flagged, not fixed. The economy figures in §5 were computed directly from the drop table instead.
- No 3D arena model — the boss falls back to the paper doll / HP bars. The add's HP bar and target toggle render alongside the arena panel rather than inside it.
