# Action Animations — design record

The system that shows the player their action happening: combat swings today, every
skilling action next. Combat shipped first because it has the hardest version of the
problem — two actors, three styles, and a cadence that changes with equipment.

Authoring checklist for adding one: the **`action-animation`** skill. This file is
the *why*; the skill is the *how*.

## The one law

**An action's animation is timed off that action's own cadence.** A 4-tick scimitar
swings visibly faster than a 7-tick godsword because its cycle is shorter. A Rune
pickaxe will strike faster than a Bronze one for the same reason and through the same
arithmetic.

Everything else here is mechanism. If a change makes a duration constant, the system
has stopped telling the player the truth about what they equipped, and there is no
point to it.

The arithmetic lives in one place — `src/utils/actionSprites.js`:

```
actionCycleMs(ticks)    → ticks × 600ms          the cadence the player feels
swingDurationMs(cycle)  → 200ms + cycle × 0.11   the motion inside that cadence
```

`swingDurationMs` is deliberately **not** a percentage of the cycle. Two things go
wrong with a percentage, and both were built and rejected:

1. A godsword's motion runs 3.5× a dagger's, which is not what a slow weapon looks
   like — the *gap between swings* is what says "slow"; the motion itself only needs
   to be heavier.
2. Once the upper clamp binds, every cadence past it animates identically. At a 0.6
   fraction that happened at **3 ticks**, i.e. to almost every weapon in the game.

A shallow slope off a fixed base is strictly monotonic across everything shipped
(weapons 3–9 ticks, monsters 2–8), so no two cadences ever animate the same.
`tests/actionSprites.test.ts` asserts that directly — if a new action ever binds
`SWING_MAX_MS`, re-tune the slope rather than letting the clamp flatten it.

## The sprite is the tool glyph

The repo owns no sprite sheets and is not getting any. What it owns is 193 vendored
game-icons.net glyphs (`src/data/gameIcons.json`), masked through
`skillEmblemMask()` and rendered by `SkillEmblem` — the same technique as the Home
Screen's skill art.

So **the sprite is the tool**: `sword` / `bow` / `staff` for the three combat styles;
`pickaxe` / `wood_axe` / `fishing_pole` for the gathering skills. A new animation
costs a glyph key and a keyframe family. That is the only reason this generalises to
23 skills instead of stalling at "we need an artist".

Consequence to respect: `gameIcons.json` ships in the **lazy game chunk** (CLAUDE.md
§12), so both files are in `GAME_CHUNK_FILES` and the glyph read stays behind
`skillEmblemMask`'s existing `typeof` guard. A stage on a boot-reachable screen would
need that guard checked again.

## The pieces

| File | Role |
|---|---|
| `src/utils/actionSprites.js` | Pure: timing law, style→tool table, event→swing mapping. No DOM. |
| `src/components/ActionSpriteStage.jsx` | Presentation: actor's tool, target's mark, the lane between them. Derives no timing of its own. |
| `src/index.css` `.as-*` | Layout + keyframes, all motion behind `prefers-reduced-motion`. |
| `tests/actionSprites.test.ts` | The law, the clamps, the mappings. |

The stage is a three-column band: **actor tool** → **lane** → **target mark**. In
combat the actor is the player and the target is the monster's emblem; for skilling
the actor is the player's tool and the target is the resource's emblem. The lane
carries the projectile for any motion that connects at range.

### Why a swing is a token, not a boolean

`swingsFromCombatEvents` returns `{ id, side, hit }` per side per tick. The renderer
keys its animated elements on `id`, which is what makes a *repeat* swing replay — a
CSS animation on an element whose class never changed is simply ignored, so a boolean
would animate the first swing of a fight and nothing after it.

Three rules fell out of building it:

- **A miss is a swing.** The motion happened; only the damage is 0. `hit` gates the
  target's recoil flash, never the attacker's motion. So is a blocked hit: combat.js
  emits `immuneHit` *instead of* `playerHit` against an immune form and still resets
  the attack timer, so leaving it out made a whole immune phase read as the player
  standing there doing nothing.
- **A multi-hit special is ONE swing**, not one per hit. These are membership tests
  over the tick's events, never counters.
- **A token stays set after its motion ends**, so the two motions a target can play
  live on two nested elements with two keys. Sharing one element means sharing one
  key, and the target's key changing for *either* reason replays *both*: the monster
  performed its whole attack on every player swing, and the red hit flash replayed on
  every monster swing. Each layer must replay only on its own trigger.
- **An incoming swing must be matched to the enemy the stage is drawing.** A boss and
  its adds swing through the same `monsterHit`/`monsterMiss` events, separated only
  by `fromAdd`, and the stage follows whichever enemy the player is targeting — so an
  unfiltered read animated the boss's swing on the add's mark, at the add's speed.
- **Stance is part of the cadence.** combat.js takes a tick off a ranged swing on
  Rapid (six sites). Rapid is the stance a player picks *specifically* to be faster;
  ignoring it animated it at Accurate's pace.

### Reading style off the current form

`monsterCombatSprite` reads a multi-form boss's **current form**, not its top-level
`attackStyle`. Reading the top level is the bug CLAUDE.md §4 already records for the
open world, where it left Zaryth permanently ranged and the melee and magic clips its
rig ships never played. A form decides style *and* (where it overrides one) speed.

### Co-op

Every member's events arrive on one shared ring tagged with the `characterId` whose
session produced them (CLAUDE.md §20). `swingsFromCoopEvents` therefore takes the
viewer: only **their** swings move the tool, and only a boss swing whose `isTarget`
names them moves the incoming motion. Without that gate a full room lunges eight
times a tick.

## Extending to a skill

Full checklist in the `action-animation` skill. The shape:

1. Add a row to `ACTION_SPRITES` — `{ motion, tool, projectile, label }`.
2. Add its keyframe family to `src/index.css` as `.as-tool--<motion>`.
3. Resolve the cadence from the skill's own action (its tick cost), not a constant.
4. Map the skill's completion/progress events to swing tokens.
5. Render `<ActionSpriteStage>` — for a skilling screen, most likely inside
   `SkillActivePanel`, which every idle skill already shares.

Point 5 is the leverage: `SkillActivePanel` is one component behind most skilling
screens, so a stage added there covers many skills in one change. Check each screen
that passes its own `icon` override before assuming it is uniform.

## Known gaps

- **`showingAdd` is read from the state the tick RESOLVED under, not the result.**
  Solo passes the pre-tick `state`, because the blow that kills a targeted add
  clears `addTargetIndex` and reading the result would discard the killing swing.
  Co-op has no pre-tick state in the beat callback and reads the incoming
  `nextState` — which is as close as that context gets, and crucially *not* a ref
  written during render: the beat callback runs before the render it causes, so a
  rendered ref lags a beat and drops both swings on every target switch. On an
  add's death the recoil therefore flashes over the emblem that replaced it, for
  one frame. That is the deliberate trade against losing the swing entirely.
- **`splatsFromCoopEvents` has the room-wide gap this change closed for swings**: it
  gates incoming splats on `isTarget` alone, so a non-target member takes room-wide
  damage with no splat over their HP bar. The `roomWide` flag now on the event is
  what a fix would read. Flagged, not fixed — it predates this change.

## Deliberately not done

- **The open world** (`world/client`) renders 3D entities with baked GLB clips and
  its own wind-up alignment (`src/utils/combatWindup.js`). It is a different renderer
  with a different timing problem and is not on this system.
- **Boss adds** do not get their own stage. The stage follows the enemy the player is
  actually targeting; a stack of them would push the fight off a phone screen, the
  same reason only one add HP bar is drawn.
- **Per-weapon glyphs.** The stage shows the *style*, not the item — a scimitar and a
  godsword both show `sword`. Style is what the player needs to read mid-fight; the
  item is already in the equipment pane.
