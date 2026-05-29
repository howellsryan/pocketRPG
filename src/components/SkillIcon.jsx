import GameIcon from './GameIcon.jsx'
import { SKILL_ART } from '../utils/skillArt.js'
import { SKILL_ICONS } from '../utils/constants.js'

/**
 * Inline skill icon using the new game-icons crest art, tinted with the
 * skill's accent colour. Falls back to the legacy emoji for any skill that
 * has no crest mapping so nothing renders blank.
 *
 * Props:
 *   skill — skill id (e.g. 'attack')
 *   size  — px size, default 22
 *   color — tint override; defaults to the skill's accent colour
 *   class — extra classes
 *   title — accessible label override
 */
export default function SkillIcon({ skill, size = 22, color, class: cls = '', title }) {
  const art = SKILL_ART[skill]
  const label = title || (skill ? skill.charAt(0).toUpperCase() + skill.slice(1) : '')

  if (!art) {
    return (
      <span
        class={cls}
        style={{ fontSize: typeof size === 'number' ? `${Math.round(size * 0.85)}px` : undefined, lineHeight: 1 }}
      >
        {SKILL_ICONS[skill] || '⭐'}
      </span>
    )
  }

  return <GameIcon iconKey={art.icon} color={color || art.accent} size={size} class={cls} title={label} />
}
