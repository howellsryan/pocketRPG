# Prompt: Add 10 New Low-Tier Bosses with Unique Drops & New Special Attacks

> Paste everything below the line into a fresh Claude Code session at the repo root.
> It is self-contained: it carries the schemas, the design constraints, and the
> commit gate so the implementer doesn't have to rediscover them.

---

## Task

Add **10 new bosses** to PocketRPG. They are **low-tier combat bosses (combat level ~80–160)**,
each using a clear, basic combat style wired into the combat triangle (melee / ranged / magic,
with melee further split into stab / slash / crush). Each boss drops **new unique gear** that sits
**just below the existing level-70 `isBossUnique` tier** — i.e. **~level 60 requirements**, clearly
stronger than runeforged / magic shortbow / red dragonhide / mystic / battlestaves, and roughly on
par with (or a touch above) dragon weapons, rune crossbow, and black dragonhide.

Organize the 10 bosses into **3–4 new themed areas** inside the Combat screen, matching the existing
area approach. **3–4 of the bosses** must drop a weapon with a **brand-new special attack** (new
`type`, new behavior, new icon/label). **No slayer requirements** on any of the new bosses — all
must be freely accessible.

Follow `CLAUDE.md` exactly (it overrides defaults). Highlights that apply here:
- Item `name` fields use **Title Case**.
- Maintain PocketRPG-owned fantasy naming (no real-world/OSRS brand names — invent in-world names).
- Use `Math.floor()` for any gameplay rounding.
- Stackables (coins/runes/arrows) use `quantity: [min, max]`; non-stackable equipment uses `quantity: 1`.
- Every referenced drop item must exist in `items.json` before it's referenced in a drop table.
- Collection log upkeep is mandatory in the same change (see step 5) plus a regression test.
- Do **not** commit `index.html` (it's a build artifact); generate it via `npm run rebuild` but leave it out of the commit.

---

## Files you will touch

| File | What changes |
|---|---|
| `src/data/monsters.json` | 10 new boss entries |
| `src/data/items.json` | All new unique drop items (weapons/armour) + any new generic drops you reference |
| `src/screens/CombatScreen.jsx` | New `COMBAT_CATEGORIES` entries (3–4 areas), new `MONSTER_ICONS`, and any new `specLabels` |
| `src/engine/combat.js` | New `specialAttack` `type` handlers inside `applySpecialAttack()` |
| `src/data/collectionLog.json` | A section per new boss listing its unique items |
| `tests/**/*.test.ts` | Regression tests (see step 6) |

---

## Schemas (authoritative — copy these shapes)

### Boss entry — `src/data/monsters.json`
```json
{
  "frostmaw_sentinel": {
    "id": "frostmaw_sentinel",
    "name": "Frostmaw Sentinel",
    "boss": true,
    "combatLevel": 120,
    "hitpoints": 90,
    "stats": { "attack": 70, "strength": 75, "defence": 65, "magic": 1, "ranged": 1 },
    "attackSpeed": 4,
    "attackStyle": "crush",
    "attackBonus": 55,
    "strengthBonus": 0,
    "defenceBonus": { "stab": 30, "slash": 28, "crush": 20, "magic": 45, "ranged": 35 },
    "drops": [
      { "itemId": "big_bones", "quantity": 1, "chance": 1 },
      { "itemId": "coins", "quantity": [400, 1200], "chance": 0.9 },
      { "itemId": "frostmaw_maul", "quantity": 1, "chance": 0.004 }
    ]
  }
}
```
- `attackStyle`: one of `stab | slash | crush | ranged | magic`.
- `defenceBonus` keys: `stab, slash, crush, magic, ranged`. **Bake the combat triangle in**: a melee
  boss should have low melee defence relative to magic, a ranged boss weak to magic, a magic boss
  weak to ranged, etc., so the player's style choice matters.
- **No `slayerRequirement` field** on any new boss.
- Keep `combatLevel` in the ~80–160 band; stats scale accordingly (low end ~50–65, high end ~80–95).

### Unique equipment — `src/data/items.json`
Weapon (with special attack):
```json
{
  "frostmaw_maul": {
    "id": "frostmaw_maul",
    "name": "Frostmaw Maul",
    "type": "weapon",
    "slot": "weapon",
    "twoHanded": true,
    "stackable": false,
    "attackSpeed": 6,
    "attackStyle": "crush",
    "attackBonus": { "stab": 0, "slash": 0, "crush": 78, "magic": 0, "ranged": 0 },
    "defenceBonus": { "stab": 0, "slash": 0, "crush": 0, "magic": 0, "ranged": 0 },
    "otherBonus": { "meleeStrength": 88, "rangedStrength": 0, "magicDamage": 0 },
    "requirements": { "attack": 60 },
    "specialAttack": {
      "type": "rime_shatter",
      "energyCost": 50,
      "description": "Rime Shatter: 150% max hit; chills the target, lowering its accuracy for 2 attacks."
    },
    "shopValue": 600000,
    "icon": "🧊",
    "isGeneralStore": false,
    "isBossUnique": true
  }
}
```
Armour:
```json
{
  "frostmaw_helm": {
    "id": "frostmaw_helm",
    "name": "Frostmaw Helm",
    "type": "armour",
    "slot": "head",
    "stackable": false,
    "attackBonus": { "stab": 0, "slash": 0, "crush": 0, "magic": 0, "ranged": 0 },
    "defenceBonus": { "stab": 35, "slash": 38, "crush": 40, "magic": 8, "ranged": 36 },
    "otherBonus": { "meleeStrength": 3, "rangedStrength": 0, "magicDamage": 0 },
    "requirements": { "defence": 60 },
    "shopValue": 220000,
    "icon": "⛑️",
    "isGeneralStore": false,
    "isBossUnique": true
  }
}
```
- `slot` values in use: `weapon, head, body, legs, shield, hands, feet, cape, ring, ammo` (match
  existing items in `items.json` — verify before inventing a slot).
- `requirements`: gate on the relevant skill (`attack`/`strength`/`defence`/`ranged`/`magic`),
  target **~60** for this tier.
- Set `isBossUnique: true`, `isGeneralStore: false`.
- All `icon` fields are emoji — pick distinct, thematic emoji for each item and boss.

### Special attack handler — `src/engine/combat.js`
Add a new `case` (or branch) per new `type` inside `applySpecialAttack()`. Existing types you can
mirror for structure/return shape: `double_hit, zero_defence, stun, judgement, healing_blade,
freeze, warstrike, smash, lightning, snapshot, pebble_shot, toxic_siphon, shove, slice_and_dice,
lunge, triple_hit, descent_of_darkness`. Reuse helpers from `src/utils/helpers.js`; keep top-level
identifiers globally unique (single-file build requirement). Honor PvE special-energy rules from
`CLAUDE.md §7` (starts at 100, drains on use, refills on kill, manual trigger only).

### Combat screen — `src/screens/CombatScreen.jsx`
- Add 3–4 entries to `COMBAT_CATEGORIES`:
  ```js
  { key: 'frozen_reaches', label: 'Frozen Reaches', icon: '❄️', ids: ['frostmaw_sentinel', '...'] }
  ```
- Add each new boss id → emoji in `MONSTER_ICONS`.
- Add a `specLabels` entry for each new special `type`, e.g. `rime_shatter: '🧊 Rime Shatter'`.

### Collection log — `src/data/collectionLog.json`
Add a section under the `monsters` category for **each** new boss:
```json
{ "id": "frostmaw_sentinel", "label": "Frostmaw Sentinel", "icon": "❄️",
  "items": ["frostmaw_maul", "frostmaw_helm", "frostmaw_body"] }
```

---

## Design requirements (must all hold)

1. **10 bosses**, combat level ~80–160, no slayer requirement, freely accessible.
2. **Combat-triangle coverage**: across the 10, include melee (stab/slash/crush), ranged, and magic
   attackers. Give each a meaningful style + a defence profile with an exploitable weakness.
3. **3–4 themed areas** in `COMBAT_CATEGORIES`, grouping the 10 bosses thematically (biome/faction).
4. **Unique drops per boss**: 3–4 uniques each (a weapon and/or armour pieces). All uniques are
   **new** items added to `items.json` with full stats, `requirements` (~60), accurate `shopValue`,
   and emoji `icon`. Power level: above runeforged / magic shortbow / red dhide / mystic /
   battlestaff; around dragon / rune crossbow / black dhide, maybe slightly higher; **below** the
   existing level-70 `isBossUnique` gear.
5. **`shopValue` accuracy**: scale value with the item's power and rarity, consistent with existing
   items of similar tier (e.g. dragon/black-dhide-class gear). Rarer/stronger = higher value.
6. **3–4 new special attacks**: distinct new `type` + behavior in `applySpecialAttack()`, a new
   `specLabels` entry, and a fresh emoji icon. Make them flavorful but balanced for this tier.
7. **Drop tables**: always-on `big_bones`/`bones` + `coins` (`[min,max]`), plus uniques at low
   chances (~0.002–0.01). Every `itemId` referenced must already exist in `items.json`.

---

## Steps

1. Read `src/data/monsters.json`, `src/data/items.json`, `src/screens/CombatScreen.jsx`,
   `src/engine/combat.js`, and `src/data/collectionLog.json` to confirm current conventions and the
   exact stat ceiling of nearby gear (dragon / rune crossbow / black dhide). Match their style.
2. Add the 10 boss entries to `monsters.json`.
3. Add all new unique items (and any new generic drops) to `items.json` — Title Case names, ~60 reqs,
   accurate `shopValue`, distinct emoji icons.
4. Wire the Combat screen: 3–4 `COMBAT_CATEGORIES`, `MONSTER_ICONS`, and `specLabels`.
5. Implement the 3–4 new special-attack `type`s in `applySpecialAttack()`.
6. Add `collectionLog.json` sections for each boss and a regression test that asserts every new boss
   unique appears in the collection log and that every drop `itemId` resolves to a real item.
7. Run the **commit gate** (required, do not commit on failure):
   `npm test && npm run build && npm run rebuild && npm run check:single`
   (or `npm run ci && npm test`).
8. Do **not** stage `index.html`. Commit the `src/**`, data, and test changes with a clear message.
9. Work on branch `claude/new-combat-bosses-design-X4RUo` (create locally if needed) and push with
   `git push -u origin claude/new-combat-bosses-design-X4RUo`. Do **not** open a PR unless asked.

## Acceptance checklist
- [ ] 10 bosses, CB ~80–160, zero slayer requirements, all reachable.
- [ ] Combat triangle represented (melee/ranged/magic) with exploitable defence weaknesses.
- [ ] 3–4 new themed combat areas; every new boss has a `MONSTER_ICONS` emoji.
- [ ] 3–4 unique drops per boss; all new items in `items.json` with ~60 reqs, accurate `shopValue`, emoji icons, `isBossUnique: true`.
- [ ] Gear power sits above mid-tier (runeforged/msb/red dhide/mystic), ~dragon/rune cbow/black dhide, below existing lvl-70 boss uniques.
- [ ] 3–4 new special attacks: new `type` + handler + `specLabels` + icon, balanced for tier.
- [ ] Collection log section per boss + regression test passing.
- [ ] Commit gate green; `index.html` not committed; pushed to the designated branch; no PR unless requested.
