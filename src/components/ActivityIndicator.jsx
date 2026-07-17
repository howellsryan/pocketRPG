import { useGame } from '../state/gameState.jsx'
import { SKILL_ICONS, SCREENS } from '../utils/constants.js'
import SkillIcon from './SkillIcon.jsx'
import GameIcon from './GameIcon.jsx'

/**
 * Compact indicator for the currently running background task: the activity's
 * icon wrapped in a progress ring that fills as the current action completes.
 * Tapping it jumps to the activity's screen. Desktop-only (Header is hidden
 * on mobile; the bottom rail has no room for it there).
 */

function describeTask(task) {
  if (!task) return null
  switch (task.type) {
    case 'skill':
      // Magic has its own top-level screen; every other skill (including the
      // ones SkillingScreen itself delegates to, e.g. farming/construction)
      // resumes via SCREENS.SKILLS + skillId, same as autoStart routing.
      return task.skill === 'magic'
        ? { skill: 'magic', icon: SKILL_ICONS.magic || '🔮', screen: SCREENS.MAGIC, label: 'Magic' }
        : { skill: task.skill, icon: SKILL_ICONS[task.skill] || '🔨', screen: SCREENS.SKILLS, data: { skillId: task.skill }, label: task.skill }
    case 'gather':
      if (task.gatherTask?.oneShot || task.gatherTask?.isClue) return null
      return { iconKey: task.gatherTask?.product, icon: task.gatherTask?.icon || '🌿', screen: SCREENS.GATHER, label: task.gatherTask?.name || 'Gathering' }
    case 'agility':
      return { skill: 'agility', icon: SKILL_ICONS.agility || '🏃', screen: SCREENS.AGILITY, label: 'Agility' }
    case 'thieving':
      return { skill: 'thieving', icon: SKILL_ICONS.thieving || '🗝️', screen: SCREENS.SKILLS, data: { skillId: 'thieving' }, label: 'Thieving' }
    case 'hunter':
      return { skill: 'hunter', icon: SKILL_ICONS.hunter || '🪤', screen: SCREENS.SKILLS, data: { skillId: 'hunter' }, label: 'Hunter' }
    case 'quest':
      return { iconKey: 'clue_scroll_medium', icon: '📜', screen: SCREENS.QUESTS, label: task.quest?.name || 'Quest' }
    case 'minigame':
      return {
        iconKey: task.minigameTask?.product,
        icon: task.minigameTask?.icon || '🎮',
        screen: SCREENS.MINIGAMES,
        label: task.minigameTask?.name || 'Minigame',
      }
    case 'clue':
      return { iconKey: task.gatherTask?.requiresItem, icon: '🗝️', screen: SCREENS.CLUES, label: task.gatherTask?.name || 'Clue scroll' }
    default:
      return null
  }
}

export default function ActivityIndicator({ onNavigate }) {
  const { activeTask, combatStatus } = useGame()

  // A live fight takes priority: show the combat icon with the monster's HP as
  // the progress ring so the player can watch a background fight from any screen.
  const inCombat = !!combatStatus?.active
  const info = inCombat
    ? { iconKey: 'combat_level', icon: '⚔️', screen: SCREENS.COMBAT, label: combatStatus.monsterName ? `Fighting ${combatStatus.monsterName}` : 'In combat' }
    : describeTask(activeTask)
  if (!info) return null

  let hasProgress
  let progress
  if (inCombat) {
    const max = Number(combatStatus.monsterMaxHP) || 0
    const hp = Number(combatStatus.monsterHP)
    hasProgress = max > 0 && Number.isFinite(hp)
    // Ring shows remaining monster HP — full at the start, emptying as it dies.
    progress = hasProgress ? Math.max(0, Math.min(1, hp / max)) : 0
  } else {
    const total = Number(activeTask.totalTicks) || 0
    const remaining = Number(activeTask.ticksRemaining)
    hasProgress = total > 0 && Number.isFinite(remaining)
    progress = hasProgress ? Math.max(0, Math.min(1, (total - remaining) / total)) : 0
  }

  const size = 30
  const stroke = 3
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - progress)

  return (
    <button
      type="button"
      onClick={() => onNavigate && onNavigate(info.screen, info.data)}
      title={`Running: ${info.label}`}
      aria-label={`Active task: ${info.label}`}
      class="relative flex items-center justify-center bg-transparent border-0 p-0 cursor-pointer"
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      <style>{`@keyframes pocketrpg-activity-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }`}</style>
      <svg width={size} height={size} class="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fm-rule)" stroke-width={stroke} />
        {hasProgress && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--fm-verdigris)"
            stroke-width={stroke}
            stroke-linecap="round"
            stroke-dasharray={c}
            stroke-dashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.25s linear' }}
          />
        )}
      </svg>
      <span
        class="flex items-center justify-center text-[13px] leading-none"
        style={hasProgress ? undefined : { animation: 'pocketrpg-activity-pulse 1.6s ease-in-out infinite' }}
      >
        {info.skill
          ? <SkillIcon skill={info.skill} size={16} title={info.label} />
          : info.iconKey
            ? <GameIcon iconKey={info.iconKey} item={{ icon: info.icon, name: info.label }} size={16} color="currentColor" />
            : info.icon}
      </span>
    </button>
  )
}
