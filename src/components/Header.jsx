import { useGame } from '../state/gameState.jsx'

export default function Header({ activity, credits = 0, isCloudAccount = false, onSkip1h = null, onBuyCredits = null }) {
  const { player, currentHP, getMaxHP } = useGame()
  if (!player) return null

  const maxHP = getMaxHP()
  const hpPct = maxHP > 0 ? (currentHP / maxHP) * 100 : 0
  const hpColor = hpPct > 50 ? 'var(--color-hp-green)' : hpPct > 25 ? 'var(--color-hp-yellow)' : 'var(--color-hp-red)'

  const handleSkip = () => {
    if (onSkip1h) onSkip1h()
  }

  return (
    <header class="flex-shrink-0 bg-[#111] border-b border-[#333] px-3 py-2">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <button
            onClick={handleSkip}
            class="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1a2a1a] border border-[#3a5a3a] hover:border-[#5a8a5a] transition-colors text-[10px] font-semibold text-[var(--color-parchment)] whitespace-nowrap"
            title="Skip 1 hour (requires 1 credit)"
          >
            <span>⏭️</span>
            <span>Skip 1h</span>
          </button>
        </div>

        {/* Credits pill — cloud accounts only */}
        {isCloudAccount && (
          <button
            onClick={() => onBuyCredits?.()}
            class="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#1a1030] border border-[#5a2a7a] whitespace-nowrap hover:border-[#7a3a9a] transition-colors cursor-pointer bg-opacity-90 hover:bg-opacity-100"
          >
            <span class="text-[10px]">💎</span>
            <span class="text-[10px] font-[var(--font-mono)] font-bold text-[#e879f9]">
              Credits: {credits.toLocaleString()}
            </span>
          </button>
        )}

        {/* HP bar */}
        <div class="flex items-center gap-1.5">
          <span class="text-xs">❤️</span>
          <div class="w-20 h-3 bg-[#222] rounded-full overflow-hidden border border-[#444]">
            <div
              class="h-full rounded-full transition-all duration-300"
              style={{ width: `${hpPct}%`, backgroundColor: hpColor }}
            />
          </div>
          <span class="text-[10px] font-[var(--font-mono)] text-[var(--color-parchment)] opacity-80 min-w-[32px]">
            {currentHP}/{maxHP}
          </span>
        </div>
      </div>

      {activity && (
        <div class="text-[10px] text-[var(--color-gold-dim)] mt-0.5 truncate progress-active">
          {activity}
        </div>
      )}
    </header>
  )
}
