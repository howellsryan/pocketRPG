# Gameplay contributor reference

Read for changes in this domain. Code paths are repository-relative; numbered
sections and cross-references use the stable numbering in AGENTS.md. Explicitly
read applicable .claude/rules files when the host does not load them.

## 4) Gameplay Invariants
- Round with `Math.floor()`. Inventory cap = **28** slots. HP regen **+1/60s**.
- Combat style: Accurate/Aggressive/Defensive **+3** relevant effective level; Controlled **+1** to attack/strength/defence.
- Dragonfire: **33% proc, max 50**, fully blocked by `otherBonus.antiDragon: true`.
- The rest of the engine's gameplay invariants (holdings/banking, quest gates, prayer/combo, boss adds and shared-record combat, world minions, hard mode, Grim Reaper, Slayer, Kingdom of Royals, Construction unlocks, Daily Tasks, journeys/teleports) are a path-scoped rule, not here: **`.claude/rules/gameplay-engine.md`** (Claude hosts may auto-load on `src/engine/**` and its server-side mirrors). Read it before touching any of those systems.

## 5) XP & Leveling
- Levels **1–99**. XP cap **200,000,000**.
- `totalXP(L) = floor(sum(x=1..L-1, floor(x + 300 * 2^(x/7)) / 4))`.
- Starting HP level **10** (1,154 XP).
- Gains: Combat **4 XP/damage** to primary skill, **1.33 XP/damage** to HP. Magic: base spell XP + **2 XP/damage**.
- **"How many X to level N" is `src/engine/trainingPlanner.js`**, never arithmetic in a caller — it walks the ladder picking the best option per level, applies the account XP cut and the gates outside the trained skill (gilded altar → Construction 75), and is what the `plan_training` MCP tool and the helper (§16) answer from. Only skills with a repeated-action ladder are plannable (`plannableSkillIds()`); Farming, Slayer and the combat skills have none and it refuses rather than guessing.

## 6) Combat Tick Model
- Tick **600ms**.
- Melee max hit: `floor(0.5 + effectiveStr * (bonus + 64) / 640)`.
- Accuracy: `maxRoll = effectiveLevel * (bonus + 64)`; if `attackRoll > defRoll`: `1 - (defRoll + 2)/(2*(attackRoll + 1))`, else `attackRoll/(2*(defRoll + 1))`.
- Auto-fight restart delay after kill: **1.2s**.
- **`src/engine/dpsCalculator.js` is the analytical twin of `processCombatTick`'s player-attack branches** (expected damage in place of the roll), and `gearOptimizer.js` searches loadouts with it — both consumed by the `analyze_dps` MCP tool (§15) and the helper (§16). Change a player-damage branch in `combat.js` and change the matching branch there in the same edit, or the helper recommends gear by maths the fight doesn't use. `tests/dpsCalculator.test.ts` pins the two together by simulating swings against the estimate, so drift fails the build rather than shipping a confidently wrong answer. Enchanted bolt procs, Dharok's HP scaling and special attacks are deliberately unmodelled and declared in the payload's `notes`.
- **Only a raid completion stops the game on the full-screen `LootResultModal`** (`killPresentsFullModal`, `src/utils/lootModal.js`) — a standalone boss kill flashes its loot as a reward-reveal card (`emitKillReveal`) same as an ordinary kill, and re-arms itself after the delay above; a boss no longer needs a tap-through per kill either. A server-authoritative kill (boss, or a non-boss with a collection-logged drop) simply holds the fight for the round trip before the card fires — that hold is also what stops two `completeMonster` calls overlapping. A reveal card whose loot contains a legendary item (`hasEpicLootDrop`, unit value ≥ 1m — same predicate the raid modal's purple theme uses) renders purple instead of gold, and a merged card stays purple once any absorbed kill was epic.

## 7) Special Attacks
- PvE special energy (`combatState.specialAttackEnergy`) **0–100**: starts each fight at 100, drains on use, refills on kill.
- Manual trigger only (`⚡ Special Attack`). No automatic/offline firing. Adding one → skill **`add-content`**.
- **The open world deliberately diverges**: energy is a persistent *session* resource there, never refilled by a fight ending or a kill — it only regenerates on the clock (`SPECIAL_REGEN_PER_TICK`, 10 per 30s, `world/server/tick.ts`). `player.specialEnergy` is the truth and is pushed onto the engine state each tick (`pinSpecialToSession`), because the shared engine still resets its own value on kills/phase resets. Don't "fix" the world back to the per-fight model above.
- **Master Rejuvenation** (`master_rejuvenation`, the Lv 90 Construction perk) **refills** the bar to 100 the moment it empties — `refillSpecialOnEmpty` (`src/engine/specialRegen.js`), called by all three contexts that own a copy of the energy: solo (`CombatScreen`, mid-fight only), every co-op/raid member (`processCoopTick`, in every phase — lobby and respawn wait are prep time), and the world (`tickPlayer`). The flag is read from `settings.unlockedFeatures` once per context (client Set, co-op member at join, world player at hello). **The Wilderness is the one place it is off** (`ctx.pvpZone` from `isPvpZone`, §10) — a bar that comes back free decides a duel by who owns a perk. **Empty means the bar READS 0% (`energy < 1`), not an exact zero** — solo and co-op hold whole points, but the world's energy carries the fraction of its 0.2/tick clock regen and a flat cost off 50.2 leaves 0.2, so `=== 0` fires approximately never out there. For the same reason the world applies it BEFORE the clock regen, on the same tick `stepCombat` spends.

## 8) Drops & Data Authoring
Full authoring checklist (items, drops, specials, collection log, monsters) → skill **`add-content`**. Non-negotiables: every referenced item must exist in `src/data/items.json`; item names **Title Case**; new boss/raid/minigame/clue unique needs its `src/data/collectionLog.json` slot + regression test in the same change.
- **Armoury auto-listing**: the Armoury (`src/utils/armoury.js` → `ArmouryScreen`) lists every **equippable** item — anything with an equipment `slot` (`isEquippable`), combat gear or not (fishing rods, spades, cosmetics, prayer ammo included). New gear surfaces automatically once its `slot` is set (no registration), grouped by kind and filed under the type filter (Skilling/Melee/Magic/Ranged) via `typeFilterOf` — Skilling holds skill capes and **gathering-tool weapons** (a Dragon Axe requires Woodcutting; fishing nets/rods, pickaxes, spades via `isSkillingTool`), so Slayer/Dungeoneering-gated combat gear (chaotic weapons, slayer defenders/gloves) stays in Melee/Magic/Ranged. The item modal's "How to obtain" comes from `describeObtainment`, which reverse-indexes every source (craft/combine recipe, clue, raid, minigame, slayer-point/PvP-bot reward, thieving/hunter, monster drop; Trading Post as the trade-only fallback) — wiring a new item into any of those tables makes its source show up for free.

