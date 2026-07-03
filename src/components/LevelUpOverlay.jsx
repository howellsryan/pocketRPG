import { useEffect, useState } from 'preact/hooks'
import GameIcon from './GameIcon.jsx'
import { getSkillArt } from '../utils/skillArt.js'

/**
 * Full-screen level-up takeover — a bigger celebration than the reward-reveal
 * card's inline "Levels Gained" list, for when a quest actually bumps a
 * level. Deliberately sits above RewardRevealOverlay (higher z-index, solid
 * backdrop) so a big Grandmaster-quest level-up covers the whole screen and
 * blocks the reward card behind it until dismissed. Driven by the
 * `pocketrpg:levelup-reveal` event (utils/rewardReveal.js emitLevelUpReveal),
 * fired only from quest completions — every other level-up keeps its small
 * toast. Cards queue one at a time, auto-dismiss, and can be tapped to
 * dismiss early.
 */
const LEVELUP_LIFETIME_MS = 4500

export default function LevelUpOverlay() {
  const [queue, setQueue] = useState([])
  const current = queue[0] || null
  const currentId = current?.id

  useEffect(() => {
    const handler = (event) => {
      const levelUps = Array.isArray(event?.detail?.levelUps)
        ? event.detail.levelUps.filter(l => l?.skill && l.to > l.from)
        : []
      if (levelUps.length === 0) return
      setQueue(prev => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, levelUps }])
    }
    window.addEventListener('pocketrpg:levelup-reveal', handler)
    return () => window.removeEventListener('pocketrpg:levelup-reveal', handler)
  }, [])

  useEffect(() => {
    if (!currentId) return
    const timer = setTimeout(() => setQueue(prev => prev.slice(1)), LEVELUP_LIFETIME_MS)
    return () => clearTimeout(timer)
  }, [currentId])

  if (!current) return null

  const dismiss = () => setQueue(prev => prev.slice(1))
  const multi = current.levelUps.length > 1

  return (
    <div
      onClick={dismiss}
      role="status"
      class="fixed inset-0 z-[85] flex items-center justify-center px-6 bg-[rgba(8,6,3,0.86)] backdrop-blur-sm cursor-pointer"
    >
      <div
        key={current.id}
        class="toast-enter relative w-full max-w-sm rounded-2xl border border-[var(--color-gold-dim)] bg-[rgba(20,16,10,0.96)] px-6 py-7 text-center shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden"
      >
        <div class="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-gold)] opacity-80 mb-1">
          Level Up
        </div>
        <div class="font-[var(--font-display)] text-[22px] font-bold text-[var(--color-parchment)] mb-5">
          {multi ? `${current.levelUps.length} Skills Advanced` : 'Skill Advanced'}
        </div>
        <div class="flex flex-col gap-3">
          {current.levelUps.map(l => {
            const art = getSkillArt(l.skill)
            const name = l.skill.charAt(0).toUpperCase() + l.skill.slice(1)
            return (
              <div key={l.skill} class="flex items-center gap-3 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-2.5">
                <GameIcon iconKey={art.icon} size={30} color={art.accent} />
                <span class="flex-1 min-w-0 text-left text-[14px] font-semibold text-[var(--color-parchment)]">{name}</span>
                <span class="font-[var(--font-mono)] text-[16px] font-bold text-[var(--color-gold)]">{l.from} → {l.to}</span>
              </div>
            )
          })}
        </div>
        <div class="mt-6 text-[11px] text-[var(--color-parchment)] opacity-50">Tap to continue</div>
        <div
          class="absolute left-0 bottom-0 h-[3px] w-full skill-toast-shrink bg-[var(--color-gold)]"
          style={{ animationDuration: `${LEVELUP_LIFETIME_MS}ms` }}
        />
      </div>
    </div>
  )
}
