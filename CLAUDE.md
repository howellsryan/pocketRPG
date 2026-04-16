# PocketRPG — Project Reference
## 1. CORE CONCEPT
Menu-driven idle/simulation fantasy RPG. 0.6s tick-based engine with a text, icon, and progress-bar UI. Mobile-first and offline-first.
## 2. TECH STACK & RULES
 * **Stack**: Preact (UI), Tailwind v4 via CDN (Style), and IndexedDB/idb/localStorage for persistence.
 * **Architecture**:
   * engine/: Pure logic with zero UI imports.
   * screens/: Top-level UI components.
   * state/: Preact context and hooks.
   * db/: Persistence layer.
 * **Flow**: Static JSON is immutable; state flows down, events flow up.
 * **Persistence**: Debounced auto-save at 300ms.
## 3. BUILD PROCESS
The standard build is a **single-file build** that gets committed and served directly.
```bash
tsc --project tsconfig.build.json   # Transpile JSX → h() calls via TypeScript
node build_single.cjs               # Concatenate + inline into index.html

```
 * **Artifact Rule**: **index.html** is an automated output. Never edit it manually.
 * **Build Script Updates**: When adding new source files:
   - **Engine/State files** → Add to `sourceFiles` array in `build_single.cjs`
   - **UI screens** → Add to `sourceFiles` array in `build_single.cjs`
   - **JSON data files** → Add to `readSrc()` call AND inline data section in `build_single.cjs`
## 4. WORKFLOW (Claude Code)
 1. Make source changes in src/.
 2. Rebuild: tsc --project tsconfig.build.json && node build_single.cjs.
 3. Commit source and rebuilt index.html together.
## 5. XP & LEVELING
 * **Progression**: 1–99.
 * **XP Formula**: totalXP(L) = floor(sum(x=1 to L-1) of floor(x + 300 * 2^(x/7)) / 4).
 * **Caps**: 200M XP limit.
 * **Start**: Level 10 HP start (1,154 XP).
 * **Gains**:
   * **Combat**: 4 XP/dmg to primary skill, 1.33 XP/dmg to HP.
   * **Magic**: Base spell XP + 2 XP/dmg.
## 6. COMBAT ENGINE (Per Tick)
 * **Tick**: 600ms engine cycle. Actions like attacking or eating consume ticks.
 * **Melee Max Hit**: base = floor(0.5 + effectiveStr * (bonus + 64) / 640).
 * **Accuracy Logic**:
   * maxRoll = effectiveLevel * (bonus + 64).
   * If attackRoll > defRoll: acc = 1 - (defRoll + 2) / (2 * (attackRoll + 1)).
   * Else: acc = attackRoll / (2 * (defRoll + 1)).
 * **Styles**: Accurate (Attack), Aggressive (Str), and Defensive (Def) give +3 to the relevant effective level; Controlled gives +1 to all.
 * **Auto-fight**: Combat restarts after 1.2s delay following a kill.
 * **Dragonfire**: 33% proc chance with 50 max damage. Fully blocked by items with otherBonus.antiDragon: true.
## 7. SKILLING & RESOURCES
 * **Gathering**: No level requirement for basic tasks.
 * **Skilling**: Requires specific levels; uses a Picker → Action → Modal flow with a progress bar.
## 8. IDLE MECHANICS
 * **Regen**: +1 HP every 60s.
 * **Auto-Bank**: Triggered on full inventory. Delay scales linearly from 5 minutes at Level 1 Agility down to 10 seconds at Level 99.
## 9. INVENTORY & BANKING
 * **Inventory Cap**: Hard limit of 28 slots.
 * **Withdraw as Note**: Sets noted: true. Noted items stack but cannot be equipped or eaten.
 * **Equipment**: Equipping a shield clears 2H weapons and vice-versa.
 * **UX**: Dropping items is silent with no toast notification.
## 10. DATA SCHEMAS
 * **Items**: Located in src/data/items.json.
 * **Monsters**: Located in src/data/monsters.json.
## 11. KEY INVARIANTS
 * **Rounding**: Always use Math.floor().
 * **UI**: 44×44px minimum tap targets. Fixed Header/Footer with a scrollable body.
 * **Styles**: Tailwind CDN is used; do not use /N opacity modifiers. Use solid CSS variables.
## 12. TEST SUITE
 * **Command**: Run npm test for the Vitest suite.
 * **File**: pocketrpg_test.ts covers core logic only. Avoid UI testing.
 * **Requirement**: All tests must pass (green) before committing changes.

---

## 13. MONSTERS (OSRS-Sourced, as of v1.4)

All monster stats sourced from OSRS Wiki. New monsters added in v1.4 session.

### Existing Monsters
| Monster       | CB | HP | Atk | Str | Def | Max Hit | Style  |
|---------------|----|----|-----|-----|-----|---------|--------|
| Chicken       | 1  | 3  | 1   | 1   | 1   | 1       | Crush  |
| Goblin        | 5  | 5  | 1   | 1   | 1   | 1       | Crush  |
| Cow           | 8  | 8  | 1   | 1   | 1   | 1       | Crush  |
| Giant Spider  | 27 | 26 | 17  | 18  | 14  | 3       | Stab   |
| Lesser Demon  | 82 | 79 | 68  | 67  | 71  | 8       | Crush  |

### New Monsters (v1.4)
| Monster       | CB  | HP  | Atk | Str | Def | Max Hit | Style  | Notes                                       |
|---------------|-----|-----|-----|-----|-----|---------|--------|---------------------------------------------|
| Rock Crab     | 13  | 50  | 1   | 1   | 1   | 1       | Crush  | High HP, low def. Classic training monster. |
| Sand Crab     | 15  | 60  | 1   | 1   | 1   | 1       | Crush  | Slightly more HP than Rock Crab.            |
| Hill Giant    | 28  | 35  | 18  | 22  | 26  | 4       | Crush  | Always drops Big Bones + Limpwurt Root.     |
| Moss Giant    | 42  | 60  | 30  | 38  | 0   | 6       | Crush  | Zero defence vs all styles.                 |
| Wizard        | 9   | 17  | 1   | 1   | 1   | 4       | Magic  | Drops elemental runes + wizard clothing.    |
| Dark Wizard   | 20  | 24  | 1   | 1   | 1   | 6       | Magic  | Higher runes + staffs. Drops blood runes.   |
| Abyssal Demon | 124 | 150 | 97  | 67  | 135 | 8       | Slash  | 1/512 abyssal whip. High-level slayer.      |
| Green Dragon  | 79  | 75  | 68  | 68  | 68  | 8+50df  | Slash  | Dragonfire: 50 dmg. Blocked by anti-dragon. Always drops Dragon Bones + Green Dragonhide. |

### Dragonfire Mechanic
- Green Dragon has `"specialAttack": "dragonfire"` in monsters.json.
- Each monster attack tick: 33% chance to use dragonfire (50 max damage), 67% normal melee.
- If player has `anti_dragon_shield` equipped (shield slot, `otherBonus.antiDragon: true`), dragonfire is **fully blocked** (0 damage).
- Combat log shows orange "🔥 Dragon breathes fire" on dragonfire hit, "🛡️ blocked" when shield active.
- Anti-dragon shield sold in Armour Shop for 800gp.

### New Items Added (v1.4)
| Item                | Type    | Key Stat               | Shop Value |
|---------------------|---------|------------------------|------------|
| Big Bones           | Resource| Prayer resource        | 200gp      |
| Dragon Bones        | Resource| Prayer resource        | 2200gp     |
| Green Dragonhide    | Resource| Crafting material      | 1500gp     |
| Blood Rune          | Resource| Stackable rune         | 300gp      |
| Soul Rune           | Resource| Stackable rune         | 250gp      |
| Limpwurt Root       | Resource| Herblore ingredient    | 400gp      |
| Anti-dragon Shield  | Shield  | antiDragon:true flag   | 800gp      |
| Abyssal Whip        | Weapon  | +82 slash, +82 str     | 1,500,000gp |
| Black Wizard Hat    | Head    | +4 magic atk/def       | 10gp       |
| Black Wizard Robe   | Body    | +12 magic atk          | 25gp       |

### Drop Table Notes
When checking OSRS Wiki drop tables for future monsters:
- Always check for "always" drops (chance: 1.0), "common" (0.3-0.5), "uncommon" (0.1-0.2), "rare" (0.01-0.05), "very rare" (<0.01).
- Add any missing items to `items.json` before adding them to the monster drop table.
- Stackable drops (runes, coins, arrows) use `[min, max]` array for quantity.
- Non-stackable equipment drops use single `quantity: 1`.

---

## 14. SPECIAL ATTACKS (as of v1.5)

### Mechanic
- The special attack bar is a **0–100% energy bar** stored in `combatState.specialAttackEnergy`.
- Bar starts at **0** on the first fight; **regenerates to 100% on every monster kill**.
- The player manually fires the special by pressing the **⚡ Special Attack** button in the combat screen.
- Each use drains the weapon's defined `energyCost`. Multiple uses are possible if enough energy remains (e.g. Dragon Dagger at 25% cost = 4 uses per kill).
- Specs do **not** fire during idle/offline simulation — manual only.

### Weapon Special Attacks Implemented
| Weapon              | Type           | Cost | Effect |
|---------------------|----------------|------|--------|
| Dragon Dagger       | `double_hit`   | 25%  | Two hits, each up to 115% max hit |
| Dragon Scimitar     | `zero_defence` | 55%  | Rolls against zero monster defence |
| Abyssal Whip        | `stun`         | 50%  | Hit + stun monster 1 attack cycle on connect |
| Bandos Godsword     | `warstrike`    | 50%  | Hit + reduce all monster defenceBonus by damage dealt |
| Armadyl Godsword    | `judgement`    | 50%  | 125% accuracy + 125% max hit |
| Saradomin Godsword  | `healing_blade`| 50%  | Hit + heal max(10, damage/2) HP |
| Zamorak Godsword    | `freeze`       | 50%  | Hit + freeze monster for 33 ticks (~20s) |
| Saradomin Sword     | `lightning`    | 100% | Melee hit + 1–16 guaranteed magic hit |
| Magic Shortbow      | `snapshot`     | 55%  | Two ranged hits at 75% max hit each |
| Armadyl Crossbow    | `pebble_shot`  | 40%  | Guaranteed hit at 125% max hit |
| Zamorak Spear       | `shove`        | 25%  | 175% accuracy + stun monster 2 attack cycles |

### Adding New Weapons
When adding a new weapon from OSRS, **always check if it has a special attack on the OSRS Wiki**. If it does:
1. Ask the user how they want to adapt the special for PocketRPG (since some OSRS specs are PvP-only or require mechanics we don't have).
2. Reference the table above for how existing specs are structured.
3. Add a `"specialAttack"` object to the weapon in `items.json`:
   ```json
   "specialAttack": {
     "type": "your_type",
     "energyCost": 50,
     "description": "Short flavour description shown in item modal."
   }
   ```
4. Add a `case 'your_type':` block in `applySpecialAttack()` in `src/engine/combat.js`.
5. Add a label entry in the `specLabels` map in `CombatScreen.jsx → handleSpecialAttack`.

### Data Schema
```json
"specialAttack": {
  "type": "string (matches case in applySpecialAttack)",
  "energyCost": 25,
  "description": "Player-facing description shown in item modal ⚡ panel.",
  // optional extras used by the engine:
  "stunTicks": 33,    // for freeze/stun types
  "minHeal": 10,      // for healing_blade
  "lightningMax": 16  // for lightning
}
```
