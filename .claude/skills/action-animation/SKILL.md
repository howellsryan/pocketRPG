---
name: action-animation
description: Use when adding or changing an on-screen animation for a player action - a combat swing, a mining strike, a fishing cast, a smithing hammer blow - or when editing src/utils/actionSprites.js, src/utils/inkwright.js, ActionSpriteStage.jsx, InkwrightStage.jsx, or the .as-* / .ink-* CSS. Covers the two stages and when to use each, the timing law (an animation's speed IS the action's own cadence), why skilling scales strike COUNT instead of tempo, the event-to-swing contract, and the build/reduced-motion gates. Do not use for the open world's 3D entity clips (world/client, GLB rigs, combat wind-up alignment) or for procedural 3D creature specs - those are procgen-creature and .claude/rules/world-design.md.
---

# action-animation: showing the player their action

Design record, rationale and rollout state: `docs/action-animations.md`. This is the
checklist.

**One law, two stages.** Pick by what the player is doing:

| | `ActionSpriteStage` (`.as-*`) | `InkwrightStage` (`.ink-*`) |
|---|---|---|
| Shape | actor's tool → lane → target's mark | a figure working a resource |
| Sprite | masked `gameIcons.json` glyph | drawn inked-vector figure + tool |
| Cadence | one cycle = one swing | one action = several strikes, one yield |
| Wired | solo combat, co-op/raid | mining, woodcutting, fishing |

Fighting something that fights back → the lane. Working something that gives way →
the figure. A new skill almost always wants Inkwright.

These are two PRESENTATIONS, not two timing systems. Both take their cadence from
`actionCycleMs`. A change that wants a **third timing source** or a per-screen
duration is going the wrong way — the whole value is that 23 skills share one law.

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

6. **Render the stage.** For skilling that is `<InkwrightStage>`, built in the
   CHUNKED screen and passed into `SkillActivePanel` as its `stage` prop — the panel
   is core and these modules are chunk-only, so importing them there is a core→chunk
   read at module eval (§12). One component sits behind most idle skilling screens,
   so a stage there covers many skills at once; check screens that pass their own
   `icon` override before assuming uniformity (`GatherScreen` does).

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
- **`.as-*` and `.ink-*` are not `.cb-*` classes.** It takes every colour from the semantic layer
  (`--surface-sunken`, `--hairline`, `--text-*`), so it is defined **once** and is
  exempt from the Two-Skin Trap (DESIGN.md §2). Adding a non-semantic colour means
  owing a second `.forge-shell` definition — reach for a token instead.

## Adding a skill to Inkwright

The common case, and cheaper than the list above — no event plumbing at all, because
the stage reads a clock and a completion counter.

1. **Add a motion row** to `INKWRIGHT_MOTIONS` (`src/utils/inkwright.js`) and map the
   skill in `SKILL_MOTIONS`. A row with no keyframes renders a figure standing still.
2. **Add the keyframe family** to `src/index.css`: `.ink-fig--<motion> .ink-arm` for
   the strike, `.ink-payoff--<motion>` for the yield. Inside the existing
   `prefers-reduced-motion: no-preference` block. Every duration is `var(--ink-strike)`
   or `var(--ink-payoff)` — a literal ms is the failure this system prevents.
3. **Draw the tool** in `Tool()` and the resource in `Prop()`, whole AND broken. The
   broken form is the same silhouette split up, so the two cannot drift apart.
4. **Register** both modules in `build_single.cjs` — `sourceFiles` AND
   `GAME_CHUNK_FILES` (§12). `inkwright.js` must come after `actionSprites.js`.
5. **Pass the EFFECTIVE tick cost**, not the action's base cost — the tool-adjusted
   value the session already stores. Skipping this is skipping the law.
6. **Test in `tests/inkwright.test.ts`** against real `skills.json` actions.

### Inkwright traps, each one paid for

- **Never drive motion from `progress`.** `getActionProgress` is tick-quantised: a
  4-tick action reports 0, .25, .5, .75 and nothing between. The bar reads progress;
  the figure reads a CSS clock.
- **Gate the payoff on `yieldToken > 0`.** It is the completed-action count and starts
  at 0, so an ungated payoff shattered the rock and popped a reward the instant the
  screen opened, before a single action finished.
- **The intact resource must hide for its own payoff.** Prop and payoff are sibling
  layers, so the shards flew over a rock still standing there whole.
- **Re-key the strike loop on each yield.** That is what keeps it phase-locked — a
  free-running loop drifts within a few actions and the pick starts passing through a
  rock that breaks on its own.
- **Scale the strike COUNT, never the tempo.** Solve the count from the target tempo,
  then the period back from the count. A longer action is more swings, not slower
  ones — a 30-tick action animated at 7.5× reads as broken, and this was a deliberate
  product call.
- **Do not reach for `swingDurationMs` here.** The skilling period is already
  near-constant by construction; a second scaling on top only drifts.

## Where this does not apply

The open world renders 3D entities from baked GLB clips with its own impact-frame
alignment (`src/utils/combatWindup.js`, `world/client/src/entities.ts`). Different
renderer, different problem. Do not wire `.as-*` into it, and do not "unify" the two
timing models — the wind-up system aligns a clip's *impact frame* onto a hit tick,
which is a stricter constraint than this one.
