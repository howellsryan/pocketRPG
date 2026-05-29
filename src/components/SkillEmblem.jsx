import { skillEmblemMask, skillArtTreatment } from '../utils/skillArt.js'

/**
 * Large, gradient-filled, glowing skill emblem for the artsy Home Screen.
 * The glyph silhouette is used as a CSS mask over a metallic accent gradient,
 * with a soft coloured glow halo behind it.
 *
 * Props:
 *   iconKey — gameIcons.json glyph key
 *   accent  — hex accent colour driving the gradient + glow
 *   size    — px width/height of the emblem, default 110
 *   glow    — glow intensity multiplier (0 disables), default 1
 *   class   — extra classes for positioning by the parent
 */
export default function SkillEmblem({ iconKey, accent, size = 110, glow = 1, class: cls = '' }) {
  const mask = skillEmblemMask(iconKey)
  if (!mask) return null
  const t = skillArtTreatment(accent)
  const maskStyle = {
    WebkitMaskImage: mask, maskImage: mask,
    WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center', maskPosition: 'center',
    WebkitMaskSize: 'contain', maskSize: 'contain',
  }
  return (
    <div class={`skill-emblem ${cls}`} style={{ width: size, height: size }} aria-hidden="true">
      {glow > 0 && (
        <div
          class="skill-emblem__glow"
          style={{ background: `radial-gradient(circle, ${t.glow}, transparent 68%)`, opacity: 0.55 * glow }}
        />
      )}
      <div
        class="skill-emblem__art"
        style={{
          ...maskStyle,
          background: t.gradient,
          filter: `drop-shadow(0 3px 5px rgba(0,0,0,0.55)) drop-shadow(0 0 ${13 * glow}px ${t.glow})`,
        }}
      />
    </div>
  )
}
