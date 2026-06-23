import GameIcon from './GameIcon.jsx'
import bespokeIconsData from '../data/bespokeIcons.json'
import { skillEmblemMask, skillArtTreatment } from '../utils/skillArt.js'

/**
 * Large, glowing skill emblem for the artsy Home Screen.
 *
 * When a bespoke full-colour emblem exists for `iconKey` it is rendered
 * as-authored (via GameIcon) behind a coloured glow halo — this keeps the
 * Home Screen consistent with every other skill-icon surface (SkillIcon).
 * Otherwise it falls back to the legacy treatment: the game-icons glyph used
 * as a CSS mask over the accent gradient.
 *
 * Props:
 *   iconKey — glyph key (bespoke id or gameIcons.json key)
 *   accent  — hex accent colour driving the glow (and legacy gradient)
 *   size    — px width/height of the emblem, default 110
 *   glow    — glow intensity multiplier (0 disables), default 1
 *   class   — extra classes for positioning by the parent
 */
export default function SkillEmblem({ iconKey, accent, size = 110, glow = 1, class: cls = '' }) {
  const t = skillArtTreatment(accent)
  const glowStyle = { background: `radial-gradient(circle, ${t.glow}, transparent 68%)`, opacity: 0.55 * glow }
  const dropShadow = `drop-shadow(0 3px 5px rgba(0,0,0,0.55)) drop-shadow(0 0 ${13 * glow}px ${t.glow})`

  // Bespoke full-colour emblem (ships in the lazy game chunk; guard with typeof).
  const hasBespoke = typeof bespokeIconsData !== 'undefined' && iconKey && bespokeIconsData[iconKey]
  if (hasBespoke) {
    return (
      <div class={`skill-emblem ${cls}`} style={{ width: size, height: size }} aria-hidden="true">
        {glow > 0 && <div class="skill-emblem__glow" style={glowStyle} />}
        <div
          class="skill-emblem__art"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', filter: dropShadow }}
        >
          <GameIcon iconKey={iconKey} size={Math.round(size * 0.84)} />
        </div>
      </div>
    )
  }

  // Legacy: gradient-filled glyph silhouette via CSS mask.
  const mask = skillEmblemMask(iconKey)
  if (!mask) return null
  const maskStyle = {
    WebkitMaskImage: mask, maskImage: mask,
    WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center', maskPosition: 'center',
    WebkitMaskSize: 'contain', maskSize: 'contain',
  }
  return (
    <div class={`skill-emblem ${cls}`} style={{ width: size, height: size }} aria-hidden="true">
      {glow > 0 && <div class="skill-emblem__glow" style={glowStyle} />}
      <div class="skill-emblem__art" style={{ ...maskStyle, background: t.gradient, filter: dropShadow }} />
    </div>
  )
}
