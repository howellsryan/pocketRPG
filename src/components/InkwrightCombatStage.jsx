import { useRef } from 'preact/hooks'
import InkwrightFigure, { Limb } from './InkwrightFigure.jsx'
import { HitSplatLayer } from './HitSplat.jsx'
import { isSmashWeaponType, isLungeWeaponType } from '../utils/actionSprites.js'

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
 *   actor       — { motion: 'melee'|'ranged'|'magic', swingMs, accent,
 *                 weaponIconType, weaponTint } — NOTE this also carries a
 *                 `tool` field (ACTION_SPRITES' old glyph key, e.g.
 *                 'sword'/'bow'/'staff') that this component must NOT read;
 *                 `motion` is the one that names both the CSS keyframe
 *                 family and CombatTool's fallback. Reading `.tool` here
 *                 compiles fine and is silently wrong — it renders every
 *                 style as melee, since 'bow'/'staff' match neither
 *                 CombatTool's 'ranged'/'magic' check and fall through to
 *                 its default. `weaponIconType`/`weaponTint` — one of
 *                 utils/actionSprites.js's ten `WEAPON_ICON_TYPES` and a
 *                 `getItemIconTint` colour, both already resolved onto the
 *                 sprite by `playerCombatSprite` — pick which of CombatTool's
 *                 hand-drawn shapes the actor's own weapon draws as and what
 *                 colour its material is. Both null/undefined for unarmed,
 *                 which falls back to the plain per-motion default. The enemy
 *                 side has no equivalent — it stays the generic mirrored rig
 *                 (CLAUDE.md's "per-monster art" is separate, deferred work).
 *   target      — { accent, sprite?, dying? } — sprite present means it acts back;
 *                 dying plays the collapse animation and holds its end pose
 *   actorSwing  — swing token (utils/actionSprites.js) or null; a new `id` replays
 *   targetSwing — same, for the target's own strike
 *   actorConsume— consume token (utils/actionSprites.js makeConsumeToken) or null;
 *                 a new `id` replays a one-shot hand-to-mouth gesture (eating food,
 *                 drinking a potion/brew). Actor-only — enemies don't eat, so there
 *                 is no targetConsume. Independent of actorSwing/motion: it plays
 *                 regardless of which weapon is equipped or whether a swing is
 *                 also in flight.
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
// Torso anchor, shared by the hit-splat overlay and each shot's landing
// point — the same coordinate every projectile draws to, or the flash and
// the impact visually disagree about where the hit landed.
const TORSO_CX = 76
const TORSO_CY = 68
// Each shot is authored once in the ACTOR's own unmirrored space (see
// CombatShot's own comment below) and travels from ITS OWN drawn origin to
// the OPPONENT's torso — which, in that same unmirrored space, sits at
// STAGE_W - TORSO_CX (the mirror puts the target's local TORSO_CX there).
// Every shot kind is drawn at a different point on the arm (the bow's
// arrowhead at the string, the crossbow's bolt at its own shorter string,
// the staff's orb above the hand), so each needs its OWN dx/dy computed from
// its OWN origin — reusing one pair for two of them sends the second to
// wherever the first's origin implies, which is not where it itself starts,
// and it lands short of the torso. The same dx/dy is reused for the enemy's
// own outgoing shot: its whole side is already wrapped in the mirror
// transform, so it lands on the actor's torso for free.
const ORB_ORIGIN_X = 106
const ORB_ORIGIN_Y = 34
const ORB_DX = (STAGE_W - TORSO_CX) - ORB_ORIGIN_X
const ORB_DY = TORSO_CY - ORB_ORIGIN_Y
// The arrowhead's drawn tip (see CombatShot's arrow path: "M124 64 L116 58 ...").
const ARROW_ORIGIN_X = 124
const ARROW_ORIGIN_Y = 64
const ARROW_DX = (STAGE_W - TORSO_CX) - ARROW_ORIGIN_X
const ARROW_DY = TORSO_CY - ARROW_ORIGIN_Y
// The bolt's drawn tip — shorter reach than the arrow's, fired from the
// crossbow's own prod rather than a hand-drawn bowstring (see CrossbowTool).
const BOLT_ORIGIN_X = 116
const BOLT_ORIGIN_Y = 64
const BOLT_DX = (STAGE_W - TORSO_CX) - BOLT_ORIGIN_X
const BOLT_DY = TORSO_CY - BOLT_ORIGIN_Y

/** Exported so the geometry bug this exists to prevent — reusing one
 * origin's offset for a different shot — can be caught without mounting the
 * component (tests/inkwrightCombatShot.test.ts). Melee has no shot.
 * `weaponIconType` only matters for 'ranged' — a crossbow fires a bolt from
 * its own shorter origin, everything else that fires an arrow shares the
 * bow's. */
export function shotOffset(kind, weaponIconType) {
  if (kind === 'ranged') return weaponIconType === 'crossbow' ? { dx: BOLT_DX, dy: BOLT_DY } : { dx: ARROW_DX, dy: ARROW_DY }
  if (kind === 'magic') return { dx: ORB_DX, dy: ORB_DY }
  return null
}

export default function InkwrightCombatStage({
  actor, target, actorSwing = null, targetSwing = null, actorConsume = null,
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

  // godsword/maul play a heavier two-handed smash, a rapier a fencer's lunge,
  // instead of the standard one-handed swing — melee only, since neither
  // weapon type occurs outside that motion. Mutually exclusive (a weapon has
  // exactly one WEAPON_ICON_TYPES entry), so at most one of these is ever on.
  const actorSmash = a.motion === 'melee' && isSmashWeaponType(a.weaponIconType)
  const actorLunge = a.motion === 'melee' && isLungeWeaponType(a.weaponIconType)
  const actorSwingVariant = actorSmash ? ' is-smash' : actorLunge ? ' is-lunge' : ''

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
            class={`inkc-fig${actorSwing ? ` inkc-fig--${a.motion}${actorSwingVariant} is-swinging` : ''}`}
            style={{ '--inkc-dur': `${a.swingMs}ms` }}
          >
            <InkwrightFigure>
              {/* Keyed independently of the swing wrapper above: an eat/drink
                  gesture can land on any tick, mid-swing-gap or not, and must
                  restart its own animation without waiting on or disturbing
                  the weapon swing's own key. While it plays, the item glyph
                  replaces the weapon — the arm rotates far enough toward the
                  head that the tool would otherwise appear to swing at it. */}
              <g
                key={`ae${actorConsume ? actorConsume.id : 0}`}
                class={`inkc-arm${actorConsume ? ' is-eating' : ''}`}
              >
                <Limb d="M84 58 L94 62 L100 64" w={11} />
                {actorConsume ? <CombatConsume /> : (
                  <CombatTool kind={a.motion} weaponIconType={a.weaponIconType} tint={a.weaponTint} accent={a.accent} />
                )}
              </g>
            </InkwrightFigure>
            {actorSwing && <CombatShot kind={a.motion} weaponIconType={a.weaponIconType} accent={a.accent} />}
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
            {targetSwinging && <CombatShot kind={t.motion} accent={target.accent} />}
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

/** Held at the grip (100,64) exactly like a weapon, so the gesture's own arm
 * rotation (`.inkc-arm.is-eating`, index.css) carries it toward the head for
 * free — swap-for-the-weapon rather than a whole extra limb, matching how
 * the enemy's own weapon is always-drawn-at-the-grip (CombatTool's doc). */
function CombatConsume() {
  return <circle class="inkc-consume" cx="100" cy="64" r="5" />
}

// One motion-keyed fallback shape per style, used for the enemy (which never
// carries a weaponIconType) and for the actor when unarmed. Matches what
// CombatTool drew before per-type shapes existed, so neither case regresses.
const DEFAULT_WEAPON_TYPE = { melee: 'sword', ranged: 'bow', magic: 'staff' }

/** Ten hand-drawn weapon shapes (utils/actionSprites.js `WEAPON_ICON_TYPES`),
 * one per TYPE rather than one per item — CLAUDE.md's "the stage shows the
 * style, not the item" is relaxed one notch, not reversed: a bronze scimitar
 * and a dragon scimitar are the same silhouette in different colours, told
 * apart only by `tint` (`getItemIconTint`, resolved onto the sprite by
 * playerCombatSprite). This replaces an earlier attempt at embedding the
 * actual bespoke inventory icon per item (reverted) — that icon set mixes
 * authoring conventions with no single anchor that lands all 151 of them
 * correctly, and a wrongly-anchored icon (a mace head over the wielder's own
 * face) is a far worse failure than a shape that's merely generic. Every
 * shaft/blade passes through the grip at (100,64), same rule as the skilling
 * tools and the old per-style shapes — a weapon that doesn't touch the grip
 * reads as floating alongside the arm rather than held in it. `accent` tints
 * only the projectile-adjacent bits (bowstring/prod glow, orb) — a style
 * cue, unrelated to the item's own material; `tint` colours the body/blade/
 * head, the item's own identity. The grip itself is never tinted (a leather
 * wrap reads the same regardless of blade metal). */
function CombatTool({ kind, weaponIconType, tint, accent }) {
  const type = weaponIconType || DEFAULT_WEAPON_TYPE[kind] || 'sword'
  const tintStroke = tint ? { stroke: tint } : undefined
  switch (type) {
    case 'scimitar': return (
      <g>
        {/* A filled crescent, not a stroked line — the curve has to bow AWAY
            from the cutting edge on the spine side and hook back at the tip,
            same silhouette as the game's own scimitar icon, or it just reads
            as a bent stick. */}
        <path
          d="M96 68 C 100 51 115 36 140 30 C 129 38 118 47 109 60 L 107 64 L 105 66 L 104 68 Z"
          style={{ fill: tint || 'var(--surface-raised)', stroke: 'var(--text-strong)', strokeWidth: 2.2, strokeLinejoin: 'round' }}
        />
        {/* A thin pale glint along the spine is what reads as "sharp" at this
            scale — a filled shape alone still reads as a blunt wedge. */}
        <path d="M99 52 C 111 41 125 34 137 31" fill="none" stroke="#fff" stroke-width="1.3" opacity="0.5" />
        <path class="inkc-crossguard" d="M91 65 L101 58" />
        <path class="ink-grip" d="M96 68 L104 64" />
      </g>
    )
    case 'rapier': return (
      <g>
        <path class="ink-shaft ink-shaft--thin" d="M98 65 L146 26" style={tintStroke} />
        {/* Swept hilt: a straight quillon plus a curved knuckle-bow looping
            back toward the pommel — a rapier reads as a rapier by its guard
            as much as its blade. Pushed clear of the fist (InkwrightFigure's
            drawn hand is a ~7-radius blob centred on the grip point) rather
            than centred on it, or the guard just disappears behind the hand. */}
        <path class="inkc-crossguard" d="M88 78 L106 55" />
        <path class="inkc-crossguard" d="M88 78 Q74 70 82 54" fill="none" />
        <circle cx="84" cy="80" r="3.6" fill="var(--text-strong)" />
        <path class="ink-grip" d="M96 70 L104 64" />
      </g>
    )
    case 'godsword': return (
      <g>
        {/* A broad, filled blade instead of a stroked line — a godsword reads
            as "big" or it just reads as a sword. */}
        <path
          d="M92 74 L104 63 L146 26 L152 33 L114 68 Z"
          style={{ fill: tint || 'var(--surface-raised)', stroke: 'var(--text-strong)', strokeWidth: 2.2, strokeLinejoin: 'round' }}
        />
        <path class="inkc-crossguard" d="M94 66 L108 56" />
        <path class="ink-grip" d="M92 74 L104 64" />
      </g>
    )
    case 'maul': return (
      <g>
        <path class="ink-shaft ink-shaft--thin" d="M96 68 L118 44" />
        {/* A flat-topped hexagon, not a ball — a round head is the mace's
            shape; the game's own maul icons are a blocky flanged hex head. */}
        <path
          d="M117 36 L139 36 L141 42 L139 48 L117 48 L115 42 Z"
          transform="rotate(-33 128 42)"
          style={{ fill: tint || 'var(--surface-raised)', stroke: 'var(--text-strong)', strokeWidth: 2.4, strokeLinejoin: 'round' }}
        />
        <circle cx="128" cy="42" r="3.4" transform="rotate(-33 128 42)" fill="var(--text-strong)" opacity="0.5" />
        <path class="ink-grip" d="M96 70 L106 64" />
      </g>
    )
    case 'mace': return (
      <g>
        <path class="ink-shaft ink-shaft--thin" d="M96 68 L116 52" />
        <circle cx="120" cy="48" r="7" style={{ fill: tint || 'var(--surface-raised)', stroke: 'var(--text-strong)', strokeWidth: 2 }} />
        <path d="M120 39 L122 44 M129 42 L125 46 M129 54 L124 51" stroke="var(--text-strong)" stroke-width="1.6" />
        <path class="ink-grip" d="M96 70 L104 64" />
      </g>
    )
    case 'bow': return (
      <g>
        <path class="ink-shaft ink-shaft--thin" d="M92 40 Q100 64 92 88" fill="none" style={tintStroke} />
        <path class="inkc-bowstring" d="M92 40 L100 64 L92 88" style={accent ? { stroke: accent } : undefined} />
        <path class="ink-grip" d="M96 68 L104 64" />
      </g>
    )
    case 'crossbow': return (
      <g>
        <path class="ink-shaft ink-shaft--thin" d="M92 66 L120 62" style={tintStroke} />
        <path class="ink-shaft ink-shaft--thin" d="M108 50 Q116 64 108 78" fill="none" style={tintStroke} />
        <path class="inkc-bowstring" d="M108 50 L114 64 L108 78" style={accent ? { stroke: accent } : undefined} />
        <path class="ink-grip" d="M96 68 L104 64" />
      </g>
    )
    case 'wand': return (
      <g>
        <path class="ink-shaft ink-shaft--thin" d="M96 70 L110 54" style={tintStroke} />
        <circle class="inkc-orb" cx="112" cy="50" r="4" style={accent ? { fill: accent } : undefined} />
        <path class="ink-grip" d="M96 70 L104 64" />
      </g>
    )
    case 'staff': return (
      <g>
        <path class="ink-shaft" d="M92 74 L106 38" style={tintStroke} />
        <circle class="inkc-orb" cx="106" cy="34" r="6" style={accent ? { fill: accent } : undefined} />
        <path class="ink-grip" d="M96 68 L104 64" />
      </g>
    )
    default: return (
      // sword — a straight blade with a crossguard, the plainest read at range.
      <g>
        <path class="ink-shaft" d="M96 66 L128 40" style={tintStroke} />
        <path class="inkc-crossguard" d="M108 57 L118 47" />
        <path class="ink-grip" d="M96 68 L104 64" />
      </g>
    )
  }
}

/** The thing that crosses the lane: an arrow for a bow, a short bolt for a
 * crossbow, a glowing orb for magic, nothing for melee (which connects in
 * reach, not at range). Authored in the ACTOR's own local space and reused
 * unchanged for the enemy's shot — the enemy's wrapping mirror transform is
 * what sends it the other way. Each kind travels its OWN dx/dy (see the
 * ORB_/ARROW_/BOLT_ constants above) because each is drawn from a different
 * origin on the arm. */
function CombatShot({ kind, weaponIconType, accent }) {
  const offset = shotOffset(kind, weaponIconType)
  if (!offset) return null
  if (kind === 'ranged' && weaponIconType === 'crossbow') {
    return (
      <g class="inkc-shot inkc-shot--crossbow" style={{ '--inkc-shot-dx': `${offset.dx}px`, '--inkc-shot-dy': `${offset.dy}px` }}>
        {/* Short and stubby next to the arrow — a bolt is a stouter dart,
            fired from a much shorter draw. Own class, not the magic orb's
            `inkc-shot--bolt` — same generic name, different animal, and the
            fly keyframe below is selected per class, not per kind. */}
        <path d="M108 64 L104 61 M108 64 L104 67" />
        <path d="M108 64 L116 64" />
        <path d="M116 64 L111 60 M116 64 L111 68" />
      </g>
    )
  }
  if (kind === 'ranged') {
    return (
      <g class="inkc-shot inkc-shot--arrow" style={{ '--inkc-shot-dx': `${offset.dx}px`, '--inkc-shot-dy': `${offset.dy}px` }}>
        {/* Fletching, shaft, head — a projectile has to read at a glance mid-
            flight, so it is drawn bigger and bolder than the tool it left. */}
        <path d="M96 64 L94 60 M96 64 L94 68" />
        <path d="M96 64 L124 64" />
        <path d="M124 64 L116 58 M124 64 L116 70" />
      </g>
    )
  }
  return (
    <g class="inkc-shot inkc-shot--bolt" style={{ '--inkc-shot-dx': `${offset.dx}px`, '--inkc-shot-dy': `${offset.dy}px` }}>
      <circle class="inkc-bolt-trail" cx="106" cy="34" r="10" style={accent ? { fill: accent } : undefined} />
      <circle cx="106" cy="34" r="6" style={accent ? { fill: accent } : undefined} />
    </g>
  )
}
