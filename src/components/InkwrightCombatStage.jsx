import { useRef } from 'preact/hooks'
import InkwrightFigure, { Limb } from './InkwrightFigure.jsx'
import { HitSplatLayer } from './HitSplat.jsx'

/**
 * Inkwright's combat presentation: two figures facing each other — the
 * player armed per combat style, the enemy a generic mirror of the same rig
 * for now (CLAUDE.md's action-animation skill covers per-monster art as
 * future work) — instead of ActionSpriteStage's tool-glyph lane.
 *
 * SAME PROPS AS ActionSpriteStage, on purpose: this is a drop-in swap at
 * both call sites (CombatScreen.jsx, CoopBossScreen.jsx). Nothing about the
 * event-to-swing contract changes — swingsFromCombatEvents/
 * swingsFromCoopEvents, playerCombatSprite, monsterCombatSprite all stay
 * exactly as they are in utils/actionSprites.js. Only the renderer differs.
 *
 * THE TIMING LAW IS DELIBERATELY THE OPPOSITE OF SKILLING'S, and that is not
 * a bug to reconcile — it is two different real cadences. A skilling action
 * is many strikes at a near-constant tempo ending in one yield (utils/
 * inkwright.js), because a longer action is a TOUGHER resource, not a
 * SLOWER worker. A combat cycle is exactly one swing (utils/actionSprites.js
 * `swingDurationMs`), because a slower weapon must visibly swing slower —
 * the animation's speed IS the weapon's own speed. Reapplying the skilling
 * law here would show a godsword swinging at the same tempo as a dagger,
 * which is precisely the thing that law exists to prevent on the OTHER
 * side of this system.
 *
 * Mirroring: the enemy is the exact same geometry as the player, wrapped in
 * `translate(STAGE_W,0) scale(-1,1)` — a full-canvas flip, not a per-figure
 * one — so every local coordinate (shoulder pivot, weapon tip, projectile
 * path) is authored ONCE and read correctly on both sides. transform-origin
 * is evaluated in an element's own local space before its own transform, so
 * `.inkc-arm`'s pivot works unchanged inside the mirrored group.
 *
 * Every duration is the inline `--inkc-dur` custom property, sourced from
 * `swingMs` — a literal in `.inkc-*` CSS is the failure this system exists
 * to prevent, same as ActionSpriteStage's `--as-dur`.
 *
 * Props (identical shape to ActionSpriteStage, plus the additions below):
 *   actor       — { motion: 'melee'|'ranged'|'magic', swingMs, accent } — NOTE this
 *                 also carries a `tool` field (ACTION_SPRITES' old glyph key, e.g.
 *                 'sword'/'bow'/'staff') that this component must NOT read; `motion`
 *                 is the one that names both the CSS keyframe family and CombatTool's
 *                 branch. Reading `.tool` here compiles fine and is silently wrong —
 *                 it renders every style as melee, since 'bow'/'staff' match neither
 *                 CombatTool's 'ranged'/'magic' check and fall through to its default.
 *   target      — { accent, sprite?, dying? } — sprite present means it acts back;
 *                 dying plays the collapse animation and holds its end pose
 *   actorSwing  — swing token (utils/actionSprites.js) or null; a new `id` replays
 *   targetSwing — same, for the target's own strike
 *   actorHp     — { current, max } for the small bar above the actor's head, or null
 *   targetHp    — same, for the bar above the target's head
 *   actorSplats — hit splats (utils/hitSplats.js) that land ON the actor — damage
 *                 the actor took, anchored over their own torso
 *   targetSplats— same, for splats landing on the target
 *   resetKey    — anything that changes exactly when a NEW fight starts (a new
 *                 monster, not a mid-fight re-render). Clears the frozen swing
 *                 state below so the last motion/tool of a monster that just
 *                 died can never bleed a frame into the next one's first swing.
 *                 Omit (stays null) for a caller with no such boundary — CoopBossScreen
 *                 doesn't restart the same way a solo auto-fight does.
 *   showCorners — mobile-HUD-only: renders "current/max" text in the stage's
 *                 top-left (actor HP + Prayer) and top-right (target HP)
 *                 corners, replacing the bar block the mobile HUD used to show
 *                 below the stage. Both desktop CombatScreen callers must
 *                 leave this false/omitted — it shares actorHp/targetHp with
 *                 the mini bars above each head rather than taking its own copy.
 *   actorPrayer — { current, max } for the corner's Prayer line, or null to
 *                 omit it (no prayer pool this fight). Ignored unless showCorners.
 *   label       — accessible description
 */
const STAGE_W = 260
// Torso anchor, shared by the hit-splat overlay and the magic bolt's landing
// point — the same coordinate both draws to, or the flash and the impact
// visually disagree about where the hit landed.
const TORSO_CX = 76
const TORSO_CY = 68
// CombatShot is authored once in the ACTOR's own unmirrored space (see its
// own comment below) and travels from the orb/hand at local (106,34) to the
// OPPONENT's torso — which, in that same unmirrored space, sits at
// STAGE_W - TORSO_CX (the mirror puts the target's local TORSO_CX there).
// The same dx/dy is reused for the enemy's own outgoing shot: its whole side
// is already wrapped in the mirror transform, so it lands on the actor's
// torso for free.
const SHOT_ORIGIN_X = 106
const SHOT_ORIGIN_Y = 34
const SHOT_DX = (STAGE_W - TORSO_CX) - SHOT_ORIGIN_X
const SHOT_DY = TORSO_CY - SHOT_ORIGIN_Y

export default function InkwrightCombatStage({
  actor, target, actorSwing = null, targetSwing = null,
  actorHp = null, targetHp = null, actorSplats = null, targetSplats = null,
  resetKey = null, showCorners = false, actorPrayer = null, label = 'Combat',
}) {
  // Hooks run every render, before the early return.
  const frozen = useRef({})
  const resetTag = useRef(resetKey)
  if (!actor || !target) return null

  // A new fight is a hard boundary, not something the swing-id freeze below
  // should ever bridge — without this, the last swing's frozen motion/tool
  // (the dead monster's) can still be what the FIRST swing token of the next
  // monster's fight renders, for exactly one frame, because that freeze only
  // updates when a swing id changes, and swing ids don't know a fight ended.
  if (resetTag.current !== resetKey) {
    resetTag.current = resetKey
    frozen.current = {}
  }

  const targetSprite = target.sprite || null
  const dying = !!target.dying
  const f = frozen.current
  // Frozen WITH the motion, not just the timing — a bow playing the melee
  // keyframes, or the enemy's motion appearing on the player's own arm for a
  // beat, is worse than a beat of latency. Same invariant as
  // ActionSpriteStage, restated here because it is a general truth about
  // CSS-animation-keyed-by-mount, not specific to that renderer.
  if (actorSwing && f.actorId !== actorSwing.id) { f.actorId = actorSwing.id; f.actor = { ...actor } }
  if (targetSwing && targetSprite && f.targetId !== targetSwing.id) { f.targetId = targetSwing.id; f.target = { ...targetSprite } }
  const a = actorSwing && f.actor ? f.actor : actor
  const t = targetSwing && f.target ? f.target : (targetSprite || {})

  // A dying target holds still for its collapse — it neither keeps swinging
  // nor stays armed, the same way a dropped weapon doesn't ride a corpse down.
  const targetSwinging = !dying && !!targetSwing && !!targetSprite

  return (
    <div class="inkc-stage" role="img" aria-label={label}>
      <svg class="inkc-svg" viewBox={`0 0 ${STAGE_W} 128`} aria-hidden="true">
        <path class="ink-ground" d={`M12 108 H${STAGE_W - 12}`} />
        <ellipse class="ink-shadow" cx="76" cy="108" rx="21" ry="3.2" />
        <ellipse class="ink-shadow" cx={STAGE_W - 76} cy="108" rx="21" ry="3.2" />

        {/* Actor: native orientation, facing right into the lane. */}
        <g class="inkc-side">
          <MiniHpBar cx={TORSO_CX} hp={actorHp} />
          <g
            key={`a${actorSwing ? actorSwing.id : 0}`}
            class={`inkc-fig${actorSwing ? ` inkc-fig--${a.motion} is-swinging` : ''}`}
            style={{ '--inkc-dur': `${a.swingMs}ms` }}
          >
            <InkwrightFigure>
              <g class="inkc-arm">
                <Limb d="M84 58 L94 62 L100 64" w={11} />
                <CombatTool kind={a.motion} accent={a.accent} />
              </g>
            </InkwrightFigure>
            {actorSwing && <CombatShot kind={a.motion} dx={SHOT_DX} dy={SHOT_DY} accent={a.accent} />}
          </g>
        </g>

        {/* Enemy: the SAME figure and the SAME tool geometry, mirrored across
            the whole canvas so every local coordinate above stays correct. */}
        <g class="inkc-side" transform={`translate(${STAGE_W},0) scale(-1,1)`}>
          <MiniHpBar cx={TORSO_CX} hp={targetHp} />
          <g
            key={`t${targetSwing ? targetSwing.id : 0}`}
            class={`inkc-fig${targetSwinging ? ` inkc-fig--${t.motion} is-swinging enemy` : ' enemy'}${dying ? ' is-dying' : ''}`}
            style={{ '--inkc-dur': `${targetSwinging ? t.swingMs : (a.swingMs || 600)}ms`, '--inkc-accent': target.accent || 'var(--color-blood-ember)' }}
          >
            <InkwrightFigure>
              <g class="inkc-arm">
                <Limb d="M84 58 L94 62 L100 64" w={11} />
                {/* Always armed while alive, matching the player — `t` already
                    falls back to the live (not-yet-swung) sprite, so its tool
                    is known before the first swing token ever arrives. Gating
                    this on `targetSwinging` made the enemy's weapon flicker in
                    and out of existence between swings instead of staying
                    drawn. Dying drops it instead — a corpse doesn't stay armed. */}
                {t.motion && !dying && <CombatTool kind={t.motion} accent={target.accent} />}
              </g>
            </InkwrightFigure>
            {targetSwinging && <CombatShot kind={t.motion} dx={SHOT_DX} dy={SHOT_DY} accent={target.accent} />}
          </g>
        </g>
      </svg>

      {/* Hit splats land ON the combatant they struck, not in a separate HP
          block below the stage — anchored over the same torso point the
          magic bolt above flies to, so the flash and the impact agree. */}
      <div class="inkc-splat inkc-splat--actor" aria-hidden="true"><HitSplatLayer splats={actorSplats} /></div>
      <div class="inkc-splat inkc-splat--target" aria-hidden="true"><HitSplatLayer splats={targetSplats} /></div>

      {/* Mobile-HUD-only corner readout — replaces the Prayer bar block that
          used to sit below the whole stage. Desktop's 3-pane layout keeps its
          own separate bars and never sets showCorners. */}
      {showCorners && (
        <div class="inkc-corner inkc-corner--actor" aria-hidden="true">
          <CornerStat hp={actorHp} />
          {actorPrayer && <div class="inkc-corner__prayer">{Math.ceil(actorPrayer.current || 0)}/{actorPrayer.max}</div>}
        </div>
      )}
      {showCorners && (
        <div class="inkc-corner inkc-corner--target" aria-hidden="true">
          <CornerStat hp={targetHp} />
        </div>
      )}
    </div>
  )
}

/** Green above half, yellow above a quarter, red below — the one HP ramp this
 * whole stage uses, shared by MiniHpBar (the bar above a head) and CornerStat
 * (the "current/max" text in a mobile-HUD corner) so the two can never
 * disagree about what colour a given HP fraction reads as. */
function hpRampColor(pct) {
  return pct > 0.5 ? 'var(--color-hp-green)' : pct > 0.25 ? 'var(--color-hp-yellow)' : 'var(--color-hp-red)'
}

/** The corner's HP line — same "current/max" shape and the same colour ramp
 * as the mini bar above the head it belongs to, just legible as text instead
 * of a sliver too small to hold a number. Renders nothing without HP data,
 * same as MiniHpBar, rather than a permanent "0/0". */
function CornerStat({ hp }) {
  if (!hp || !(Number(hp.max) > 0)) return null
  const pct = Math.max(0, Math.min(1, Number(hp.current || 0) / Number(hp.max)))
  return (
    <div class="inkc-corner__hp" style={{ color: hpRampColor(pct) }}>
      {Math.max(0, Math.round(hp.current || 0))}/{hp.max}
    </div>
  )
}

/** A small bar above the combatant's own head — cx is in the FIGURE's local
 * space, so it mirrors for free with everything else in the enemy's group.
 * Deliberately no numeric readout: the space above a 128-tall stage figure is
 * too tight for text to stay legible, and the colour ramp (same thresholds as
 * HPBar.jsx) already says what a player needs mid-swing. Renders nothing for
 * a side that hasn't been given HP yet, rather than a bar frozen at 0. */
function MiniHpBar({ cx, hp }) {
  if (!hp || !(Number(hp.max) > 0)) return null
  const pct = Math.max(0, Math.min(1, Number(hp.current || 0) / Number(hp.max)))
  const w = 46
  // NOT `h` — the single-file build's classic script scope uses `h` as the
  // JSX pragma (Preact's hyperscript), and a local `h` here shadows it. Vite's
  // dev build never surfaces this (automatic JSX runtime, no bare `h` in
  // scope), so it only breaks in the production single-file bundle: minified,
  // every `h(...)` call in this function silently resolves to this number
  // instead of Preact's createElement, throwing "h2 is not a function" (or
  // whatever the minifier renamed the shadowed local to) the instant a fight
  // tries to render it.
  const barH = 5
  const x = cx - w / 2
  const color = hpRampColor(pct)
  return (
    <g class="inkc-hpbar">
      <rect class="inkc-hpbar__track" x={x} y="6" width={w} height={barH} rx="2.4" />
      {pct > 0 && <rect x={x} y="6" width={w * pct} height={barH} rx="2.4" style={{ fill: color }} />}
    </g>
  )
}

/** Every weapon shaft passes through the hand at (100,64), same rule as the
 * skilling tools — a weapon that doesn't touch the grip reads as floating
 * alongside the arm rather than held in it. `accent` tints only the
 * projectile-adjacent bits (bowstring glow, orb) — the weapon body itself
 * stays flat ink/cloth like everything else Inkwright draws; a fully
 * accent-coloured weapon would be the one non-ink object on the whole stage. */
function CombatTool({ kind, accent }) {
  if (kind === 'ranged') {
    return (
      <g>
        <path class="ink-shaft ink-shaft--thin" d="M92 40 Q100 64 92 88" fill="none" />
        <path class="inkc-bowstring" d="M92 40 L100 64 L92 88" style={accent ? { stroke: accent } : undefined} />
        <path class="ink-grip" d="M96 68 L104 64" />
      </g>
    )
  }
  if (kind === 'magic') {
    return (
      <g>
        <path class="ink-shaft" d="M92 74 L106 38" />
        <circle class="inkc-orb" cx="106" cy="34" r="6" style={accent ? { fill: accent } : undefined} />
        <path class="ink-grip" d="M96 68 L104 64" />
      </g>
    )
  }
  // Melee — a straight blade with a crossguard, the plainest read at range.
  return (
    <g>
      <path class="ink-shaft" d="M96 66 L128 40" />
      <path class="inkc-crossguard" d="M108 57 L118 47" />
      <path class="ink-grip" d="M96 68 L104 64" />
    </g>
  )
}

/** The thing that crosses the lane: an arrow for ranged, a bolt for magic,
 * nothing for melee (which connects in reach, not at range). Authored in the
 * ACTOR's own local space and reused unchanged for the enemy's shot — the
 * enemy's wrapping mirror transform is what sends it the other way. */
function CombatShot({ kind, dx, dy, accent }) {
  if (kind === 'ranged') {
    return (
      <g class="inkc-shot inkc-shot--arrow" style={{ '--inkc-shot-dx': `${dx}px`, '--inkc-shot-dy': `${dy}px` }}>
        {/* Fletching, shaft, head — a projectile has to read at a glance mid-
            flight, so it is drawn bigger and bolder than the tool it left. */}
        <path d="M96 64 L94 60 M96 64 L94 68" />
        <path d="M96 64 L124 64" />
        <path d="M124 64 L116 58 M124 64 L116 70" />
      </g>
    )
  }
  if (kind === 'magic') {
    return (
      <g class="inkc-shot inkc-shot--bolt" style={{ '--inkc-shot-dx': `${dx}px`, '--inkc-shot-dy': `${dy}px` }}>
        <circle class="inkc-bolt-trail" cx="106" cy="34" r="10" style={accent ? { fill: accent } : undefined} />
        <circle cx="106" cy="34" r="6" style={accent ? { fill: accent } : undefined} />
      </g>
    )
  }
  return null
}
