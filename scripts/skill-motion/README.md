# Skill motion authoring

The approved faceted human is shared by 56 method families. The runtime covers
339 recurring actions across 18 skills, plus planting and harvesting 29 Farming
crops. Combat and world character animation are separate systems.

`rig.js` owns the human. `author.js` owns the remaining methods and environments.
`mining-author.js` preserves the approved Mining study. `palette.js` reads fixed
`--ink-*` material tokens from `src/index.css`. The authoring pages use the
repository’s vendored Three.js; the game has no new dependency or live WebGL.

From the repository root, with Python Playwright, Chromium, Pillow and NumPy
available:

```sh
python3 scripts/skill-motion/check.py
python3 scripts/skill-motion/bake.py
python3 scripts/skill-motion/bake.py mine-pick mine-hands
```

The checker samples 160 poses per family. It checks fixed arm/leg lengths,
planted feet, shaft and forearm clearance against the actual head/neck/torso
surfaces, and exact working-tip contact for striking methods. It writes
`.tmp/skill-motion-clearance.json`. These checks complement visual inspection;
they do not prove every mesh is free of every possible collision.

The baker writes 24-frame atlases and RGB material masks to `public/skill-motion`.
Frames are 200×128, laid out in six columns. It also writes a contact sheet and
pose metrics under `.tmp`. Red is tool metal, green is the worked resource, and
blue is the Mining boulder. The runtime only uses the boulder mask for clay and
rune essence. Keep native stills in sync with frame 18 of each atlas.

To build the standalone gallery using the production component:

```sh
npm run build:css
node scripts/skill-motion/build-review.mjs
```

Serve `.tmp/skill-motion-review` after copying `public/skill-motion` to its
`skill-motion` directory, `public/forge` to `public/forge`, and the self-hosted
review fonts to `fonts`, then run `python3 scripts/skill-motion/check-review.py`
for catalogue, reward, pause/visibility, reduced-motion and mobile checks.
The published study additionally links the approved
Mining comparison and a source archive. The gallery uses sample engine outcomes
and never modifies an account. Farming’s 1.2-second gesture is presentation only.

Runtime ownership: `src/utils/skillMotion.js` selects methods and advances the
presentation clock; `SkillMotionStage.jsx` loads, tints and paints assets;
`inkwrightPlan` supplies cadence; screens pass real tools and awarded batches.
The decoded source-image cache retains four entries. A mounted stage also owns
its active tinted atlas. Atlas loading falls back to the existing static SVG
where available. New completions display actual items; mounting or changing an
action never replays an old reward. Hidden and paused stages stop drawing, and
reduced motion shows a static pose.

Before committing runtime changes, run the repository’s `npm run ci` gate.
