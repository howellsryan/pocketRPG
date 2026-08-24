---
name: add-content
description: Use when adding or editing game content in src/data - items, drops, monsters, bosses, spells, prayers, world places, special attacks, collection-log slots. A checklist of authoring invariants that are easy to violate silently and only surface as runtime bugs or missing log slots.
---

# add-content: content authoring checklist

Static content lives in `src/data/*.json` and is **immutable at runtime**. Gameplay invariants live in `.claude/rules/gameplay-engine.md` (engine-wide) and CLAUDE.md §5–§6 (XP, tick model); this skill is the authoring workflow.

## Items & drops

- Before adding a drop, ensure every referenced item exists in `src/data/items.json`. A dangling item id fails at runtime, not build time.
- Item `name` fields use **Title Case** ("Bronze Dagger", "Oak Logs").
- Stackables (coins/runes/arrows): quantity `[min, max]`. Non-stackable equipment: `quantity: 1`.
- **Collection log**: a new boss/raid/minigame/clue unique needs the matching slot in `src/data/collectionLog.json` in the same change **+ a regression test**.
- High-value uniques (boss/raid/clue/minigame/dungeoneering) are granted server-side via `/api/actions/**` (§14) — adding one usually means touching the server loot table too, not just client data.

## Weapon special attacks

1. Confirm existing PocketRPG design + fantasy naming (PocketRPG-owned names, not OSRS's).
2. Confirm adaptation behavior with the user.
3. Add `specialAttack` to the item in `src/data/items.json`:

```json
"specialAttack": { "type": "string", "energyCost": 25, "description": "...", "stunTicks": 33, "minHeal": 10, "lightningMax": 16 }
```

4. Implement in `applySpecialAttack()` in `src/engine/combat.js`.
5. Add a `specLabels` entry in the combat screen.

PvE special energy (`combatState.specialAttackEnergy`) is 0–100: starts each fight at 100, drains on use, refills on kill. Manual trigger only — no automatic/offline firing. (PvP energy rules differ — `.claude/rules/pvp.md`.)

## Monsters & bosses

- Boss Slayer XP: `BOSS_SLAYER_TASK_XP_MULTIPLIER` (×4) in `src/engine/slayerRewards.js` — avoid inflated explicit `slayerXP` on bosses (keep XP/hr ≤ ~2× best regular monster).
- Dragonfire attackers: 33% proc, max 50, fully blocked by `otherBonus.antiDragon: true`.
- A `monsters` entry in `src/data/equipmentModels.json` auto-enables the 3D combat arena for that monster (§12; asset process in `docs/gear-asset-process.md`).

## After the change

- Update logic tests alongside new gameplay logic (§13).
- New/edited monster, boss, or raid → run `npm run check:drops -- <id>` and review the economy report (dangling items, chances, missing collection-log slots are hard errors; gp/hr and XP/hr estimates are for eyeballing vs tier peers). It is not part of the build gate.
- Player-visible mechanics/content change → update `docs/game-guide.md`, run `npm run gen:knowledge`, commit the regenerated index (chat rule).
- Run the §11 commit gate.
