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
