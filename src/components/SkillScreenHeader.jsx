import SkillIcon from './SkillIcon.jsx'
import BackLink from './BackLink.jsx'
import { getLevelFromXP, getXPToNextLevel, getLevelProgress } from '../engine/experience.js'
import { MAX_LEVEL } from '../utils/constants.js'
import { formatNumber } from '../utils/helpers.js'

/**
 * Shared header for every skilling action screen: an optional back link, a
 * gold-tinted emblem tile, the skill name, a level/XP meta line, and a
 * progress bar toward the next level. Used by SkillingScreen, AgilityScreen,
 * ThievingScreen, HunterScreen, ConstructionScreen, MagicScreen, etc.
 *
 * Props:
 *   skill     — skill id (drives the emblem icon + accent)
 *   title     — display name (defaults to the capitalised skill id)
 *   xp        — total XP in the skill (drives level + next-level progress)
 *   level     — explicit level override (defaults to deriving from xp)
 *   onBack    — back handler; renders the back link when provided
 *   right     — optional node rendered at the top-right (e.g. token count)
 *   showXpBar — show the next-level progress bar, default true
 */
export default function SkillScreenHeader({
  skill,
  title,
  xp = 0,
  level,
  onBack,
  right = null,
  showXpBar = true,
}) {
  const lvl = level ?? getLevelFromXP(xp)
  const maxed = lvl >= MAX_LEVEL
  const progress = maxed ? 1 : getLevelProgress(xp)
  const toNext = maxed ? 0 : getXPToNextLevel(xp)
  const displayName = title || (skill ? skill.charAt(0).toUpperCase() + skill.slice(1) : '')

  return (
    <div class="mb-4">
      <BackLink onClick={onBack} className="mb-3" />

      <div class="flex items-center gap-3.5">
        <div class="w-[52px] h-[52px] flex-shrink-0 rounded-2xl flex items-center justify-center bg-gradient-to-br from-[rgba(212,160,23,0.16)] to-[rgba(212,160,23,0.03)] border border-[rgba(212,160,23,0.28)]">
          <SkillIcon skill={skill} size={28} />
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-[var(--font-display)] text-[22px] font-bold text-[var(--color-gold)] leading-tight truncate">
            {displayName}
          </div>
          <div class="flex items-center gap-2 mt-0.5 text-[13px] font-semibold text-[var(--color-parchment)] opacity-50">
            <span>Level {lvl}</span>
            <span class="opacity-60">·</span>
            <span>{maxed ? 'Max' : `${formatNumber(xp)} XP`}</span>
          </div>
        </div>
        {right}
      </div>

      {showXpBar && (
        <div class="flex items-center gap-2.5 mt-3">
          <div class="flex-1 h-[7px] rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden">
            <div
              class="h-full rounded-full bg-gradient-to-r from-[var(--color-gold-dim)] to-[var(--color-gold-light)]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <span class="text-[11px] font-semibold text-[var(--color-parchment)] opacity-40 whitespace-nowrap">
            {maxed ? 'Maxed' : `Lv ${lvl + 1} in ${formatNumber(toNext)} XP`}
          </span>
        </div>
      )}
    </div>
  )
}
