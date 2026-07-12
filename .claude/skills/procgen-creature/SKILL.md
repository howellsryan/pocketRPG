---
name: procgen-creature
description: Use when authoring or editing procedural 3D creature specs in src/data/creatures3d.json - blend-shell monsters for the combat arena. Covers spec conventions, the 24-primitive budget, palette rules, rig field reference, shader gotchas, and the mandatory screenshot review via scripts/render-proc.mjs. Do not use for GLB/Tripo assets (threejs-3d-generator) or generic three.js work.
---

# procgen-creature: authoring blend-shell creatures

A creature is a JSON spec in `src/data/creatures3d.json` — a list of rounded-cone SDF primitives that render as one seamless skin, animated by a procedural rig (`src/3d/rigs.js`). No mesh files, no clips. Runtime: `src/3d/blendShell.js`; registry/validator: `src/3d/creatures.js`; design/history: `docs/procedural-3d-plan.md`.

**Never commit a spec you have not seen rendered.** Screenshot review is the whole quality gate — the validator only catches structural errors.

## Workflow

1. The registry key must be a real `src/data/monsters.json` id — `CombatScreen` resolves `getCreatureSpec(monster.id)` directly. A `monsters` entry in `equipmentModels.json` (GLB) wins per-monster; don't add a spec for a GLB monster unless deliberately replacing it.
2. Author the spec (reference below). Torso first with the biggest radii, then head chain, limbs, thin details, paint patches last.
3. Validate: `npx vitest run tests/creatures3d.test.ts` — every registry entry is auto-validated, no new test needed.
4. Render: `npm i --no-save playwright-core` (once per machine), then
   `node scripts/render-proc.mjs <monster_id>` → `proc-renders/<id>-{idle,attack,hit,death}.png` (gitignored). **Look at all four.**
5. Iterate. For live tweaking: `python3 -m http.server` from repo root, open `/docs/prototypes/proc-creature-harness.html?monster=<id>` (`__trigger('attack'|'hit'|'death'|'respawn')`, `__setTime`, `__measureFps`).
6. No build registration needed — the JSON is injected into the game chunk as `creatures3dData`. Commit gate is `npm run ci` as always.

## Judging the renders (DESIGN.md)

The target read is a **warm carved figurine on parchment** — ink outline, rim light, matte hide grain. Check:

- Silhouette readable at a glance; parts fused (no visible seams, no outline break-up inside the body).
- Markings read as painted patches, not haze; the palette warm (Warm Dark Rule: dark parts are warm browns like `#463225`, never cool gray). Cool hues only when identity demands it (frost creatures) and still desaturated.
- No Candy Rule: nothing oversaturated; one accent color max.
- All four states plausible: attack lunges toward +z, hit recoils, death ends grounded (keel-over / flatten per archetype).

## Spec reference (verified against src/3d/*.js)

```json
"marshfen_toad": {
  "height": 0.75,
  "archetype": "hopper",
  "palette": ["#7a8a4e", "#e3dab2", "#465232", "#e0b83f"],
  "parts": [
    { "id": "body", "a": [0, 0.32, -0.18], "b": [0, 0.38, 0.14], "r1": 0.28, "r2": 0.22, "color": 0, "blend": 0.16 },
    { "id": "belly", "a": [0, 0.24, -0.05], "b": [0, 0.26, 0.12], "r1": 0.2, "r2": 0.16, "color": 1, "colorOnly": true }
  ],
  "breathe": { "parts": ["body"], "amp": 0.05, "rate": 2.8 },
  "head": { "parts": ["head"], "anchor": [0, 0.4, 0.14], "amp": 0.07 }
}
```

**Authoring frame**: facing **+z**, feet near y=0, left = −x. The arena height-normalises the whole group to `height` (hero ≈ 1.8; bull 1.3, chicken 0.9, toad 0.75 — pick by relative size) and rotates by `rotationDeg` (default `[0,-90,0]` faces the hero).

**Parts** (max **24**, including patches): rounded cone from `a` (radius `r1`) to `b` (radius `r2`); `color` indexes `palette` (3–5 entries: base coat, marking, dark hooves/claws, accent); `blend` is the smooth-min radius to neighbours (default 0.1 — bigger fuses softer). Flags:
- `buried: true` — shapes the field but builds no proxy geometry (interior filler mass).
- `colorOnly: true` — paint patch: tints the skin (weighted ×3) without bulging it. Place its axis on the surface; per-pixel color means patches smaller than the mesh tessellation still render.

**Rig groups** (all optional; every referenced id must exist):
- `breathe { parts, amp 0.03–0.05, rate 1.6–2.8 }` — radius swell.
- `head { parts, anchor, amp 0.07–0.24 }` — organic sway about `anchor` (put it at the neck base). Include everything that rides the head: skull, muzzle/beak, horns, eye patches. Biped attack = head peck.
- `legs [{ part, foot? }]` — `part`'s `a` is the hip (rides the body), `b` the foot (stays planted; steps only when dragged past threshold). Author in **left/right pairs front-to-back**: gait groups assume it (quadruped diagonal pairs, biped alternating, 6+ tripod). `foot` (hoof/claw part) rides the plant rigidly. Keep foot `b` slightly above y=0 (~0.03).
- `ropes [{ parts, anchorTo?, gravity 2.2, sway 0.25, stiffness 0 }]` — verlet chain; list parts tip-ward, each part's `a` continuing the previous `b`. `stiffness` 0 = limp tail; 0.08–0.16 = ears/wattles that hold pose but jiggle. `anchorTo` makes the chain root ride another part (ears → `"head"`).
- `wings { parts, rate 7–10, amp 0.22–0.55 }` — flap about each part's `a`; side inferred from sign of `a.x`.
- `spine { parts front-to-back, amp ~0.05, wave 1.5, rate 2.2 }` — serpent lateral wave; `amp` is in **local units, not height-relative**.

**Archetypes** pick attack/death root motion: `quadruped`/`biped`/`multileg` (crouch-lunge; death keels over), `hopper` (idle hop + pounce, squash-stretch, needs no `legs`), `flyer` (hover; death falls then keels), `serpent` (coil-strike; death flattens).

## Gotchas (hard-won in Phase 2 — do not "fix" these)

- **Colors render exactly as authored**: palette hex reaches the shader with `THREE.NoColorSpace`. If a creature looks dark, change the hex — never add color-management conversion (default linearization made everything muddy).
- **Thin parts cap their own blend**: `k = min(blend, max(0.02, min(r1,r2)*1.4))`. Cranking `blend` on a horn does nothing — thin parts are meant to join crisply. If a *medium* part shows a crease at its joint, raise its radii overlap instead.
- **Slivers/outline poke-through at deep folds** are already suppressed (oscillation-damped projection + buried-vertex tuck). If you still see artifacts, the part is buried too deep or too thin — reshape it or mark it `buried`.
- Ropes clamp to y ≥ 0.015; planted feet ignore root motion by design (that's what keeps feet on the ground while the body lunges).
- Known debt (unfixed, don't chase in an authoring change): faint ink crease at leg-body joints in some poses; imp wings read spiky; serpent is the weakest archetype read.
