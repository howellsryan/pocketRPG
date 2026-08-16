import { useRef } from 'preact/hooks'
import SkillEmblem from './SkillEmblem.jsx'

/**
 * The action stage: an actor's tool on the left, the thing it is acting on the
 * right, and a lane between them for whatever flies across. Combat is its first
 * consumer (sword / bow / staff against a monster's emblem); the skilling
 * rollout reuses it unchanged with a pickaxe against an ore emblem.
 *
 * Pure presentation. Every sprite is a masked game-icons glyph via SkillEmblem,
 * so a new animation costs a glyph key and a keyframe family, never an asset.
 * All timing arrives already computed from utils/actionSprites.js — this
 * component must not derive a duration of its own, or the "animation speed IS
 * the action's cadence" law stops holding the moment someone edits the CSS.
 *
 * EVERY MOTION IS ITS OWN KEYED ELEMENT, and none of them nest. A CSS animation
 * replays when its element mounts, so two motions sharing an element share a
 * key and each replays when the *other* fires — and a parent's remount drags
 * its children along, which is why the recoil is a sibling of the mark rather
 * than a child of it. There is no `idle` prop for the same reason: a class
 * toggled back on restarts the animation under it, so a side that is not acting
 * must have no token at all (useActionSwings expires them).
 *
 * And a running animation is FROZEN TO THE TOKEN THAT STARTED IT. Swapping
 * `animation` on a mounted element restarts it just as a remount does, so a
 * weapon swap or a target switch landing mid-motion would replay a swing the
 * engine never made. Each side therefore keeps the motion and duration it had
 * when its token arrived; a change takes effect on the next swing, which is
 * where the player expects to see it anyway.
 *
 * Props:
 *   actor       — { tool, motion, projectile, swingMs, accent } from actionSprites
 *   target      — { icon, accent, sprite? } — `sprite` present means it acts back
 *   actorSwing  — swing token (utils/actionSprites.js) or null; a new `id` replays
 *   targetSwing — same, for the target's own strike
 *   label       — accessible description of what the stage is showing
 */
export default function ActionSpriteStage({ actor, target, actorSwing = null, targetSwing = null, label = 'Combat' }) {
  // Before the early return: a hook must run on every render of this component.
  const frozen = useRef({})
  if (!actor || !target) return null

  const targetSprite = target.sprite || null
  const f = frozen.current
  // The GLYPH is frozen with the motion, not just the timing: a bow playing the
  // melee keyframes, or the boss's motion on the add's emblem, is worse than a
  // beat of latency. Everything about a side is captured together, or not at all.
  if (actorSwing && f.actorId !== actorSwing.id) {
    f.actorId = actorSwing.id
    f.actor = { ...actor }
  }
  if (targetSwing && targetSprite && f.targetId !== targetSwing.id) {
    f.targetId = targetSwing.id
    f.target = { sprite: { ...targetSprite }, icon: target.icon, accent: target.accent }
  }
  // Live values until a token exists; the frozen pair once one does.
  const a = actorSwing && f.actor ? f.actor : actor
  const tgt = targetSwing && f.target ? f.target : { sprite: targetSprite, icon: target.icon, accent: target.accent }

  const targetSwinging = !!targetSwing && !!targetSprite
  const struck = !!actorSwing && actorSwing.hit

  return (
    <div class="as-stage" role="img" aria-label={label}>
      <div class="as-side as-side--actor">
        <div
          key={`a${actorSwing ? actorSwing.id : 0}`}
          class={`as-tool${actorSwing ? ` as-tool--${a.motion} is-swinging` : ''}`}
          style={{ '--as-dur': `${a.swingMs}ms` }}
        >
          <SkillEmblem iconKey={a.tool} accent={a.accent} size={44} glow={0.5} />
        </div>
      </div>

      <div class="as-lane">
        {actorSwing && a.projectile && (
          <div
            key={`ap${actorSwing.id}`}
            class="as-shot as-shot--out"
            style={{ '--as-dur': `${a.swingMs}ms` }}
          >
            <SkillEmblem iconKey={a.projectile} accent={a.accent} size={20} glow={0.4} />
          </div>
        )}
        {targetSwinging && tgt.sprite.projectile && (
          <div
            key={`tp${targetSwing.id}`}
            class="as-shot as-shot--in"
            style={{ '--as-dur': `${tgt.sprite.swingMs}ms` }}
          >
            <SkillEmblem iconKey={tgt.sprite.projectile} accent={tgt.accent} size={20} glow={0.4} />
          </div>
        )}
      </div>

      <div class="as-side as-side--target">
        <div
          key={`t${targetSwing ? targetSwing.id : 0}`}
          class={`as-mark${targetSwinging ? ` as-mark--${tgt.sprite.motion} is-swinging` : ''}`}
          style={{ '--as-dur': `${targetSwinging ? tgt.sprite.swingMs : a.swingMs}ms` }}
        >
          <SkillEmblem iconKey={tgt.icon} accent={tgt.accent} size={48} glow={0.6} />
        </div>
        {/* Sibling, not child: the target can be recoiling from a blow and
            landing its own on the same tick, and nesting made each remount the
            other. */}
        {struck && (
          <div
            key={`h${actorSwing.id}`}
            class="as-struck"
            style={{ '--as-hit-dur': `${a.swingMs}ms` }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  )
}
