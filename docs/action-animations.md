# Action Animations — design record

The system that shows the player their action happening. **Two live stages, one
law, one drawn figure.** Combat shipped first because it has the hardest version of
the problem — two actors, three styles, and a cadence that changes with equipment.
Mining, woodcutting and fishing shipped second, on a stage of their own. Combat then
moved a second time — off its original tool-glyph presentation onto the same drawn
"Inkwright" figure skilling uses, armed per style and facing a mirrored copy of
itself for the enemy.

Authoring checklist for adding one: the **`action-animation`** skill. This file is
the *why*; the skill is the *how*.

## Which stage

| | `InkwrightCombatStage` (`.inkc-*`) | `InkwrightStage` (`.ink-*`) |
|---|---|---|
| Shape | two figures facing off, mirrored | a figure working a resource |
| Sprite | drawn inked-vector figure + weapon | drawn inked-vector figure + tool |
| Cadence | one cycle = one swing | one action = several strikes, one yield |
| Wired | solo combat, co-op/raid | mining, woodcutting, fishing |

They are two PRESENTATIONS, not two timing systems: both take their cadence from
`actionCycleMs` in `src/utils/actionSprites.js` (combat directly; skilling through its
own `inkwright.js`, which inverts the law on purpose — see below). Pick by whether the
player is fighting something that fights back or working something that gives way.

**A third stage, `ActionSpriteStage` (`.as-*`, a masked `gameIcons.json` tool glyph in
a lane between two actors), was combat's FIRST presentation, was superseded, and is
deleted** — the event/timing plumbing underneath it (`swingsFromCombatEvents`,
`swingsFromCoopEvents`, `playerCombatSprite`, `monsterCombatSprite`, `useActionSwings.js`,
all in `actionSprites.js`) is NOT deleted, because it is exactly what
`InkwrightCombatStage` still consumes, unchanged. Everything below about swing tokens,
the event contract, co-op gating, and reading a boss's current form applies to the
CURRENT renderer even though some of it was written against the old one — none of it
lives in the renderer. **`ACTION_SPRITES` still carries the deleted renderer's `tool`
field** (`'sword'|'bow'|'staff'`) alongside `motion` (`'melee'|'ranged'|'magic'`) —
`InkwrightCombatStage` must read `.motion`; reading `.tool` compiles fine and silently
renders every style as melee.

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

## The sprite is drawn, not a glyph — and that changed once

`ActionSpriteStage` (superseded, now deleted) drew the repo's 193 vendored game-icons.net glyphs
(`src/data/gameIcons.json`), masked through `skillEmblemMask()` and rendered by
`SkillEmblem` — the same technique as the Home Screen's skill art. The sprite was
literally the tool: `sword` / `bow` / `staff` for the three combat styles. A glyph key
plus a keyframe family was the whole cost of a new animation, which is why the system
could reach 23 skills without commissioning art.

`InkwrightCombatStage` keeps that same economy but pays it differently: **the sprite
is drawn SVG, sharing the skilling figure's geometry.** A weapon costs a handful of
paths in `CombatTool()` (`src/components/InkwrightCombatStage.jsx`), not a glyph
lookup — melee is a blade off the shoulder, ranged is a bow with a drawn string,
magic is a staff with a charging orb. Extending to a new weapon SHAPE (a shield, a
2h axe) is still cheap; extending to a new CHARACTER is not, which is why the enemy
is deliberately the same rig recoloured rather than its own drawing (see below).

## The pieces

| File | Role |
|---|---|
| `src/utils/actionSprites.js` | Pure: timing law, style→tool table, event→swing mapping. No DOM. |
| `src/components/InkwrightFigure.jsx` | The shared body — hood, tunic, limbs. No arm, no tool: those are `children`, supplied by whichever stage wraps it. |
| `src/components/InkwrightCombatStage.jsx` | Presentation: two `InkwrightFigure`s, weapon per style, mirrored enemy, struck flash, lane-crossing shot. Derives no timing of its own. |
| `src/components/ActionSpriteStage.jsx` | Deleted (superseded presentation, tool glyph in a lane). Documented invariants live on in this file and the skill instead. |
| `src/index.css` `.inkc-*` | Combat's layout + keyframes; `.as-*` (the superseded equivalent) is deleted. All motion behind `prefers-reduced-motion`. |
| `tests/actionSprites.test.ts` | The law, the clamps, the mappings — shared by both renderers, untouched by the swap. |

`InkwrightCombatStage` mirrors the ENEMY, not each figure: one wrapping
`translate(STAGE_W,0) scale(-1,1)` around the whole enemy group, so every local
coordinate authored for the player — shoulder pivot, weapon tip, shot flight path —
is written once and reads correctly on both sides for free. CSS `transform-origin` is
evaluated in an element's own local space before its own transform, so `.inkc-arm`'s
pivot needs no mirrored counterpart.

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

## Inkwright — the combat figures

Two `InkwrightFigure`s facing off, drawn from the exact same body geometry skilling
uses — the whole point of the name is that it is ONE character, not a per-context
redraw. What differs is what's in the hand and what the enemy looks like.

**The enemy has no art of its own, on purpose.** It is the player's own rig, mirrored
and given a coloured aura from the style/monster accent already resolved elsewhere
(`getStyleArt`/`getMonsterArt`) — a `filter: drop-shadow` on `.inkc-fig.enemy`, nothing
more. Real per-monster art is future work the `action-animation` skill flags, not a
gap to close here; today the aura is the only thing telling two fights apart.

**The weapon is always drawn, at rest and mid-swing alike** — matching skilling's own
pickaxe-is-always-in-hand rule. The enemy side learned this the hard way: gating its
`CombatTool` on "currently swinging" made its weapon flicker in and out of existence
between attacks, because `t` (the frozen/current target sprite) is already available
before the first swing token ever arrives — `target.sprite` is computed every render
from `monsterCombatSprite`, independent of whether anything is mid-swing.

**The actor's own weapon is the actual equipped item, drawn from its bespoke
inventory icon — `CombatWeaponIcon` in `InkwrightCombatStage.jsx`.** This reverses
the "per-weapon art" line that used to sit under "Deliberately not done" below: every
weapon in `items.json` already has a `bespokeIcons.json` entry (151/151), so there was
no coverage gap to design around. It costs no new art and no per-item authoring because
`bespokeIcons.json`'s weapon entries share one 512×512 canvas roughly centred at
(256,256), which is what makes ONE anchor+scale per `motion` (melee/ranged/magic), not
per item, land all 151 close enough to "held": the icon's own centre goes near the hand,
nudged toward the business end so the grip half sits on the hand. That canvas hides TWO
different authoring conventions, though, and only one nudges correctly on its own — a
blade drawn diagonally in absolute coordinates (dragon_scimitar and its tier-mates)
already leans up-right, but the larger family (maces, longswords, spears, staves, wands,
godswords, mauls...) is drawn upright and then rotated a NEGATIVE angle about its own
centre, which swings the business end up-LEFT instead. Anchored the same way, a dragon
mace's head landed over the wielder's own face with its pommel dangling out past the
hand — obvious on a mace (two round masses of near-equal weight at each end), easy to
miss on a thin dagger or staff at a glance. `needsMirror` reads each icon's own
`rotate(angle …)` to tell the two families apart — a NEGATIVE angle mirrors (one sign
flip on the transform's X scale, centred on the same anchor), a positive angle or no
rotate at all (the bow family) does not. Bespoke
icons render exactly as authored (full colour, no tint) — the one place on this stage
that isn't flat ink, because the item is the point. `CombatTool` is now purely the
FALLBACK: unarmed (no weapon item) and anything with no resolvable icon at all render
the old generic per-style shape instead, unchanged. **Scoped to the actor only** — the
enemy still draws the generic mirrored `CombatTool`, per-monster art is still the
separate, deferred gap described two paragraphs up.

**A swing is ONE-SHOT, not a loop** — `.inkc-fig--<motion>.is-swinging .inkc-arm`
plays once per token and holds at rest until the next one, exactly the cadence
`ActionSpriteStage` already established ("Why a swing is a token, not a boolean",
above). The GAP between tokens
(`cycleMs − swingMs`, both from `actionSprites.js`) is what a slow weapon looks like;
nothing in `.inkc-*` tries to fill that gap with more motion, which would be the
skilling law bleeding into a system that deliberately doesn't use it.

**The shot** (ranged arrow, magic bolt) is authored once, in the ACTOR's own local
coordinates, and reused unchanged for the enemy's own attack — the enemy's wrapping
mirror sends it the other way for free, same as the weapon geometry. It stays
invisible through the wind-up/charge (`0%, 58%` in `inkcShotFly`), appears right as
the string or the orb releases, and crosses to roughly the other figure's torso before
the swing ends. Melee has no shot at all — it connects in reach, not at range.

**Struck flashes are named by who takes them, not who swung** — `enemyFlashes` /
`playerFlashes`, not `actorStruck` / `targetStruck`. The actor's swing landing flashes
the ENEMY; the target's swing landing flashes the PLAYER. The two read backwards from
each other on first glance (that IS the bug shape a bad name invites), which is why
they're spelled out rather than left implicit.

### Extending to a combat style

1. Add the style to `ACTION_SPRITES` in `actionSprites.js` if it is genuinely new (the
   three that exist — melee/ranged/magic — are unlikely to grow; a new WEAPON within
   an existing style needs no change here at all).
2. Draw it in `CombatTool()`: the shaft must pass through the grip at (100,64), same
   rule as every skilling tool, or it reads as floating beside the arm.
3. If it attacks at range, add its shot to `CombatShot()` and give it a keyframe
   `.inkc-fig--<motion>.is-swinging .inkc-shot--<name>` inside the existing
   `prefers-reduced-motion: no-preference` block.
4. Add the swing keyframe itself: `.inkc-fig--<motion>.is-swinging .inkc-arm`, one-shot
   (no `infinite`), duration `var(--inkc-dur)`.
5. Nothing to register in `build_single.cjs` unless you added a FILE — a new style
   inside the existing three files needs no build changes.

## Inkwright — the skilling figure

`src/utils/inkwright.js` (pure) + `src/components/InkwrightStage.jsx` + the `.ink-*`
CSS. One hooded inked-vector figure, reused across every gathering skill; the tool,
the motion and the prop change per skill, the figure never does. That is what makes
it extend to 23 skills: a new skill costs a motion row, a keyframe family and a prop
shape, never a character.

### Where skilling diverges from combat, and why

A combat cycle is ONE swing, so a slower weapon means a slower-looking swing. A
skilling action is several strikes ending in one yield, so **a longer action means
MORE strikes at the same tempo** — runeforged ore takes 23 swings to break, not one
sluggish one. This was a deliberate product call, made watching the prototype: tempo
is what a player reads as "how hard am I working", strike count as "how tough is this
rock". Making a 30-tick action swing 7.5× slower read as broken.

So `inkwrightPlan` solves the strike COUNT from a target tempo, then the period back
from the count — never the other way round. Rounding the period instead leaves a
partial strike at the end and the yield lands mid-windup. Because the count divides
the action exactly, a loop restarted at each yield lands its final impact on the next
yield forever.

`swingDurationMs` is deliberately NOT used here. The skilling period is already
near-constant by construction (720–890ms across everything shipped), so a second
scaling on top of it would do nothing but drift. Combat needs it because its cycle
varies 3–9 ticks; skilling does not.

### Three things that bit

- **Progress is tick-quantised.** `getActionProgress` on a 4-tick action only ever
  reports 0, .25, .5, .75 — four poses and a jump. The bar reads progress; the figure
  reads a CSS clock. Do not drive motion from `progress`.
- **The payoff must not render before an action completes.** Keyed on
  `skilling.totalActions`, which starts at 0 — so the rock shattered and a reward
  popped the instant the screen opened. Gate on `yieldToken > 0`.
- **The intact resource has to step aside for its own payoff.** They are sibling
  layers, so the shards flew over a rock still standing there whole. `.ink-prop`
  hides for exactly the payoff and returns as the next rock.

### The wiring constraint

`SkillActivePanel` is in **core**; `actionSprites.js` and `inkwright.js` are
**game-chunk** only (§12). So the panel takes the stage as a `stage` node prop and
imports nothing — the chunked screen builds it. Importing the modules into the panel
would be a core→chunk read at module eval, which is the whiteout hazard.

Feed it the **effective** tick cost. `SkillingScreen` stores the tool-adjusted action
on the session (`getEffectiveToolActionTicks`), so a Rune pickaxe strikes visibly
faster than a Bronze one for free; passing the base cost silently throws that away.

## Rollout state

| Surface | Stage | State |
|---|---|---|
| Solo combat, co-op/raid | `.inkc-*` | shipped (superseded `.as-*` deleted) |
| Mining, woodcutting, fishing | `.ink-*` | shipped |
| Firemaking, cooking, smithing, crafting, fletching, herblore, runecraft | `.ink-*` | next — each is a motion row + keyframes + prop |
| Thieving, hunter, agility, farming, construction, summoning | — | own screens, not on `SkillActivePanel`; needs a look first |
| Magic, prayer, slayer, dungeoneering | — | no physical strike; may not want a figure at all |
| Open world | neither | baked GLB clips, `src/utils/combatWindup.js` — deliberately separate |

## Extending to a skill

Full checklist in the `action-animation` skill. For a gathering-shaped skill:

1. Add a row to `INKWRIGHT_MOTIONS` and map the skill in `SKILL_MOTIONS`.
2. Add its keyframe family to `src/index.css` as `.ink-fig--<motion>`, and a payoff.
3. Draw its tool in `Tool()` and its resource in `Prop()` — whole, and broken.
4. Register both new files in `build_single.cjs` (`sourceFiles` + `GAME_CHUNK_FILES`).
5. Render from the chunked screen, passing `stage` into `SkillActivePanel`.

Point 5 is the leverage: `SkillActivePanel` is one component behind most skilling
screens, so a stage added there covers many skills at once. Check each screen that
passes its own `icon` override before assuming it is uniform — `GatherScreen` does.

## Known gaps

- **`showingAdd` is read from the state the tick RESOLVED under, not the result.**
  Solo passes the pre-tick `state`, because the blow that kills a targeted add
  clears `addTargetIndex` and reading the result would discard the killing swing.
  Co-op has no pre-tick state in the beat callback and reads the incoming
  `nextState` — which is as close as that context gets, and crucially *not* a ref
  written during render: the beat callback runs before the render it causes, so a
  rendered ref lags a beat and drops both swings on every target switch. On an
  add's death the recoil therefore flashes over whichever enemy replaced it on the
  stage, for one frame. That is the deliberate trade against losing the swing
  entirely — true of both renderers, since the read happens above either of them.
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
- **Per-monster art for the enemy.** Today every monster is the same rig with a
  coloured aura. Real per-monster silhouettes are the obvious next step and were
  explicitly deferred, not forgotten — see "Inkwright — the combat figures" above.
