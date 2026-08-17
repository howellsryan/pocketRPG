import { useRef } from 'preact/hooks'
import InkwrightFigure, { Limb } from './InkwrightFigure.jsx'
import { HitSplatLayer } from './HitSplat.jsx'
import { isSmashWeaponType, isLungeWeaponType } from '../utils/actionSprites.js'
import { weaponShapeFor, weaponMuzzle, partStrokeWidth, TINTED_FILL_ROLES, TINTED_STROKE_ROLES, GRIP_X, GRIP_Y } from '../utils/weaponShapes.js'

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

/** Exported so the geometry bug this exists to prevent — reusing one origin's
 * offset for a different shot — can be caught without mounting the component
 * (tests/inkwrightCombatShot.test.ts). Melee has no shot.
 *
 * Each shot is authored once in the ACTOR's own unmirrored space and travels
 * from ITS OWN drawn muzzle to the OPPONENT's torso — which, in that same
 * space, sits at STAGE_W - TORSO_CX (the mirror puts the target's local
 * TORSO_CX there). The same dx/dy is reused for the enemy's outgoing shot:
 * its whole side is already inside the mirror transform, so it lands on the
 * actor's torso for free.
 *
 * The muzzle comes from the weapon's own geometry (weaponMuzzle) rather than
 * one constant per shot KIND. Per-kind constants were only ever right for one
 * member of a kind: a shortbow's string sits at half a longbow's reach and a
 * wand's gem nowhere near a staff's orb, so both would have fired from a
 * point they are not drawn at and landed short of the torso. */
export function shotOffset(kind, weaponIconType) {
  if (kind !== 'ranged' && kind !== 'magic') return null
  const muzzle = weaponMuzzle(weaponIconType, kind)
  if (!muzzle) return null
  return { dx: (STAGE_W - TORSO_CX) - muzzle.x, dy: TORSO_CY - muzzle.y }
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

/** Twelve hand-drawn weapon profiles (utils/weaponShapes.js), one per TYPE
 * rather than one per item — CLAUDE.md's "the stage shows the style, not the
 * item" is relaxed one notch, not reversed: a bronze scimitar and a dragon
 * scimitar are the same silhouette in different colours, told apart only by
 * `tint` (`getItemIconTint`, resolved onto the sprite by playerCombatSprite).
 * This replaces an earlier attempt at embedding the actual bespoke inventory
 * icon per item (reverted) — that icon set mixes authoring conventions with no
 * single anchor that lands all 151 of them correctly, and a wrongly-anchored
 * icon (a mace head over the wielder's own face) is a far worse failure than a
 * shape that's merely generic.
 *
 * This component is only the MAPPER. Every path lives in weaponShapes.js,
 * authored in the weapon's own local frame (origin at the hand, +X toward the
 * tip) and placed here by one transform — which is what made real profiles
 * drawable at all, since geometry authored directly in stage coordinates has
 * to be pre-rotated ~40deg by hand.
 *
 * `accent` tints only the projectile-adjacent bits (bowstring/prod glow, orb)
 * — a style cue, unrelated to the item's own material. `tint` colours the
 * blade/head, the item's own identity. NOTHING ELSE takes the tint: guards,
 * hafts and grips paint from fixed tokens, because `getItemIconTint` legally
 * returns `var(--tier-dragon)` for some items and deriving a second colour
 * from a CSS variable is not something a component can do.
 */
function CombatTool({ kind, weaponIconType, tint, accent }) {
  const shape = weaponShapeFor(weaponIconType, kind)
  // A scaled copy (shortbow, dagger) rides one transform, and every stroke
  // width is divided back out by that scale: an SVG transform scales stroke
  // too, so a half-size weapon would carry a half-weight outline and read as
  // a wisp beside a figure drawn at full weight. One outline weight for the
  // whole figure is the defining constraint of this style (src/index.css).
  const s = shape.scale || 1
  const placement = `translate(${GRIP_X} ${GRIP_Y}) rotate(${shape.angle})${s === 1 ? '' : ` scale(${s})`}`
  return (
    <g transform={placement}>
      {shape.parts.map((part, i) => (
        <WeaponPart key={i} part={part} scale={s} tint={tint} accent={accent} />
      ))}
    </g>
  )
}

const ANIM_HOOK_CLASS = { orb: 'inkc-orb', bowstring: 'inkc-bowstring' }

/** One drawn part. `role` picks the paint (`.inkc-w-*` in index.css); only
 * the blade takes the item's tint and only the orb/string take the accent,
 * so a new role can never accidentally become tintable. */
function WeaponPart({ part, scale, tint, accent }) {
  const [tag, geom, role, sw, extra] = part
  const style = {}
  // EVERY stroked part gets an explicit width, not just the ones that name
  // their own: a part left to inherit a stylesheet width is one the scale
  // compensation never reaches, which is how a dagger ends up outlined at
  // half the weight of the hand holding it (partStrokeWidth).
  const width = partStrokeWidth(part, scale)
  if (width) style.strokeWidth = width
  // Tintable roles are declared in weaponShapes.js, not branched on here: a
  // new part that should carry the item's colour is a data change, and a bow
  // whose limbs are its only metal is not a special case in the renderer.
  if (tint && TINTED_FILL_ROLES.has(role)) style.fill = tint
  if (tint && TINTED_STROKE_ROLES.has(role)) style.stroke = tint
  if (role === 'orb' && accent) style.fill = accent
  // The draw animation scales off this rather than hard-coding a width, so a
  // shortbow's thinner string still thickens instead of snapping to the
  // longbow's gauge (index.css inkcStringDraw).
  if (role === 'bowstring') {
    style['--inkc-string-w'] = `${width}px`
    if (accent) style.stroke = accent
  }
  // Two roles are also ANIMATION HOOKS, not just paints: index.css animates
  // `.inkc-orb` through the charge (inkcOrbCharge) and `.inkc-bowstring`
  // through the draw (inkcStringDraw), selecting on those exact class names.
  // Renaming them to the `.inkc-w-*` scheme without keeping the originals
  // compiles, renders, and silently deletes both animations.
  const hook = ANIM_HOOK_CLASS[role]
  const props = { class: hook ? `inkc-w-${role} ${hook}` : `inkc-w-${role}`, style, ...extra }
  if (tag === 'path') return <path d={geom} {...props} />
  if (tag === 'circle') return <circle cx={geom.cx} cy={geom.cy} r={geom.r} {...props} />
  return <ellipse cx={geom.cx} cy={geom.cy} rx={geom.rx} ry={geom.ry} {...props} />
}

/** The thing that crosses the lane: an arrow for a bow, a short bolt for a
 * crossbow, a glowing orb for magic, nothing for melee (which connects in
 * reach, not at range). Authored in the ACTOR's own local space and reused
 * unchanged for the enemy's shot — the enemy's wrapping mirror transform is
 * what sends it the other way.
 *
 * Drawn AT the weapon's own muzzle (weaponMuzzle) and translated from there,
 * so a shortbow's shot leaves a shortbow's string and a wand's leaves the
 * wand's gem. Fixed coordinates here would have to agree with geometry that
 * now lives in another file, and the two would drift the first time a weapon
 * was re-drawn. */
function CombatShot({ kind, weaponIconType, accent }) {
  const offset = shotOffset(kind, weaponIconType)
  const muzzle = weaponMuzzle(weaponIconType, kind)
  if (!offset || !muzzle) return null
  const flight = { '--inkc-shot-dx': `${offset.dx}px`, '--inkc-shot-dy': `${offset.dy}px` }
  const at = `translate(${muzzle.x.toFixed(2)} ${muzzle.y.toFixed(2)})`
  if (kind === 'ranged') {
    // Bolt and arrow differ in length and heft, not in origin handling: a
    // bolt is a stouter dart off a much shorter draw. Own class per kind —
    // the fly keyframe is selected per class, and `inkc-shot--bolt` is
    // already taken by the magic orb (same generic name, different animal).
    const bolt = weaponIconType === 'crossbow'
    return (
      <g class={`inkc-shot inkc-shot--${bolt ? 'crossbow' : 'arrow'}`} style={flight}>
        <g transform={at}>
          {bolt ? (
            <>
              <path d="M-8 0 L-4 -3 M-8 0 L-4 3" />
              <path d="M-8 0 L0 0" />
              <path d="M0 0 L-5 -4 M0 0 L-5 4" />
            </>
          ) : (
            <>
              {/* Fletching, shaft, head — a projectile has to read at a
                  glance mid-flight, so it is drawn bigger and bolder than
                  the weapon it left. */}
              <path d="M-28 0 L-30 -4 M-28 0 L-30 4" />
              <path d="M-28 0 L0 0" />
              <path d="M0 0 L-8 -6 M0 0 L-8 6" />
            </>
          )}
        </g>
      </g>
    )
  }
  return (
    <g class="inkc-shot inkc-shot--bolt" style={flight}>
      <g transform={at}>
        <circle class="inkc-bolt-trail" cx="0" cy="0" r="10" style={accent ? { fill: accent } : undefined} />
        <circle cx="0" cy="0" r="6" style={accent ? { fill: accent } : undefined} />
      </g>
    </g>
  )
}
