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
| Sprite | articulated inked figure + weapon | articulated inked figure + tool + environment |
| Cadence | one cycle = one swing | one action = several strikes, one yield |
| Wired | solo combat, co-op/raid | every skilling action with a motion — gathering, production, prayer, construction, non-combat magic |

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
`attackStyle`. Reading the top level is the bug `.claude/rules/gameplay-engine.md`
already records for the open world, where it left Zaryth permanently ranged and the
melee and magic clips its rig ships never played. A form decides style *and* (where
it overrides one) speed.

### Co-op

Every member's events arrive on one shared ring tagged with the `characterId` whose
session produced them (`.claude/rules/coop-raids.md`). `swingsFromCoopEvents` therefore takes the
viewer: only **their** swings move the tool, and only a boss swing whose `isTarget`
names them moves the incoming motion. Without that gate a full room lunges eight
times a tick.

## Inkwright — the combat figures

Two `InkwrightFigure`s facing off, drawn from the exact same body geometry skilling
uses — the whole point of the name is that it is ONE character, not a per-context
redraw. What differs is what's in the hand and what the enemy looks like.

**The body itself was redrawn once, in place, for the whole-figure realism pass
described under "Inkwright — the skilling figure" below** — real legs and boots, a
jerkin with a belt, a face — without moving a single joint combat's own math
depends on. `InkwrightFigure.jsx`'s docblock states the constraint plainly: the
shoulder pivot (84,58), the grip (100,64 — `GRIP_X`/`GRIP_Y` in `weaponShapes.js`),
the hip/root origin (76,100), and the ground line (y=108) are independently
hard-coded in this file, in `weaponShapes.js`, and in every `transform-origin` in
`.inkc-*`/`.ink-*` — none of them re-derive the others, they just have to keep
agreeing. A body redraw that keeps those five numbers is safe; a redraw that moves
any of them requires re-deriving all twelve weapon placements and every swing/shot
transform-origin in the same change, which is a much bigger, Architect-gated
undertaking this pass deliberately stayed inside of.

**The enemy used to have no art of its own** — it was the player's own rig, mirrored
and given a coloured aura, so every fight in the game looked like the same fight.
That gap is closed: see "Inkwright — the monsters" below. The aura survives, demoted
to a rim light (and, on a multi-form boss, the colour of the form it is in).

**The weapon is always drawn, at rest and mid-swing alike** — matching skilling's own
pickaxe-is-always-in-hand rule. The enemy side learned this the hard way: gating its
`CombatTool` on "currently swinging" made its weapon flicker in and out of existence
between attacks, because `t` (the frozen/current target sprite) is already available
before the first swing token ever arrives — `target.sprite` is computed every render
from `monsterCombatSprite`, independent of whether anything is mid-swing.

**The actor's own weapon is drawn as one of TWELVE hand-drawn shapes, keyed by the
equipped item's TYPE and coloured by its MATERIAL** — `WEAPON_ICON_TYPES` in
`utils/actionSprites.js`, authored in `utils/weaponShapes.js` and rendered by
`CombatTool` in `InkwrightCombatStage.jsx`: sword, dagger, scimitar, rapier,
godsword, maul, mace, longbow, shortbow, crossbow, staff, wand. Two of those are
SCALED COPIES rather than drawings of their own — a shortbow is a longbow at half
size, a dagger is a sword at half size — so each family has one profile to get
right. This is the
SECOND attempt at "the weapon should look like the weapon." The first embedded the
actual `bespokeIcons.json` inventory icon per item and was reverted: that icon set
mixes authoring conventions with no single anchor that lands all 151 of them
correctly, and a mace icon anchored wrong (its head landing over the wielder's own
face, pommel dangling out past the hand) reads far worse than a merely-generic shape
ever did. This version costs a small FIXED set of shapes to get right instead of 151
individual ones — `weaponIconTypeFor(item)` classifies by the item's own id first
("dragon_scimitar" → scimitar outranks its mechanical stats), falling back to
attack style + two-handedness only for a name the rules don't recognise. Every item
within a type is told apart only by `weaponTint` (`getItemIconTint`, the same tier
colouring the Armoury/inventory already use) — a bronze scimitar and a dragon
scimitar are the same silhouette in different colours, same as the real weapons
elsewhere in the game. `accent` (the style colour) is unchanged and stays scoped to
projectile-adjacent bits only (bowstring/prod glow, orb) — material tint and style
accent are two different colours answering two different questions, and conflating
them would make an accent-tinted weapon the one non-ink-and-not-material object on
the stage. **Scoped to the actor only** — the enemy still draws the generic mirrored
`CombatTool` (no `weaponIconType`/`weaponTint`, so it falls to the plain per-motion
default: sword/bow/staff), per-monster art is still the separate, deferred gap
described two paragraphs up.

**Godsword and maul play a heavier two-handed smash** instead of the standard
one-handed swing — `isSmashWeaponType` gates an extra `.is-smash` class onto the
actor's `.inkc-fig` wrapper (melee only), which needs one more class selector than
the plain `inkcMeleeSwing` rule to outrank it by specificity. `inkcSmashSwing` winds
up higher (-92° vs -58°) and swings further through (58° vs 46°) — a bigger arc reads
as a heavier weapon without needing a second drawn arm; the rig only has one
grippable hand, so "two-handed" is conveyed by the shape (both are drawn bulkier than
a one-handed weapon) and the motion, not by literally repositioning the back arm.

**A rapier lunges instead of swinging** — `isLungeWeaponType` gates the same kind of
extra class (`.is-lunge`, melee only, mutually exclusive with `.is-smash` since a
weapon has exactly one `WEAPON_ICON_TYPES` entry). `inkcRapierLunge` composes
`rotate()` with `translate()` in the same keyframe — a fencer's attack travels along
the blade's own axis, not through an arc, so the wind-up is a small rotation and the
attack itself is a THRUST translated roughly along the rapier's drawn angle (the
blade runs grip→(146,26), ≈-39°), rather than the big rotation every other melee
weapon uses. The rapier's hilt (crossguard + knuckle-bow + pommel) is drawn pushed
clear of `InkwrightFigure`'s drawn fist (a ~7-radius blob centred on the grip point)
rather than centred on the grip — geometry sitting UNDER the fist silhouette simply
never rendered, which is also why the scimitar's crossguard and every other weapon's
grip decoration stay small and close rather than reaching for realism.

**A crossbow fires a bolt, not an arrow.** `CombatShot` and `shotOffset` both take
`weaponIconType` alongside `kind` now — a crossbow's bolt is short and stubby, fired
from its own shorter origin (the prod, not a full bowstring draw), so it needed its
own offset constants and its own CSS class (`.inkc-shot--crossbow`, added to the
`inkcShotFly` selector) rather than reusing the magic orb's `.inkc-shot--bolt`, which
would have been the same generic name for a different animal.

**A swing is ONE-SHOT, not a loop** — `.inkc-fig--<motion>.is-swinging .inkc-arm`
plays once per token and holds at rest until the next one, exactly the cadence
`ActionSpriteStage` already established ("Why a swing is a token, not a boolean",
above). The GAP between tokens
(`cycleMs − swingMs`, both from `actionSprites.js`) is what a slow weapon looks like;
nothing in `.inkc-*` tries to fill that gap with more motion, which would be the
skilling law bleeding into a system that deliberately doesn't use it.

**The shot** (bow arrow, crossbow bolt, magic orb) is authored once, in the ACTOR's own
local coordinates, and reused unchanged for the enemy's own attack — the enemy's
wrapping mirror sends it the other way for free, same as the weapon geometry. It stays
invisible through the wind-up/charge (`0%, 58%` in `inkcShotFly`), appears right as
the string/prod or the orb releases, and crosses to roughly the other figure's torso
before the swing ends. Melee has no shot at all — it connects in reach, not at range.

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

### Extending to a weapon shape

1. Add the id pattern (or, failing that, the mechanical fallback) to
   `NAME_TYPE_RULES`/`weaponIconTypeFor` in `actionSprites.js`, and add the new type
   to `WEAPON_ICON_TYPES`. `tests/actionSprites.test.ts`'s structural test asserts
   every shipped weapon classifies to a real type — a name pattern that matches
   nothing still needs a mechanical fallback or that test fails.
2. Draw it in `WEAPON_SHAPES` (`utils/weaponShapes.js`), NOT in the component —
   `CombatTool` is only a mapper. Author it in the weapon's own local frame: origin
   at the hand, +X toward the tip, +Y the edge side, with its own `angle` for
   placement. That frame is what makes a profile drawable at all; geometry authored
   directly in stage coordinates has to be pre-rotated ~40deg by hand, which is why
   the shapes this replaced read as stroked lines and flat wedges. Give it at least
   one part in a tinted role (`TINTED_FILL_ROLES`/`TINTED_STROKE_ROLES`) or every
   tier of it renders identically. Widths come from `ROLE_STROKE`, never CSS — a
   scaled copy has to divide them back out. If it is a copy of an existing weapon at
   a different size, add it to `SCALED` instead and draw nothing.
   `tests/weaponShapes.test.ts` checks that it stays inside the stage through its own
   wind-up, and `npm run gen:weapon-preview` refreshes the review page from it.
3. If it's genuinely a smash weapon (two-handed, meant to read heavy), add it to
   `SMASH_WEAPON_TYPES` in `actionSprites.js` — melee only, `isSmashWeaponType` gates
   `.is-smash` and nothing reads it outside that motion. A thrusting weapon instead
   of a swinging one is the same pattern via `LUNGE_WEAPON_TYPES`/`isLungeWeaponType`
   /`.is-lunge` — the two are mutually exclusive, so add a weapon to at most one.
4. If it fires, give it a `shot` kind and a `shotFrom` (its muzzle, in its own local
   frame) — `weaponMuzzle`/`shotOffset` derive the flight from those, so there is
   nothing to branch for the origin. Only a genuinely NEW projectile shape needs a
   branch in `CombatShot`, and it needs its own CSS class in the `inkcShotFly`
   selector — reusing another kind's class silently attaches the wrong animation
   (or none), the exact bug the crossbow-vs-magic-orb naming collision would have
   been if `.inkc-shot--bolt` had been reused instead of adding `--crossbow`.

## Inkwright — the skilling figure

`src/utils/inkwright.js` (pure) + `src/components/InkwrightStage.jsx` + the `.ink-*`
CSS. One articulated inked figure, reused across every gathering skill; the tool,
the motion, the prop and the environment change per skill, the figure's timing
law never does. That is what makes it extend to 23 skills: a new skill costs a
motion row, a keyframe family, a tool and a resource, never a character or a
second timing system.

### The fidelity bar: real tools, real environments, a real figure

Mining, woodcutting and fishing set the baseline every skilling animation now
targets — reviewed and approved as a standalone artifact
(`docs/skilling-plates-review.html`) before a line of it was wired into the game.
What changed from the original hooded-silhouette figure:

- **A real articulated body** (`InkwrightFigure.jsx`) — legs with boots, a belted
  leather jerkin, a face — replacing the faceless cowl the "no face, on purpose"
  rule used to justify. It is still shared with combat (see "Inkwright — the
  combat figures" above) and still one outline weight; what earns "realism" here
  is silhouette and proportion, not paint.
- **Real tools**, authored local-frame at (0,0) with +X toward the working end —
  the exact convention `weaponShapes.js` already proved for the twelve combat
  weapons, now extended to a crescent pickaxe, a bearded felling axe, and a
  three-segment fishing rod (`InkwrightStage.jsx`'s `Tool()`). A pick or an axe
  that flares symmetrically from a waist reads as a spade or a shovel, not a
  tool — see the weapon-shape file's own notes on the mace icon and apply the
  same suspicion here: proportion is what a silhouette-only style has to get
  right, because there is no texture to fall back on.
- **Real environments** — an ore boulder proud of a strata'd rock wall, a tree
  with a persistent notch under a broken-silhouette canopy (a stacked-ellipse
  canopy reads as broccoli; a scalloped outline reads as leaf mass), a river
  with a surface film the caught species' own art sits under. Fixed, not
  theme-flipped colour (see the token rule below).
- **Multi-joint choreography** instead of a single arm rotation: the strike
  keyframes now animate the front arm, the back arm, the head and a whole-body
  weight-shift together (`inkArmMine`/`inkArmBackMine`/`inkHeadMine`/`inkBodyMine`
  and their `Chop`/`Fish` counterparts, `index.css`), on a shared four-phase
  shape — anticipation, downswing, impact, recovery — instead of the old
  three-keyframe wind-up/swing/settle loop.

**Colour is a FIXED, non-theme-flipped material palette (`--ink-*` tokens,
`src/index.css` `:root`, next to `--tier-*`/`--potion-*`), never raw hex and
never a gradient.** This is the one rule every future skill built to this bar
must not break: a hero's skin, a tool's steel, a cave's darkness is the same
material regardless of whether the surrounding UI chrome is parchment or iron —
exactly the reasoning `--tier-dragon` already relies on elsewhere in this file
(confirm with `grep -n "\[data-theme" src/index.css`: neither `--tier-*` nor
`--potion-*` is ever redefined per theme). The system's own semantic layer
(`--surface-*`/`--text-*`/`--hairline`) still carries the figure's OUTLINE and
the stage frame, which is why it still flips for free — only the MATERIALS are
fixed. An early prototype used full multi-stop SVG gradients for a painterly
look; that was rejected for the shipped version, because this stage renders at
the same scale and speed as combat's mirrored two-actor stage, and a flat,
narrow, deliberate palette (one tone per material, occasionally a shade pair)
is what stays legible there — see `weaponShapes.js`'s own restraint for the
same call made once already, one system over.

**Placement is measured, not eyeballed.** Every tool's `translate/rotate/scale`
placement and every resource's position were derived from the actual grip
(100,64) and shoulder (84,58) coordinates by vector arithmetic — not "it looked
about right" — then verified by rendering the real component (a throwaway Vite
entry mounting `InkwrightStage`/`InkwrightCombatStage` directly, screenshotted
headless at rest and at the computed impact-frame percentage, deleted once the
check passed) rather than trusting the arithmetic alone. A tool's `scale` sets
its reach: reach-from-shoulder is the vector sum of shoulder→grip and (rotated,
scaled) grip→tip, and it is CONSTANT across the whole swing (rotation preserves
distance from the pivot) — so a resource placed off that radius can never be
struck, however the keyframe percentages are tuned. When adding a skill to this
tier, do the same arithmetic before drawing the resource, and confirm it with a
real screenshot before calling the placement done — a rest-pose screenshot alone
missed both the pick's undersized head and the axe's inch of overshoot; the pick
was only fixed by moving the resource, and the axe only by moving the tool's
`scale` and re-deriving the reach from there. The `--ink-*` prototype method is
also the review-artifact-first practice for any FUTURE skill in this tier: build
a standalone HTML plate, get it approved, then transplant the geometry and
timing shape (never the raw palette) into the real component.

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
| Solo combat, co-op/raid | `.inkc-*` | shipped — same shared figure, redrawn realistic (see above) |
| Mining, woodcutting, fishing | `.ink-*` | shipped — the fidelity baseline (real tools, real environments, measured placement) every future skill in this tier now targets |
| Firemaking, cooking, smithing, crafting, fletching, herblore, runecraft, prayer | `.ink-*` | shipped — Tier A, pure content on the system above |
| Construction, magic (non-combat) | `.ink-*` | shipped — Tiers E and G, the first two screens off `SkillingScreen` (see below) |
| Thieving, hunter, summoning | `.ink-*` | shipped — Tiers C, D and F (see below) |
| Agility, dungeoneering | `.ink-*` | next — Tier B, the traversal motion family; plan in `docs/skill-animations-proposal.md`, built to the tier this file describes, not the pre-realism bar |
| Slayer | — | no action of its own — trains via `CombatScreen`, already covered by `.inkc-*` |
| Farming | — | out of scope for the Inkwright stage; patch-based UI, not a `SkillActivePanel` action loop |
| Agility | — | own screen; it already renders `SkillActivePanel`, so wiring is a `stage` prop and the work is the motion design |
| Open world | neither | baked GLB clips, `src/utils/combatWindup.js` — deliberately separate |

## Tiers E and G — a workpiece that persists, and a spell with a target

The two tiers built after Tier A, and the first animations wired into screens
other than `SkillingScreen`. Both screens (`ConstructionScreen`, `MagicScreen`)
already rendered `SkillActivePanel`, so the wiring was a `stage` prop each; the
work was the motion design, exactly as the coverage proposal predicted.

**Construction is the one prop that is not consumed and respawned.** Every
other resource in this file breaks and comes back identical — a rock, a log
pile, a bar. A build spends a plank and the piece it is spent on has to still
be there, one part further along, or the player is watching the same blow
forever. So `scaffold` draws a chair at `built = yieldToken % BUILD_STAGES`
(frame → seat → back posts → back rails, then a fresh frame), and the payoff
settles **only the newest part** into place: settling the whole piece every
action would say the furniture was assembled from scratch each time, which is
the opposite of what the prop exists to show. Its colour comes from the
MATERIAL rather than a product — a build yields nothing to pop — which is why
`InkwrightStage` grew a `subject` prop, and why the four plank tiers visibly
build in four different woods.

**The hammer is drawn as a claw hammer, and that cost three attempts.** The
head has to cross the haft (a striking face on one side, a hooked claw on the
other) or it is not a hammer; drawn with a long sweeping claw it becomes a
crescent, which at this size is the PICKAXE that already exists two skills
over; and drawn as deep as the first version it read as an adze burying
itself in the bench. The shipped head is sized to the beam it lands on. The
placement arithmetic is the usual one and it is three numbers that move
together, not one: the tool's `scale`, the impact keyframe's arm angle
(`inkArmBuild`, -6deg) and the workpiece's apron rail (y=73) — the face's own
local contact point lands on (133.8,73.5), the rail's top edge.

**Magic is five acts on three motions, picked off the action id** the way
prayer's three poses are (`magicMotionKey`). Alchemy, superheating and
transmuting share one `cast` — point the staff, charge the orb, release —
because they ARE the same act: what changes is the spell and the thing it
lands on, not the body. Enchanting is a HELD channel: it runs 30 ticks, i.e.
23 strike periods, and an arm that rises and lowers 23 times reads as pumping
a bellows rather than pouring light into an amulet, so both arms stay up and
only the stream pulses. Cursing is aimed at something that flinches — a straw
practice dummy, deliberately not the mirrored player rig combat uses for its
enemy (that trick is reserved for thieving's mark) — and the dummy rocks on
every bolt that lands, not only on the completed action.

Three details carry the realism, and each replaced something that read wrong:

- **The pedestal shows the spell's real subject.** `subject` resolves through
  the same `bespokeItemArt` path fishing uses for its species, so an alchemy
  is the actual item the player picked standing on the plinth, a superheat is
  the actual ore and an enchantment is the actual amulet. A tinted generic
  blob could not tell any of those apart — the same argument the fishing
  plate settled once already.
- **A school colour, not a tint.** `--ink-spell` is set once per effect by a
  modifier class (gold / fire / nature / arcane) and read by the bolt, its
  halo and trail, the per-cast zap and the payoff flash. Without it a
  superheat and a transmutation are one caster pointing a staff at a plinth.
- **The plinth is a plinth.** Drawn first as a waisted body under a wide slab
  it read as an ANVIL, which is the one thing a caster must not appear to be
  working at — smithing already has one, two screens away. Stepped base,
  tapered shaft, capital, in lighter stone than the shrine's, because here it
  is the hero prop rather than scenery.

## Tiers C, D and F — a wait, a mark, and a rite

The three motions after construction and magic, and between them they use
every extension point this file describes: a prop that does not move, a prop
that is a second copy of the hero, and a payoff that is a creature.

**Hunter is the only action in the system that is a WAIT.** A spring-pole
snare is armed once and fires once, so the beat cannot be the trap the way a
strike is the pickaxe — a 20-tick hunt is 15 beats, and a trap that sprang and
reset fifteen times per catch is not a trap. The beat is one NEAR-MISS: the
quarry creeps to the bait at 55%, the trapper hauls the trigger line at 62%,
the quarry bolts at 74%. Because the strike loop is phase-locked to the action
(it re-keys on every yield and the strikes divide the cycle exactly), the last
haul of the action lands on the frame the payoff fires — every earlier one
misses, which is what hunting is. Fishing had already settled this shape from
the other direction; hunter is the version where the device, not the hand,
does the catching.

Three things the trap needed:

- **Leaves at the tip.** A bent brown pole is a shepherd's crook and a
  straight one is a fence post. The leaves are the only thing saying the trap
  is powered by a living, springy tree, and they are drawn on both the armed
  and the sprung pose.
- **Pole, then quarry, then noose** — that draw order IS the depth of the
  scene. Drawn quarry-first the pole ran straight through the animal's ribs;
  drawn noose-first the loop sat behind the thing it was about to close on,
  which says the trap already failed.
- **The catch hangs by `scale(1,-1)`, not `rotate(180)`.** A half turn also
  flips the quarry's own local +x, which threw its whole body out to the right
  and through the trunk. A vertical flip hangs it head-down where it already
  is, with the caught legs still at the rope.

**Five quarries share one trap and one motion**, picked off the action id and
placed by one table (`SNARE_QUARRIES` in `InkwrightStage.jsx`). Three targets
are drawn as themselves because their own silhouette is the reason to hunt
them — a patched cow with horns and an udder, a small green hedgehog, and the
Grim Reaper in a black cowl with a scythe over his shoulder. The other four
share the two generics: a hooded traveller for the merchants and the wizard
(`HUNTER_HUMANOIDS`), and a generic beast as the fallback for content not yet
written. Adding a target means a row in `HUNTER_QUARRIES` or an id in
`HUNTER_HUMANOIDS`; `tests/inkwright.test.ts` asserts no shipped target lands
on the fallback, which is what a misspelt id looks like.

Each quarry's `scale`, `standX` and its `--ink-creep` are three ends of one
equation: every one has to arrive at the noose (x=146) with the part that
reaches the bait — muzzle, snout or feet — while its far end stays inside the
200-unit frame. The herbi is the one that taught this: drawn at a size that
felt right it was 50 units long, which left no room between the bait and the
frame edge to creep in from, and a hedgehog is small anyway.

Three drawing lessons, each paid for twice:

- **A spiky animal is ONE closed silhouette**, jagged over the back and smooth
  under the belly. Drawn as a body path with a spiky mantle laid on top, the
  body's own outline showed all round the bottom and the herbi read as a green
  dome on a white saucer.
- **Spines point outward along the back's curve** — tips on one ellipse,
  valleys on a smaller one. A row of upright teeth on a flat base is a hedge.
- **A scythe goes over the shoulder, not over the head.** Drawn upright with
  the blade above the cowl, the Reaper's silhouette is a crescent sitting on a
  hood, which reads as a hat. Leaning the haft back and hooking the blade off
  its top puts the blade clear of the head.

The trigger line is stage-space like
the fishing tackle, but for the opposite reason: there the far end was free,
here it is tied to the ground, so the line turns about the STAKE rather than
swaying — 3.6 units of hand travel over a 47.4-unit cord is 4.4 degrees.

**Thieving is where the mirrored-rig trick finally gets used, and it costs
three CSS lines.** `InkwrightFigure` paints from `var(--ink-leather)` /
`var(--ink-leather-shade)`, and custom properties inherit, so re-pointing them
on a `.ink-mark` wrapper dresses the same body in different clothes — combat's
enemy aura at the same price and with a better result. The mark faces the SAME
way the player does, not mirrored: that is what makes them a back turned
rather than a confrontation.

The reach is the whole geometry problem. The hand's fingertip sits 39.2 units
from the shoulder once the grip offset (16,6) and the drawn forearm are
composed, and rotation preserves that radius — so the fingertip's locus is a
CIRCLE, and everything a thief steals has to be drawn on it. The dip angle
(27deg) and the body's 4px lean put it on (112.5,88.6); the mark's purse hangs
there, and the stall's cash box sits under the near end of its counter there
too, which is also where a trader would actually keep it. A box on the counter
top would have needed a second arm angle for one prop.

Three props, because the targets are not one thing: a cake stall is furniture
and an armoured guard is not a farmer (`THIEVING_GUARDS`, same maintenance
shape as the hunter list). And **no fail pose** — `processThievingTick` only
ever emits `pickpocketSuccess`, so a flinch would animate something the game
cannot do. That answers the coverage proposal's open question 2 on the
engine's terms rather than on effort.

Thieving is also the one motion that overrides the shared `.ink-yield`
position. Its prop is a PERSON, and at the standard 62%/34% the popped coins
land on the mark's head — reading as loot appearing on the victim rather than
coming off them. `.ink-stage--pickpocket` moves it to the thief's own side.

**Summoning's rite shows the pouch, never the charm** — and that is a data
fact, not a taste one: no charm has bespoke art, so every one of them resolves
to the same generic glyph disc, while every pouch and scroll has its own.
Making a pouch it is the thing taking shape; infusing scrolls it is the thing
being spent. Either way the creature is legible, which is the entire job,
since the figure makes the same push every time. `SUBJECT_ART_PROPS` is the
set that draws a real item this way — magic's four pedestals, plus the
obelisk.

The payoff is a familiar taking shape (the proposal's open question 3, and the
answer is *both*): a wisp bursts out of the flash and the product's ordinary
`GameIcon` still pops. One generic spirit serves every creature — what comes
out of a pouch on the bench is a wisp, not the beast. The push is deliberately
NOT enchanting's held channel: an infusion is two ticks, so there is exactly
one push in it and holding a pose through 600ms reads as a freeze.

One rest-pose rule came out of this tier and applies to every future motion:
**a motion whose arm rest angle is not 0deg needs a static `transform` on
`.ink-fig--<motion> .ink-arm` outside the reduced-motion block.** The keyframes
are gated off entirely under `prefers-reduced-motion: reduce`, and an unposed
pickpocket leaves the thief's reaching hand inside the mark's ribs. A CSS
`transform` property and an `animation` compose fine on the same element —
unlike a static SVG transform ATTRIBUTE, which the animation silently
discards.

## Extending to a skill

Full checklist in the `action-animation` skill. For a gathering-shaped skill, built
to the fidelity bar above:

1. Prototype it as a standalone HTML review artifact first (figure + tool +
   environment, at the real 200×128 skilling-stage frame, not the roomy canvas an
   exploratory mockup tends to reach for) and get it approved before touching
   `src/`. This is not optional ceremony — the placement-arithmetic step below
   depends on knowing the real anchors, and a canvas sized for a mockup produces
   numbers that don't transfer.
2. Work out the tool's `translate(100,64) rotate(θ) scale(s)` placement from the
   shoulder (84,58) and grip (100,64) — reach-from-shoulder is fixed by `s` and is
   the radius the resource must sit on (see "Placement is measured, not eyeballed"
   above for the vector arithmetic). Draw the tool local-frame, same convention as
   `weaponShapes.js`.
3. Add a row to `INKWRIGHT_MOTIONS` and map the skill in `SKILL_MOTIONS`
   (`src/utils/inkwright.js` — unchanged by this pass, still the timing law only).
4. Add the multi-joint keyframe family to `src/index.css` — front arm, back arm,
   head, whole-body weight-shift, matching the four-phase anticipation/downswing/
   impact/recovery shape `inkArmMine`/`inkArmChop`/`inkArmFish` set — and a payoff.
   Every colour a NEW `--ink-*` token (`:root`, fixed, not theme-flipped) or an
   existing one; never raw hex, never a gradient.
5. Draw its tool in `Tool()` and its resource/environment in `Prop()`/`Backdrop()`
   — whole, and broken.
6. Verify placement by rendering the real component (a throwaway Vite entry
   mounting `InkwrightStage` directly with a fake `plan`, screenshotted headless at
   rest and at the impact-frame percentage, then deleted) — not by reading the
   arithmetic and trusting it.
7. No `build_single.cjs` registration needed unless the change adds a FILE — a new
   skill inside the existing `inkwright.js`/`InkwrightStage.jsx`/`index.css` needs
   none.
8. Render from the chunked screen, passing `stage` into `SkillActivePanel`.

Point 8 is the leverage: `SkillActivePanel` is one component behind every skilling
screen already — checked directly for the 8-skill coverage proposal
(`docs/skill-animations-proposal.md`): `SkillingScreen`, `AgilityScreen`,
`ThievingScreen`, `HunterScreen`, `ConstructionScreen`, `SummoningScreen` and
`MagicScreen` all call it, so a stage added there covers many skills at once. Check
each screen that passes its own `icon` override before assuming it is uniform —
`GatherScreen` does.

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


## Inkwright — the monsters

`src/utils/monsterShapes.js` (pure geometry) + `src/utils/monsterFigures.js` (pure
classifier) + `src/components/MonsterFigure.jsx` + the `.inkm-*` CSS. Every monster,
boss and raid boss in the idle game is drawn as itself on the combat stage.

### The economics: 22 bodies, 119 monsters, 21 palettes

**The SHAPE is per archetype; the COLOUR is per monster.** A Green Dragon, a Red
Dragon and a King Black Dragon are one drawing in three palettes — which is not a
compromise, it is what they are. `utils/weaponShapes.js` made the identical call for
151 weapons across 12 shapes, and this file records why the per-item alternative was
built and reverted; a per-monster drawing set would be that mistake at eight times the
scale.

The 22 archetypes are drawn from what the bestiary actually contains, not from a
taxonomy: dragon, serpent, lizardman, beast, bovine, fowl, bird, arachnid, insect,
crab, kraken, orb, toad, humanoid, skeleton, husk, demon, imp, giant, wraith, golem,
treant. `public/monster-menagerie.html` (`npm run gen:monster-preview`, `--check` in
`npm run ci`) renders all of them from the shipped data — a hand-maintained second
copy of the geometry stops being a review page the first time someone edits one and
not the other.

### Authored facing +X, placed by one transform

Every body is authored in its OWN local frame: origin `(0,0)` at the ground under the
creature, `+X` the way it faces, `-Y` up. The stage places it with a single
`translate(FOOT_X, GROUND_Y) scale(s)`, so nothing in the geometry knows where the
floor is, how big it renders, or that the whole enemy side is mirrored. Author facing
+X and the mirror turns it toward the player for free — the same trick every weapon
and every shot on this stage already relies on.

### Groups exist for motion, not for anatomy

A body splits into `back` / `tail` / `body` / `arm` / `head` / `wing` / `fore`, and a
group exists only when something animates it on its own. That makes one failure mode
possible and it is the reason `tests/monsterShapes.test.ts` exists: an archetype
naming a motion whose group it does not draw compiles, renders, and shows a monster
standing perfectly still while its damage lands on the player. The test asserts every
motion an archetype can be asked for has a limb to move, and every joint names a group
that is drawn.

### Size is solved, not authored

An archetype declares how tall it stands relative to a person at normal weight
(`stature`), never how big its paths happen to be. `monsterFigureFor` solves the scale
against the drawing's own measured bounds, applies the combat-level weight class, then
clamps against all four walls of the stage. The clamp is load-bearing rather than a
safety rail: a colossal dragon wants more height than the frame has, and a creature
whose head is cropped is least readable in exactly the fight where reading it matters.
Because the size is solved, a body can be re-drawn at any convenient size without
anyone re-tuning a magic number to match.

### Weight changes the ATTACK, not only the size

From `huge` (combat level 200) up, a melee attack upgrades to the archetype's heavy
motion — `claw` becomes `slam`, `bite` becomes `maul` — and the heavy motions carry a
whole-body lurch on top of the limb. A level-6 wolf and a level-600 one share a body,
and the big one must not swing like the small one. Two rules fall out and both are
tested: only MELEE upgrades (a heavier creature does not fire a heavier arrow), and an
archetype with no heavier way to hit keeps its light motion at every size — a chicken
with a heavy attack would be the animation lying about the fight.

### Phase is readable off the creature

A multi-form boss's eyes take its current form's colour (melee red, ranged green,
magic blue — the colours the rest of the game already uses for the styles), and the
aura follows. It is deliberately the EYES: the one part of every archetype already
allowed to be bright, so no body needs a second palette. The form itself comes from
`monsterCombatSprite`, which already resolves it — reading `monster.attackStyle` here
would reintroduce the bug `.claude/rules/gameplay-engine.md` records for the open world.

### Taking a hit, and dying

A landed blow recoils whoever took it, derived in the renderer rather than plumbed
through a new event: `swingsFromCombatEvents` already reports `hit` per side. Knockback
is along the figure's own `-X`, which is away from the opponent on BOTH sides, so one
keyframe serves the player and the monster without a mirrored copy.

Death is per archetype — `topple`, `fall`, `crumble`, `dissipate`, `sink`, `sprawl` —
because a thing with no body cannot topple onto a floor and a pile of slabs does not
pitch forward. All six sit on `.inkc-fig` (the whole enemy side) so the shadow and the
aura go down with the creature, and all six hold their end pose under
`prefers-reduced-motion: reduce`: a monster that dies without appearing to has no
feedback at all.

### Idle

Nothing on this stage is ever completely still, because a monster holding a frozen
pose between swings reads as a picture of a monster. The breath is timed off
`--inkm-cycle`, the creature's OWN attack cadence, so a 2-tick monster visibly breathes
faster than an 8-tick one — an idle loop has no action to take its speed from, and a
constant there would be the one duration on this stage that stops telling the truth.
Constructs grind instead of breathing; anything held off the floor bobs; wings beat at
their own multiple of the cadence, because a wingbeat is not an attack.

### Traps, each one paid for

- **Colour is four custom properties on the figure, not a fill per part.** A 40-part
  creature is one inline style, and a palette swap is a data change rather than a
  stylesheet edit.
- **Stroked-vs-filled is read off the geometry, never declared.** Every filled shape
  is a circle, an ellipse, or a path closing with Z; every open path wants a stroke. A
  `stroked: true` flag beside the role would be a fact the drawing already states and
  free to contradict it.
- **A limb-weight stroke is drawn twice** (a wider ink pass under a narrower colour
  pass), exactly as `InkwrightFigure`'s `Limb` does for the player. The ink margin is
  1.6 in total and no more: wider was built and it swamps the limb, turning a creature
  made of legs into a cream tangle with no colour left in it.
- **A far-side limb needs its own outlined role** (`far`), not a fill of the shade
  tone. Un-outlined it reads as a slab of shadow behind the creature rather than the
  leg it is drawn as.
- **The static placement transform and any animation must live on different
  elements.** A static `transform` attribute and a CSS `animation` on one element
  cannot coexist — the animation silently wins and discards the placement, dropping
  every monster to the origin at full size the instant it moves. MonsterFigure nests
  four wrappers for exactly this reason (`.inkm-place` / `.inkm-idle` / `.inkm-hit` /
  `.inkm-fig`), and the recoil and the attack need separate keys as well as separate
  elements, or each replays the other.
- **Substring rules over ids misfire in ways nobody predicts.** "col-OSSU-s" read as
  bone and "th-REEF-ang" as a sea creature; both shipped once and both are pinned by a
  test. That is why the ARCHETYPE table is explicit — the name rules are the fallback
  for content added later, not the mechanism.
- **A word naming a WEAPON beats a word naming a ROLE.** "Zaryth Bolt Sentinel" is
  both, and read the other way round it draws a swordsman shooting at a player
  standing across the lane.
- **An armed monster's weapon must not be re-translated to the player's grip.**
  `CombatTool`'s `atGrip` is a stage constant; a monster's grip is its own archetype's,
  and MonsterFigure has already moved there.
- **Foliage paints from a token, not the palette.** A treant whose crown took
  `--inkm-shade` rendered a brown canopy — a tree in a coat rather than a tree. Same
  reasoning as the shared bone tone for horns.
