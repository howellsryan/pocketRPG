# Skill motion authoring

The approved faceted human is shared by 70 method families. The runtime covers
339 recurring actions across 18 skills, plus planting and harvesting 29 Farming
crops. Combat and world character animation are separate systems.

`rig.js` owns the human. `characters.js` owns distinct targets; `author.js` owns
the remaining methods and environments. Research and adaptation notes are in
`references.html`. The Thieving baseline stills are review-only comparisons.
`mining-author.js` preserves the approved Mining study. `palette.js` reads fixed
`--ink-*` material tokens from `src/index.css`. The authoring pages use the
repository’s vendored Three.js; the skilling runtime has no new dependency or
live WebGL.

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
Frames are 400×256, laid out in six columns, downsampled from 800×512 (600×384
for the unchanged Mining author). The game displays the same panel aspect ratio.
Native gallery panels are 200×128. It also writes a contact sheet and
pose metrics under `.tmp`. Red is tool metal, green is the worked resource, and
blue is the Mining boulder. The runtime only uses the boulder mask for clay and
rune essence. Thumbnail poses are chosen per method and exported at 200×128.
Disjoint exports can run concurrently with `--partition 0/3`, `1/3`, `2/3`;
each worker writes a separate report. Mining is exported separately as above.

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
The decoded source-image cache retains two entries (the current atlas and mask,
about 19.7 MB combined). Mounted stages tint only the visible frame in 400×256
buffers, rather than retaining one tinted atlas per Farming panel. Atlas loading
falls back to the existing static SVG
where available. New completions display actual items; mounting or changing an
action never replays an old reward. Hidden and paused stages stop drawing, and
reduced motion shows a static pose.

Thieving performs one pocket reach and recovery per action, then rests. Portable
spells perform a single cast. Fishing and traps use cast/set, wait and retrieve;
hammering and gathering keep their repeated working rhythm. All durations still
come from the caller's effective action plan.

Before committing runtime changes, run the repository’s `npm run ci` gate.
