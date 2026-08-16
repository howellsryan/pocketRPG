---
name: action-animation
description: Use when adding or changing an on-screen animation for a player action - a combat swing, a mining strike, a fishing cast, a smithing hammer blow - or when editing src/utils/actionSprites.js, src/components/ActionSpriteStage.jsx, or the .as-* CSS. Covers the timing law (an animation's speed IS the action's own cadence), the glyph-as-sprite model, the event-to-swing contract, and the build/reduced-motion gates. Do not use for the open world's 3D entity clips (world/client, GLB rigs, combat wind-up alignment) or for procedural 3D creature specs - those are procgen-creature and .claude/rules/world-design.md.
---

# action-animation: showing the player their action

Design record and rationale: `docs/action-animations.md`. This is the checklist.

The system is deliberately small: one pure module, one component, one CSS block. If a
change wants a second timing source, a second stage component, or a per-screen
duration, it is going the wrong way — the whole value is that 23 skills share one law.

## The law — non-negotiable

**An animation's speed is the action's own cadence.** Never a constant, never a
literal in CSS.

```js
const cycleMs = actionCycleMs(ticks)        // the action's tick cost × 600ms
const swingMs = swingDurationMs(cycleMs)    // the motion inside that cadence
```

Both from `src/utils/actionSprites.js`. The duration reaches CSS only as the inline
`--as-dur` custom property. A hard-coded `animation: x 400ms` anywhere in `.as-*` is
the failure this system exists to prevent — a player who buys a faster tool must see
it.

`swingDurationMs` is a shallow slope off a fixed base, **not** a percentage of the
cycle. A percentage was built and rejected: it hit the upper clamp at 3 ticks, so
every weapon from a scimitar up animated identically. If a new action's cadence binds
`SWING_MAX_MS`, **re-tune the slope** — do not let the clamp flatten two different
cadences onto one duration. `tests/actionSprites.test.ts` asserts strict monotonicity
across the shipped range and will fail if you do.

## Adding an animation for a new action

1. **Pick a glyph, don't commission art.** The sprite is a `src/data/gameIcons.json`
   key (193 vendored, `pickaxe` / `wood_axe` / `fishing_pole` / `anvil` / `sewing_needle`
   and so on). Verify the key exists before using it — a missing key renders *nothing*,
   silently, because `SkillEmblem` returns null.

2. **Add a row to `ACTION_SPRITES`** (`src/utils/actionSprites.js`):
   `{ motion, tool, projectile, label }`. `projectile` is `null` for anything that
   connects in contact range.

3. **Add the keyframe family** to `src/index.css` as `.as-tool--<motion>` (and
   `.as-mark--<motion>` if the target acts back). Every duration is `var(--as-dur)`.
   Put it inside the existing `@media (prefers-reduced-motion: no-preference)` block —
   DESIGN.md §5 requires a reduced-motion alternative, and the stage is designed to
   read as a posed tableau with motion off.

4. **Resolve the cadence from the action itself** — the skilling action's tick cost,
   the weapon's `attackSpeed`. Not a screen constant, not a guess.

5. **Map events to swing tokens.** Follow `swingsFromCombatEvents`: return
   `{ id, side, hit }`, a fresh `id` per occurrence. The renderer keys on `id`, so a
   boolean animates the first action and nothing after it.

6. **Render `<ActionSpriteStage>`.** For skilling this most likely belongs in
   `SkillActivePanel` — one component behind most idle skilling screens, so a stage
   there covers many skills at once. Check screens that pass their own `icon`
   override before assuming uniformity.

7. **Register in `build_single.cjs`** (§12) — any new file into `sourceFiles`, and
   into `GAME_CHUNK_FILES` if it is in-game only. `gameIcons.json` is chunk-only, so a
   stage on a boot-reachable screen needs the `typeof` guard re-checked.

8. **Test in the same change** (`tests/actionSprites.test.ts`): the new mapping, and
   that the glyph key it names actually exists in `gameIcons.json`.

## Traps, each one paid for

- **A miss is still a swing**, and so is a *blocked* one. The motion happened; only
  the damage is 0. combat.js emits `immuneHit` instead of `playerHit` against an
  immune form and still resets the timer, so omitting it makes a whole immune phase
  read as the player doing nothing. `hit` gates the target's recoil, never the
  attacker's motion.
- **A multi-hit special is ONE swing.** These are membership tests over a tick's
  events, never counters.
- **A token stays set after its motion ends.** So each motion needs its own keyed
  element: sharing one element means sharing one key, and the key changing for either
  reason replays both. That is how the monster came to perform its whole attack on
  every player swing.
- **Match an incoming swing to the entity the stage is drawing.** A boss and its adds
  swing through the same events, separated only by `fromAdd`, while the stage follows
  whichever enemy the player targets — read unfiltered, the boss's swing animates on
  the add's mark at the add's speed.
- **Stance is part of the cadence.** combat.js takes a tick off a ranged swing on
  Rapid — the stance players pick *specifically* to be faster.
- **Read a multi-form boss's CURRENT FORM**, never its top-level `attackStyle` — the
  bug CLAUDE.md §4 records for the world, which left Zaryth permanently ranged.
- **Co-op: only the viewer's own swings move the stage.** Every member's events ride
  one shared ring tagged by `characterId` (§20); the boss's incoming motion is gated
  on `isTarget` as well, or a full room lunges eight times a tick.
- **Reset tokens between actions.** Mounting with a stale token is a key change, so a
  new fight/action opens by replaying the last one's motion.
- **`.as-*` is not a `.cb-*` class.** It takes every colour from the semantic layer
  (`--surface-sunken`, `--hairline`, `--text-*`), so it is defined **once** and is
  exempt from the Two-Skin Trap (DESIGN.md §2). Adding a non-semantic colour means
  owing a second `.forge-shell` definition — reach for a token instead.

## Where this does not apply

The open world renders 3D entities from baked GLB clips with its own impact-frame
alignment (`src/utils/combatWindup.js`, `world/client/src/entities.ts`). Different
renderer, different problem. Do not wire `.as-*` into it, and do not "unify" the two
timing models — the wind-up system aligns a clip's *impact frame* onto a hit tick,
which is a stricter constraint than this one.
