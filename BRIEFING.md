# PocketRPG — Compact Briefing
**v1.3 | Status: Pre-MVP Prototype**

## 1. CORE CONCEPT
Menu-driven idle/simulation fantasy RPG. 0.6s tick-based engine. Text/icon/progress-bar UI. Mobile-first, offline-first (IndexedDB). No animations/pixel art.

## 2. TECH STACK & RULES
- **Stack:** Preact (UI), Vite (Build — when node_modules available), Tailwind v4 (Style), IndexedDB/idb (Storage).
- **Architecture:** `engine/` (pure logic, no UI), `screens/` (top-level), `state/` (Preact signals), `db/` (persistence).
- **Rules:** Engine has ZERO UI imports. Static JSON is immutable. State flows down, events flow up. Debounced auto-save (300ms).

## 3. BUILD PROCESS
Two build paths exist:

### A) Vite Build (requires node_modules)
```bash
npm install
npm run build
```
Produces `dist/` folder with optimized bundle.

### B) Single-File Build (no node_modules needed)
```bash
tsc --project tsconfig.build.json   # Transpile JSX → h() calls via TypeScript
node build_single.cjs               # Concatenate + inline into single HTML
```
Uses `tsc` (globally available) to transpile JSX with `jsxFactory: "h"` and `jsxFragmentFactory: "Fragment"` for Preact. The `build_single.cjs` script then:
1. Reads all transpiled `.js` files from `dist_tmp/` in dependency order
2. Strips import/export statements (everything is concatenated into one scope)
3. Inlines JSON data files (items, monsters, skills, spells)
4. Inlines CSS (minus Tailwind import — CDN script tag used instead)
5. Wraps in HTML with ESM CDN imports: `preact@10.25.4`, `preact/hooks`, `idb@8.0.2`
6. Fixes dynamic imports (e.g. `import('./database.js')` → uses global `getDB()`)
7. Outputs `/mnt/user-data/outputs/index.html`

**Key files:**
- `tsconfig.build.json` — TypeScript config for JSX transpilation
- `build_single.cjs` — Concatenation/inlining script (CommonJS, since package.json has `"type": "module"`)

## 4. MANDATORY DELIVERY (Non-Negotiable)
Every session MUST output all three files to `/mnt/user-data/outputs/`:
1. `index.html`: Single-file playable (ESM CDN imports, inline CSS/Logic, direct IndexedDB).
2. `pocketrpg_source.zip`: Full project (modular source, build scripts).
3. `pocketrpg_test.html`: Standalone test suite (see Section 12). **Must be updated every session** to cover any new features built.

### How to update `pocketrpg_test.html`
The test page lives at `/mnt/user-data/outputs/pocketrpg_test.html` and is delivered alongside the game each session. When adding new features:
- Read the existing file from the previous session's output before modifying — it is the source of truth for the test suite.
- Add new test groups at the bottom of `runAll()` following the existing `assert(name, condition, detail)` pattern.
- Add corresponding modal/visual previews in `renderModalPreview()` if the feature produces UI output.
- Re-inline any new engine functions added to `src/engine/` — the test page is fully self-contained with no build step.
- Update the `thresholds` array in `renderResults()` to reflect the new total assertion count per group.
- All tests must pass (green) before delivery. A failing test is a bug, not a known issue.

## 5. XP & LEVELING
- **Table:** 1–99. Formula: `totalXP(L) = floor(sum(x=1 to L-1) of floor(x + 300 * 2^(x/7)) / 4)`.
- **Caps:** 200M XP. Level 10 HP start (1,154 XP).
- **Combat XP:** 4 XP/dmg to primary skill, 1.33 XP/dmg to HP. Magic: Base + 2 XP/dmg.
- **Level up message:** `"Congratulations! Your {Skill} is now {level}"` with skill icon shown as the toast icon (no confetti).

## 6. COMBAT ENGINE (Per Tick)
- **Tick:** 600ms. Actions (attack, eat, drink) consume ticks.
- **Melee Max Hit:** `base = floor(0.5 + effectiveStr * (bonus + 64) / 640)`.
- **Accuracy:** `maxRoll = effectiveLevel * (bonus + 64)`. If attackRoll > defRoll: `acc = 1 - (defRoll + 2) / (2 * (attackRoll + 1))`. Else: `acc = attackRoll / (2 * (defRoll + 1))`.
- **Magic:** Acc uses 70% Magic + 30% Defence for target roll. Max hit is spell-based.
- **Styles:** Acc/Agg/Def/Longrange give +3 to relevant effective level; Controlled +1.
- **Loop:** 1. Decr timers → 2. Process player hit → 3. Process monster hit → 4. Death check → 5. Auto-eat/pot.
- **Auto-fight:** After slaying a monster, auto-restarts combat with same monster after 1.2s delay.

## 7. SKILLING & RESOURCES
- **Flow:** Picker → Action → Modal (Progress Bar).
- **Chains:**
  - Mining/Smithing: Tin/Cop (1) → Clay (1) → Iron (15) → Coal (30) → Gold (40) → Mith (55) → Addy (70) → Rune (85).
  - Smithing includes: Smelting bars (bronze→rune, gold bar at lv40).
  - Crafting includes: Molten glass (lv1), leather/gems/jewellery.
  - Wood/Fletch: Normal (1) → Oak (15) → Willow (30) → Maple (45) → Yew (60) → Magic (75).
  - Fish/Cook: Shrimp (3HP, lv1) → Trout (7HP, lv20) → Lob (12HP, lv40) → Sword (14HP, lv50) → Shark (20HP, lv76).
- **Gather tasks** (no level required): Pick flax, collect sand/seaweed, soften clay, pick wheat, grind flour, tan leather, burn seaweed.

## 8. IDLE MECHANICS
- **HP Regen:** +1 HP every 60 seconds (100 ticks), automatic.
- **Auto-Bank:** When inventory is full, auto-deposits all items to bank after a delay. Delay scales with Agility level: 120s at lv1, linearly down to 10s at lv99.
- **Home Screen shortcuts:** Can add specific combat monsters, skill actions, and gather tasks. Clicking goes directly to that action (auto-starts fight/skill/gather).

## 9. INVENTORY & BANKING
- **Deposit:** Done from Inventory screen. Click item → modal with Bank 1/5/10/All. Stackable items bank entire stack. Non-stackable counts same items across inventory.
- **Withdraw:** Done from Bank screen. Click item → Take 1/5/10/All.
- **Withdraw as Note:** Non-stackable items can be withdrawn as "noted" from the bank. Noted items stack like stackable items but cannot be equipped or eaten — only sold, dropped, or deposited back to bank. Noted slots carry a `noted: true` flag in the inventory slot object. The 📜 icon is shown on noted items.
- **Selling:** Items can be sold from inventory modal. Prices stored as `shopValue` in items.json.
- **No drop toast** — dropping items is silent.
- **Equipment Screen:** Paperdoll layout showing all 11 equipment slots (head, cape, neck, ammo, weapon, body, shield, legs, gloves, boots, ring) with attack/defence/other bonus summary. Tap equipped item to unequip.

## 10. DATA SCHEMAS
- **Items:** `{ id, name, type, slot, stackable, shopValue, attackBonus:{}, defenceBonus:{}, otherBonus:{} }`
- **Monsters:** `{ id, name, combatLevel, hitpoints, stats:{}, attackSpeed, drops:[{itemId, quantity, chance}] }`

## 11. KEY INVARIANTS
- **Rounding:** Always `Math.floor()`.
- **Inventory:** Hard cap 28 slots. Check before adding.
- **2H/Shield:** Equipping shield clears 2H weapon; vice versa.
- **Ticks:** Handle backgrounding by pausing or batch-catching ticks.
- **UI:** Minimum 44×44px tap targets. Fixed Header/Footer with scrollable body.
- **Icons:** Same emoji icons used in both Bank and Inventory screens (TYPE_EMOJIS map).
- **Tailwind CDN:** No `/N` opacity modifiers (e.g. `bg-[var(--x)]/70` won't work). Use solid CSS vars instead (e.g. `--color-emerald-mid`).

## 12. TEST SUITE (`pocketrpg_test.html`)
A standalone, no-build-required HTML test page. Open in any browser — no server needed.

### Structure
```
runAll()
  ├── XP & Leveling             (17 assertions)
  ├── Combat Formulas            (13 assertions)
  ├── Equipment Bonuses          (8 assertions)
  ├── Inventory                  (10 assertions)
  ├── formatIdleTime             (10 assertions)
  ├── simulateIdleSkilling       (8 assertions)
  ├── simulateIdleGather         (7 assertions)
  ├── simulateIdleCombat/chickens (12 assertions)
  ├── simulateIdleCombat/aggressive (3 assertions)
  ├── simulateIdleCombat/full-inv (3 assertions)
  ├── simulateIdleCombat/weapon  (2 assertions)
  ├── simulateIdleCombat/highstats (1 assertion)
  ├── Combat Level               (3 assertions)
  ├── FNV-1a Hash                (5 assertions)
  ├── localStorage Backup        (12 assertions)
  ├── Idle Edge Cases            (8 assertions)
  ├── Auto-bank Delay            (5 assertions)
  ├── XP Table Integrity         (3 assertions)
  ├── Stackable Items            (5 assertions)
  ├── simulateIdleCombat/cows    (3 assertions)
  ├── End-to-end Idle Flow       (6 assertions)
  ├── canPerformAction + Bank    (5 assertions)
  ├── Idle Skilling Materials    (15 assertions)
  └── Noted Items                (9 assertions)

renderResults()   — renders pass/fail badges per group
renderModalPreview() — renders real modal UI from simulation output
```

### assert() signature
```js
assert(name: string, condition: boolean, detail?: string)
```
`detail` appears as a subtitle under the test — use it for expected vs actual values.

### Adding a new test group
1. Add assertions inside `runAll()` with a comment block `// ── GROUP N: feature name ──`
2. Add the group name as a new key in the `groups` object in `renderResults()`
3. Add its threshold (cumulative assertion count up to and including this group) to the `thresholds` array
4. If the feature has UI output (a modal, a screen), add a preview card in `renderModalPreview()`

### What to test for each new feature
- **New engine function:** unit test inputs/outputs, edge cases (null, zero, boundary values)
- **New skilling action:** correct XP per action, correct product, correct tick count
- **New monster:** DPS calculation, drop table rolls, loot gained/lost split
- **New screen/UI:** no assertions needed in test page — verify via game directly
- **New DB setting:** add an IDB round-trip test reading/writing the new key

### Inlining engine functions
The test page inlines all pure engine functions. When a new file is added to `src/engine/`:
1. Copy the function body into the `// INLINED ENGINE` block in `idle_test.html`
2. Remove import/export keywords — everything is in one global scope
3. Ensure any constants it depends on are also present in the `// CONSTANTS` block

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
