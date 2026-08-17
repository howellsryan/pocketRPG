import { useRef } from 'preact/hooks'
import InkwrightFigure, { Limb } from './InkwrightFigure.jsx'

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
 * Props (identical shape to ActionSpriteStage):
 *   actor       — { tool: motion key ('melee'|'ranged'|'magic'), swingMs, accent }
 *   target      — { accent, sprite? } — sprite present means it acts back
 *   actorSwing  — swing token (utils/actionSprites.js) or null; a new `id` replays
 *   targetSwing — same, for the target's own strike
 *   label       — accessible description
 */
const STAGE_W = 260

export default function InkwrightCombatStage({ actor, target, actorSwing = null, targetSwing = null, label = 'Combat' }) {
  // Hooks run every render, before the early return.
  const frozen = useRef({})
  if (!actor || !target) return null

  const targetSprite = target.sprite || null
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

  const targetSwinging = !!targetSwing && !!targetSprite
  // Named by WHO TAKES THE FLASH, not who swung — actorSwing landing hits the
  // enemy, targetSwing landing hits the player. The two read backwards from
  // each other on first glance, which is exactly why they're spelled out
  // instead of left as `actorStruck`/`targetStruck`.
  const enemyFlashes = !!actorSwing && actorSwing.hit
  const playerFlashes = !!targetSwing && targetSwing.hit

  return (
    <div class="inkc-stage" role="img" aria-label={label}>
      <svg class="inkc-svg" viewBox={`0 0 ${STAGE_W} 128`} aria-hidden="true">
        <path class="ink-ground" d={`M12 108 H${STAGE_W - 12}`} />
        <ellipse class="ink-shadow" cx="76" cy="108" rx="21" ry="3.2" />
        <ellipse class="ink-shadow" cx={STAGE_W - 76} cy="108" rx="21" ry="3.2" />

        {/* Actor: native orientation, facing right into the lane. */}
        <g class="inkc-side">
          <g
            key={`a${actorSwing ? actorSwing.id : 0}`}
            class={`inkc-fig${actorSwing ? ` inkc-fig--${a.tool} is-swinging` : ''}`}
            style={{ '--inkc-dur': `${a.swingMs}ms` }}
          >
            <InkwrightFigure>
              <g class="inkc-arm">
                <Limb d="M84 58 L94 62 L100 64" w={11} />
                <CombatTool kind={a.tool} accent={a.accent} />
              </g>
            </InkwrightFigure>
            {actorSwing && <CombatShot kind={a.tool} dx={76} dy={-6} accent={a.accent} />}
          </g>
          {playerFlashes && (
            <ellipse
              key={`ps${targetSwing.id}`}
              class="inkc-struck"
              cx="80" cy="60" rx="20" ry="30"
              style={{ '--inkc-hit-dur': `${t.swingMs || a.swingMs}ms` }}
            />
          )}
        </g>

        {/* Enemy: the SAME figure and the SAME tool geometry, mirrored across
            the whole canvas so every local coordinate above stays correct. */}
        <g class="inkc-side" transform={`translate(${STAGE_W},0) scale(-1,1)`}>
          <g
            key={`t${targetSwing ? targetSwing.id : 0}`}
            class={`inkc-fig${targetSwinging ? ` inkc-fig--${t.tool} is-swinging enemy` : ' enemy'}`}
            style={{ '--inkc-dur': `${targetSwinging ? t.swingMs : (a.swingMs || 600)}ms`, '--inkc-accent': target.accent || 'var(--color-blood-ember)' }}
          >
            <InkwrightFigure>
              <g class="inkc-arm">
                <Limb d="M84 58 L94 62 L100 64" w={11} />
                {/* Always armed, matching the player — `t` already falls back
                    to the live (not-yet-swung) sprite, so its tool is known
                    before the first swing token ever arrives. Gating this on
                    `targetSwinging` made the enemy's weapon flicker in and
                    out of existence between swings instead of staying drawn. */}
                {t.tool && <CombatTool kind={t.tool} accent={target.accent} />}
              </g>
            </InkwrightFigure>
            {targetSwinging && <CombatShot kind={t.tool} dx={76} dy={-6} accent={target.accent} />}
          </g>
          {enemyFlashes && (
            <ellipse
              key={`es${actorSwing.id}`}
              class="inkc-struck"
              cx="80" cy="60" rx="20" ry="30"
              style={{ '--inkc-hit-dur': `${a.swingMs}ms` }}
            />
          )}
        </g>
      </svg>
    </div>
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
