import { useGame } from '../state/gameState.jsx'
import { useEffect, useRef, useState } from 'preact/hooks'
import { CLOUD_SAVE_STATUS_EVENT } from '../cloud/sync.js'

export default function Header({ activity, credits = 0, isCloudAccount = false, onSkip1h = null, onBuyCredits = null, onMenuClick = null }) {
  const { player, currentHP, getMaxHP } = useGame()
  const [cloudStatus, setCloudStatus] = useState('idle')
  const [showSavedToCloud, setShowSavedToCloud] = useState(false)
  const savedTimeoutRef = useRef(null)
  if (!player) return null

  const maxHP = getMaxHP()
  const hpPct = maxHP > 0 ? (currentHP / maxHP) * 100 : 0
  const hpColor = hpPct > 50 ? 'var(--color-hp-green)' : hpPct > 25 ? 'var(--color-hp-yellow)' : 'var(--color-hp-red)'

  const handleSkip = () => {
    if (onSkip1h) onSkip1h()
  }

  useEffect(() => {
    const handleCloudSaveStatus = (event) => {
      const status = event?.detail?.status
      if (!status) return
      const hasActiveSavedToast = showSavedToCloud && savedTimeoutRef.current

      // Keep success acknowledgement visible for its full duration even if a
      // follow-up save starts immediately after (heartbeat/queued save).
      if (hasActiveSavedToast && (status === 'pending' || status === 'saving')) return

      setCloudStatus(status)
      if (status === 'saved') {
        setShowSavedToCloud(true)
        if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
        savedTimeoutRef.current = setTimeout(() => {
          setShowSavedToCloud(false)
          setCloudStatus('idle')
        }, 3000)
        return
      }
      if (status === 'pending' || status === 'saving' || status === 'out_of_sync') return
      if (status === 'failed' || status === 'idle') {
        if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
        setShowSavedToCloud(false)
      }
    }

    window.addEventListener(CLOUD_SAVE_STATUS_EVENT, handleCloudSaveStatus)
    return () => {
      window.removeEventListener(CLOUD_SAVE_STATUS_EVENT, handleCloudSaveStatus)
    }
  }, [showSavedToCloud])

  useEffect(() => () => {
    if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
  }, [])

  return (
    <header class="relative flex-shrink-0 bg-[#111] border-b border-[#333] px-3 py-2 md:px-6 md:py-3">
      <div class="flex items-center gap-2">
        <div class="flex items-center gap-1">
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              aria-label="Open navigation menu"
              class="md:hidden w-9 h-9 -ml-1 mr-0.5 flex items-center justify-center bg-transparent border-0 text-[var(--color-parchment)] hover:text-[var(--color-gold)] cursor-pointer p-0"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="4" y1="7" x2="20" y2="7" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="17" x2="20" y2="17" />
              </svg>
            </button>
          )}
          <button
            onClick={handleSkip}
            class="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1a2a1a] border border-[#3a5a3a] hover:border-[#5a8a5a] transition-colors text-[10px] font-semibold text-[var(--color-parchment)] whitespace-nowrap"
            title="Skip 1 hour (requires 1 credit)"
          >
            <span>⏭️</span>
            <span>Skip 1h</span>
          </button>

          {/* Credits pill — cloud accounts only */}
          {isCloudAccount && (
            <button
              onClick={() => onBuyCredits?.()}
              class="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#1a1030] border border-[#5a2a7a] whitespace-nowrap hover:border-[#7a3a9a] transition-colors cursor-pointer bg-opacity-90 hover:bg-opacity-100"
            >
              <span class="text-[10px]">💎</span>
              <span class="text-[10px] font-[var(--font-mono)] font-bold text-[#e879f9]">
                {credits.toLocaleString()}
              </span>
            </button>
          )}
        </div>

        {/* Cloud save indicator — centered between left group and HP bar */}
        <div class="flex-1 flex items-center justify-center pointer-events-none min-w-0">
          {!showSavedToCloud && (cloudStatus === 'pending' || cloudStatus === 'saving') && <div class="h-3.5 w-3.5 rounded-full border-2 border-[#555] border-t-[var(--color-gold)] animate-spin" aria-label="Saving to Cloud" />}
          {showSavedToCloud && (
            <div class="flex items-center gap-1 text-[10px] font-semibold text-[var(--color-success)]" aria-label="Saved to Cloud">
              <span>✓</span>
              <span>Saved</span>
            </div>
          )}
        </div>

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
