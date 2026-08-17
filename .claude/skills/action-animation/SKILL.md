---
name: action-animation
description: Use when adding or changing an on-screen animation for a player action - a combat swing, a mining strike, a fishing cast, a smithing hammer blow - or when editing src/utils/actionSprites.js, src/utils/inkwright.js, InkwrightCombatStage.jsx, InkwrightStage.jsx, InkwrightFigure.jsx, or the .inkc-* / .ink-* CSS. Covers the two live stages and when to use each, the timing law (an animation's speed IS the action's own cadence), why skilling scales strike COUNT instead of tempo, the event-to-swing contract, and the build/reduced-motion gates. Do not use for the open world's 3D entity clips (world/client, GLB rigs, combat wind-up alignment) or for procedural 3D creature specs - those are procgen-creature and .claude/rules/world-design.md.
---

# action-animation: showing the player their action

Design record, rationale and rollout state: `docs/action-animations.md`. This is the
checklist.

**One law, one drawn figure, two live stages.** Pick by what the player is doing:

| | `InkwrightCombatStage` (`.inkc-*`) | `InkwrightStage` (`.ink-*`) |
|---|---|---|
| Shape | two figures facing off, mirrored | a figure working a resource |
| Sprite | drawn inked-vector figure + weapon | drawn inked-vector figure + tool |
| Cadence | one cycle = one swing | one action = several strikes, one yield |
| Wired | solo combat, co-op/raid | mining, woodcutting, fishing |

Fighting something that fights back → the combat stage. Working something that gives
way → the skilling one. Both are the SAME character (`InkwrightFigure.jsx`) — a new
combat style or a new skill costs a motion, not a redraw.

**`ActionSpriteStage.jsx` (`.as-*`, a masked-glyph tool-in-a-lane) is superseded.**
It was combat's first presentation and no screen renders it any more, but it is not
deleted — its file, its CSS, and `useActionSwings.js` all stay, because the
event-to-swing contract underneath it (`swingsFromCombatEvents`, `swingsFromCoopEvents`,
`playerCombatSprite`, `monsterCombatSprite` — all in `actionSprites.js`) is exactly
what `InkwrightCombatStage` still runs on, unchanged. Everything in this skill about
swing tokens, misses, boss adds, Rapid stance, and co-op gating applies to the CURRENT
renderer even though it was written against the old one — none of it lives in the
renderer.

These are two PRESENTATIONS, not two timing systems. Both take their cadence from
`actionCycleMs`. A change that wants a **third timing source** or a per-screen
duration is going the wrong way — the whole value is that every skill and every
combat style shares one law.

## The law — non-negotiable

**An animation's speed is the action's own cadence.** Never a constant, never a
literal in CSS.

```js
const cycleMs = actionCycleMs(ticks)        // the action's tick cost × 600ms
const swingMs = swingDurationMs(cycleMs)    // the motion inside that cadence
```

Both from `src/utils/actionSprites.js`. The duration reaches CSS only as an inline
custom property (`--inkc-dur` on `InkwrightCombatStage`'s current renderer;
`--as-dur` on the superseded `ActionSpriteStage`, same value, same source). A
hard-coded `animation: x 400ms` anywhere in `.inkc-*` is the failure this system
exists to prevent — a player who buys a faster weapon must see it.

`swingDurationMs` is a shallow slope off a fixed base, **not** a percentage of the
cycle. A percentage was built and rejected: it hit the upper clamp at 3 ticks, so
every weapon from a scimitar up animated identically. If a new action's cadence binds
`SWING_MAX_MS`, **re-tune the slope** — do not let the clamp flatten two different
cadences onto one duration. `tests/actionSprites.test.ts` asserts strict monotonicity
across the shipped range and will fail if you do.

## Adding a combat style to Inkwright

A new WEAPON within melee/ranged/magic (a different sword, a different bow) needs
**none of this** — the stage draws by style, not by item, on purpose (see Traps). This
is for a genuinely new attack style.

1. **Add a row to `ACTION_SPRITES`** (`src/utils/actionSprites.js`):
   `{ motion, tool, projectile, label }`. `projectile` is `null` for anything that
   connects in contact range (melee has none; ranged/magic do). This table is shared
   with the superseded `ActionSpriteStage` and both combat-art helpers
   (`getStyleArt`/`getMonsterArt`) — a new style needs an accent colour there too.

2. **Draw the weapon** in `CombatTool()` (`InkwrightCombatStage.jsx`). The shaft must
   pass through the grip at (100,64) — every Inkwright tool follows this, or the
   weapon reads as floating beside the hand rather than held in it.

3. **If it attacks at range, draw the shot** in `CombatShot()`, authored in the
   ACTOR's own local coordinates — the enemy's wrapping mirror sends it the other way
   for free, so never author a second, "enemy-facing" version.

4. **Add the swing keyframe**: `.inkc-fig--<motion>.is-swinging .inkc-arm`, ONE-SHOT
   (no `infinite` — a combat cycle is one swing, not a loop), duration
   `var(--inkc-dur)`. Add the shot's own keyframe the same way if it has one. Inside
   the existing `@media (prefers-reduced-motion: no-preference)` block — DESIGN.md §5
   requires a reduced-motion alternative, and the stage reads as a posed tableau with
   motion off.

5. **Resolve the cadence from the action itself** — the weapon's `attackSpeed`, read
   through `playerCombatSprite`/`monsterCombatSprite`. Not a screen constant, not a
   guess.

6. **Map events to swing tokens.** Follow `swingsFromCombatEvents`: return
   `{ id, side, hit }`, a fresh `id` per occurrence. The renderer keys on `id`, so a
   boolean animates the first swing and nothing after it.

7. **No build registration needed** unless the change added a FILE — a new style
   inside the three existing files (`actionSprites.js`, `InkwrightCombatStage.jsx`,
   `index.css`) needs no `build_single.cjs` changes.

8. **Test in the same change** (`tests/actionSprites.test.ts`): the new
   `ACTION_SPRITES` row and its cadence.

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
- **`.inkc-*`, `.as-*` and `.ink-*` are not `.cb-*` classes.** Every colour comes from
  the semantic layer (`--surface-sunken`, `--hairline`, `--text-*`), so each is
  defined **once** and is exempt from the Two-Skin Trap (DESIGN.md §2). Adding a
  non-semantic colour means owing a second `.forge-shell` definition — reach for a
  token instead.
- **The enemy's weapon must be drawn at rest, not just mid-swing.** Gating
  `CombatTool` on "currently swinging" makes it flicker in and out of existence
  between attacks — `target.sprite`'s tool is known before the first swing token ever
  arrives, so draw it unconditionally, matching the player's own always-armed
  treatment (and skilling's pickaxe-always-in-hand rule).
- **Struck flashes are named by who takes them, not who swung.** An `actorStruck` /
  `targetStruck` pair reads backwards on first glance — the actor's OWN swing landing
  is what flashes the *enemy*. Name them `enemyFlashes` / `playerFlashes` (or
  equivalent) so the variable states the visible effect, not the cause.
- **Mirror the ENEMY, not each figure.** One `translate(STAGE_W,0) scale(-1,1)`
  around the whole enemy group means every local coordinate — shoulder pivot, weapon
  tip, shot flight path — is authored once and reads correctly on both sides.
  Mirroring per-figure means re-deriving that arithmetic twice and it drifting once.

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
renderer, different problem. Do not wire `.inkc-*` into it, and do not "unify" the two
timing models — the wind-up system aligns a clip's *impact frame* onto a hit tick,
which is a stricter constraint than this one.
