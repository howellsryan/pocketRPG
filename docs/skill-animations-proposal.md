# Skill animations — coverage proposal

Status: **proposal, not yet built.** Mining/woodcutting/fishing are shipped
(`docs/action-animations.md`); this is the plan for everything else. Nothing
in this doc is implemented — review, edit, approve, then we build off it.

## Where we start from

Two things make this cheaper than it looks:

1. **The timing law and the figure already exist.** `src/utils/inkwright.js` +
   `InkwrightStage.jsx` solve "how many strikes, how fast" from any action's
   tick cost and draw one reusable hooded figure. A new skill costs a motion
   row, a keyframe family, and a tool/prop shape — never a new character or a
   new timing system.
2. **Every skill screen already renders `SkillActivePanel`, and it already
   accepts a `stage` prop.** I checked all of them: `SkillingScreen` (mining,
   woodcutting, fishing, smithing, cooking, crafting, fletching, herblore,
   runecraft, firemaking, prayer), `AgilityScreen`, `ThievingScreen`,
   `HunterScreen`, `ConstructionScreen`, `SummoningScreen`, `MagicScreen` all
   call `<SkillActivePanel ... />`. Only `SkillingScreen` currently passes a
   `stage`. Every other screen is one wiring change away from showing a
   figure instead of the static orb — the plumbing is not the work, the
   **motion design** is.

**Farming and slayer are out of scope for this pass** (skipped per your call).
Dungeoneering folds into Tier B alongside agility below — its "clear floor"
actions are the same traversal shape as an obstacle course, just dressed as
a dungeon instead of a course.

## Tiering

### Tier A — strike a resource (exact same pattern as mining/woodcutting/fishing)

Wired exactly like today: a row in `INKWRIGHT_MOTIONS`, a skill→motion entry
in `SKILL_MOTIONS`, a `Tool()` shape, a `Prop()` whole/broken pair, all inside
`SkillingScreen`'s existing `inkPlan` wiring. No new figure behaviour, no new
component — just content for the system that already exists.

| Skill | Motion | Tool | Prop (whole → payoff) | Notes |
|---|---|---|---|---|
| **Firemaking** | `kindle` | Flint & steel | Unlit log pile → catches, flame prop | No `product` on most actions (burns logs for XP only) — payoff is the flame lighting, not an item popping. Where an action *does* have a product (e.g. future ash), the existing `product && broke` yield popup covers it for free. |
| **Cooking** | `cook` | Skewer/ladle | Raw food over a cookfire → cooked item | Fire prop can visually borrow firemaking's flame glyph so the two skills read as siblings. |
| **Smithing** | `smith` | Hammer | Bar glowing on an anvil → smithed item | Anvil is the stationary part of the prop (like the tree stump); the bar is what "breaks"/transforms. |
| **Crafting** | `craft` | Knife/needle | Hide, gem, or bar on a workbench → crafted item | One shape, tinted by material like the others — a knife for hides, a needle read is close enough it doesn't need two tools. |
| **Fletching** | `fletch` | Knife | Log/shaft on a shaving horse → shaft/bow/arrow | Arrow-batch actions (e.g. "Make bronze arrows (15)") still resolve to one action → one plan; the *strike count* already scales with tick cost, so a bigger batch naturally animates busier. |
| **Herblore** | `brew` | Pestle & mortar | Ingredients in a mortar → vial pops | The "strike" is a grinding twist rather than a downswing — same arm-rotation keyframe family, different rest angle. |
| **Runecraft** | `weave` | Bare hands (no tool drawn) | Essence at a rune altar → glowing rune | The one skill in this tier with no handheld tool — the "strike" becomes a two-hand channel gesture over the altar, essence dissolving into a rune shape on payoff. |
| **Prayer** | `commune` | None (bones/dust in hand) | Bones at a grave or the gilded altar → rune of light / dust scatters | Three sub-poses keyed off the action id prefix, same way `SkillingScreen` already branches on `action.id?.startsWith('altar_')`: **bury** (kneel, dig, place bones, pat earth), **altar** (kneel at the gilded altar, hands raised into a golden updraft), **scatter** (`scatter_gargoyle_dust` — stand, cast dust from an open hand in an arc). One motion family, three payoff variants — see open question 1. |

### Tier B — traversal (agility, dungeoneering)

Genuinely different from every other skill: the figure isn't striking a
static prop, it's **moving across the stage**. This is a new motion family
inside Inkwright (legs mid-stride + a step/leap arc instead of an arm
swing), but it reuses the exact same timing solve — an action's tick cost
divides into N traversal beats the same way a rock divides into N strikes,
just renamed (`TARGET_TRAVERSAL_MS` alongside `TARGET_STRIKE_MS`). One
motion family, two prop/payoff dressings:

- **Agility** — prop is a short obstacle silhouette (wall, gap, rope swing —
  one generic shape, not per-obstacle art, matching the "one prop shape per
  skill" economy mining/fishing/woodcutting already use). Motion: figure
  runs, then a leap keyframe (knees tuck, arms pump) timed to land past the
  obstacle — one obstacle cleared per beat. Payoff: landing pose + the
  coin/XP pop agility already tracks (`agility.totalLaps`), on lap
  completion rather than per obstacle.
- **Dungeoneering** — prop is a dungeon doorway/corridor silhouette instead
  of an obstacle. Motion: a walk/advance step (no leap — descending into a
  dungeon reads as exploring, not vaulting) toward the doorway, which swings
  open on the beat — one room advanced per beat. Only `dungeoneering_floor_*`
  actions (the ticking "clear floor" actions) get this; `unlock_*` reward
  actions are an instant token spend with no ticking loop to animate, same
  as today. Payoff: doorway open pose + the dungeoneering token pop on
  floor completion, mirroring agility's lap pop but with tokens instead of
  coins.

### Tier C — interact with a subject that reacts (thieving)

Reuses a trick combat already proved: **mirror the actor's own rig,
recoloured**, for the NPC being pickpocketed — no new character art, same as
the combat enemy.

- **Prop**: the mirrored NPC figure standing still (facing away/distracted).
- **Motion**: player figure reaches in with a quick hand-dip, withdraws with
  the loot.
- **Payoff**: coin/item pop, NPC unchanged (still unaware) — the loop just
  replays. See open question 2 on whether a "noticed" fail state is worth a
  second pose for v1.

### Tier D — set a device and wait (hunter)

Structurally the closest existing shape is **fishing's idle-then-catch
pattern** (a roaming prey silhouette near a trap, waiting), not
mining/woodcutting's continuous strike:

- **Motion**: one "set" beat at the start (kneel, place trap), then the
  figure stands by while the prop sits armed.
- **Prop**: trap, armed → sprung, with the catch (bespoke small-creature
  silhouette, same "borrow the item's own art" trick fishing uses for fish)
  breaking free on payoff.

### Tier E — build at a bench (construction)

Nearly a reskin of Tier A's smithing: hammer at a piece of furniture on a
workbench/scaffold. The one difference is the prop **persists and visually
upgrades** across repeated actions rather than being consumed and respawning
identical — a furniture piece leveling up, not a rock respawning.

### Tier F — charge / infuse (summoning)

Closest to runecraft's channel gesture: figure kneels over a pouch/shard,
two-hand charging motion, pouch glows on the payoff beat. Cheapest version
pops the product's ordinary `GameIcon` like every other skill; open question
3 is whether a small familiar-silhouette pop is worth the extra art for this
one skill.

### Tier G — cast a utility spell (magic, non-combat)

The cheapest tier by far: **the casting motion already exists** —
`InkwrightCombatStage`'s mage staff-charge-and-release is drawn today for
combat magic. This tier is that same motion, solo, aimed at a static target
prop instead of a mirrored enemy — a rune circle for teleports, a pedestal
for alchemy. No new weapon art, just a new target prop and dropping the
enemy-mirror half of the combat stage.

## Suggested build order

1. **Tier A (8 skills)** — firemaking, cooking, smithing, crafting,
   fletching, herblore, runecraft, prayer. Pure content on the existing
   system, matches what `docs/action-animations.md` already flagged as
   "next," lowest risk.
2. **Tiers E and G (construction, magic)** — new wiring (pass `stage` into a
   new screen) but reuse Tier A/combat motion primitives almost unchanged.
3. **Tier D (hunter)** — reuses fishing's idle/catch shape.
4. **Tier B (agility, dungeoneering)** — new traversal motion family, shared
   by both skills once built.
5. **Tiers C and F (thieving, summoning)** — the remaining new motion
   families, most design + CSS work.

## Open questions

1. **Prayer**: one `commune` motion with three payoff poses (bury / altar /
   scatter), or three fully separate motions? The three-poses approach is
   cheaper and keeps prayer as one row in `SKILL_MOTIONS`.
2. **Thieving**: ship success-only for v1 (loop replays, no fail pose), or is
   a distinct "noticed" stumble/flash worth building now?
3. **Summoning**: plain `GameIcon` payoff (consistent, cheap) or a small
   familiar-silhouette pop (nicer, more art)?
4. **Dungeoneering**: is sharing the traversal motion family with agility
   (same run/step rig, different prop and payoff) the right amount of reuse,
   or should it feel more distinct given it's a signature skill?
5. **Build order**: does the phase order above work, or is there a skill
   you'd rather see first (e.g. prayer, since it prompted this)?
