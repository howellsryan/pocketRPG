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

## 3. XP & LEVELING
 * **Progression**: 1–99.
 * **XP Formula**: totalXP(L) = floor(sum(x=1 to L-1) of floor(x + 300 * 2^(x/7)) / 4).
 * **Caps**: 200M XP limit.
 * **Start**: Level 10 HP start (1,154 XP).
 * **Gains**:
   * **Combat**: 4 XP/dmg to primary skill, 1.33 XP/dmg to HP.
   * **Magic**: Base spell XP + 2 XP/dmg.
## 4. COMBAT ENGINE (Per Tick)
 * **Tick**: 600ms engine cycle. Actions like attacking or eating consume ticks.
 * **Melee Max Hit**: base = floor(0.5 + effectiveStr * (bonus + 64) / 640).
 * **Accuracy Logic**:
   * maxRoll = effectiveLevel * (bonus + 64).
   * If attackRoll > defRoll: acc = 1 - (defRoll + 2) / (2 * (attackRoll + 1)).
   * Else: acc = attackRoll / (2 * (defRoll + 1)).
 * **Styles**: Accurate (Attack), Aggressive (Str), and Defensive (Def) give +3 to the relevant effective level; Controlled gives +1 to all.
 * **Auto-fight**: Combat restarts after 1.2s delay following a kill.
 * **Dragonfire**: 33% proc chance with 50 max damage. Fully blocked by items with otherBonus.antiDragon: true.
## 5. SKILLING & RESOURCES
 * **Gathering**: No level requirement for basic tasks.
 * **Skilling**: Requires specific levels; uses a Picker → Action → Modal flow with a progress bar.
## 6. IDLE MECHANICS
 * **Regen**: +1 HP every 60s.
 * **Auto-Bank**: Triggered on full inventory. Delay scales linearly from 5 minutes at Level 1 Agility down to 10 seconds at Level 99.
## 7. INVENTORY & BANKING
 * **Inventory Cap**: Hard limit of 28 slots.
 * **Withdraw as Note**: Sets noted: true. Noted items stack but cannot be equipped or eaten.
## 8. DATA SCHEMAS (example below, ensure this is followed)
 * **Items**: Located in src/data/items.json.
 * **Monsters**: Located in src/data/monsters.json.
## 9. KEY INVARIANTS
 * **Rounding**: Always use Math.floor().
 * **UI**: 44×44px minimum tap targets. Fixed Header/Footer with a scrollable body.
 * **Styles**: Tailwind CDN is used; do not use /N opacity modifiers. Use solid CSS variables.
 * **Styling Rule**: Prefer Tailwind utility classes + CSS variables over inline `style={{}}`. See §15 for the shared component library and the inline-vs-utility decision rule.
## 10. TEST SUITE
 * **Command**: Run npm test for the Vitest suite.
 * **File**: pocketrpg_test.ts covers core logic only. Avoid UI testing.
 * **Requirement**: All tests must pass (green) before committing changes.

---

## 11. MONSTER DROP TABLE 

### Drop Table Notes
When checking OSRS Wiki drop tables for future monsters:
- Always check for "always" drops (chance: 1.0), "common" (0.3-0.5), "uncommon" (0.1-0.2), "rare" (0.01-0.05), "very rare" (<0.01).
- Add any missing items to `items.json` before adding them to the monster drop table.
- Stackable drops (runes, coins, arrows) use `[min, max]` array for quantity.
- Non-stackable equipment drops use single `quantity: 1`.

---

## 12. SPECIAL ATTACKS

### Mechanic
- The special attack bar is a **0–100% energy bar** stored in `combatState.specialAttackEnergy`.
- Bar starts at **0** on the first fight; **regenerates to 100% on every monster kill**.
- The player manually fires the special by pressing the **⚡ Special Attack** button in the combat screen.
- Each use drains the weapon's defined `energyCost`. Multiple uses are possible if enough energy remains (e.g. Dragon Dagger at 25% cost = 4 uses per kill).
- Specs do **not** fire during idle/offline simulation — manual only.

### Weapon Special Attacks Example
| Weapon              | Type           | Cost | Effect |
|---------------------|----------------|------|--------|
| Dragon Dagger       | `double_hit`   | 25%  | Two hits, each up to 115% max hit |

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

---

## 13. STYLING & SHARED COMPONENTS

### Design Decision: Utility Classes > Inline `style={{}}`

All reusable components **must** be built on Tailwind utility classes and the CSS variables defined in `index.html` (`--color-parchment`, `--color-gold`, `--color-void-light`, `--font-display`, etc.). Raw hex like `#111` or `#e8d5b0` should live in CSS variables, not component code.

#### When to use inline `style={{}}`
Only for values that are genuinely **dynamic per render**:
  - Animated or computed widths/heights (`width: ${pct}%`)
  - Colors interpolated from state (e.g. HP bar colour based on `hpPct`)
  - One-off gradient backgrounds that don't justify a CSS variable
  - Animation delays / durations tied to data

#### When to use Tailwind classes
Everything else — all static colours, borders, radii, padding, typography, flex/grid layout. If you catch yourself repeating the same `style={{}}` object in more than one screen, extract it to a shared component or a CSS variable.

### Shared Component Library (`src/components/`)

| Component | When to use |
|-----------|-------------|
| `Card`     | Outer surface panel (paperdoll, bonus summary, task rows). Dark background, rounded-xl, border. |
| `Panel`    | Inner surface inside a card or modal (item preview, price info, stat rows). Darker than Card. |
| `Button`   | Any clickable button. Variants: `primary` (gold), `secondary` (neutral), `danger` (red), `success` (green), `ghost`. Sizes: `sm`, `md`, `lg`. |
| `SectionHeader` | Small uppercase Cinzel label for section titles ("Bonuses", "Equipment", "Gather Resources"). Sizes: `sm`, `md`, `lg`. |
| `Modal`    | Full-screen modal with backdrop + header + scrollable body. |
| `ProgressBar` | Animated progress bar — `value`, `max`, `color`, optional `label`/`showText`. |
| `ItemSlot` | Inventory/bank slot with type-coloured border and quantity badge. |
| `HPBar`, `SkillBadge`, `Header`, `BottomNav`, `Toast` | Screen-specific fixtures. |

### Rules when adding new screens
1. **Reach for `Card` / `Panel` / `Button` / `SectionHeader` first.** Don't reinvent a dark-background-with-border container inline.
2. **Colours come from CSS variables.** Use `bg-[var(--color-void-light)]`, `text-[var(--color-gold)]`, `border-[var(--color-void-border)]` etc.
3. **If a pattern appears 3+ times, extract it.** Either a new shared component or a new CSS variable in `index.html`.
4. **New shared components must be registered in `build_single.cjs`** under `sourceFiles`, between the existing `components/*.js` entries and the screens.
5. **Button styling is never bespoke.** If you need a new variant (e.g. warning orange), add it to `Button.jsx`'s `VARIANTS` map rather than styling a raw `<button>`.
