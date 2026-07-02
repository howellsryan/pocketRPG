import { useEffect, useRef, useState } from 'preact/hooks'
import itemsData from '../data/items.json'
import GameIcon from './GameIcon.jsx'

/**
 * Reward-reveal card shown when a clue scroll or minigame completes, listing the
 * items awarded. Driven by the `pocketrpg:reward-reveal` event so any completion
 * path (background minigame tick, clue screen) can surface the same UI. Cards
 * queue one at a time, auto-dismiss, and can be tapped to dismiss early.
 */
const REVEAL_LIFETIME_MS = 5000

export default function RewardRevealOverlay() {
  const [queue, setQueue] = useState([])
  const current = queue[0] || null
  const currentId = current?.id

  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail
      const rewards = Array.isArray(detail?.rewards)
        ? detail.rewards
            .map(r => ({ itemId: r.itemId, quantity: r.quantity ?? r.qty ?? 1 }))
            .filter(r => r.itemId && r.quantity > 0)
        : []
      if (rewards.length === 0) return
      const reveal = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: detail.title || 'Reward',
        icon: detail.icon || '🎁',
        rewards,
      }
      setQueue(prev => [...prev, reveal])
    }
    window.addEventListener('pocketrpg:reward-reveal', handler)
    return () => window.removeEventListener('pocketrpg:reward-reveal', handler)
  }, [])

  useEffect(() => {
    if (!currentId) return
    const timer = setTimeout(() => setQueue(prev => prev.slice(1)), REVEAL_LIFETIME_MS)
    return () => clearTimeout(timer)
  }, [currentId])

  if (!current) return null

  const dismiss = () => setQueue(prev => prev.slice(1))

  // Same visual language as the system toasts (Toast.jsx compact card): solid
  // dark card, gold accent bar + icon tile, countdown strip — plus the item chips
  // that make the reveal a reveal.
  return (
    <div
      class="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 56px)' }}
    >
      <div
        onClick={dismiss}
        role="status"
        key={current.id}
        class="toast-enter pointer-events-auto relative w-full max-w-sm cursor-pointer overflow-hidden rounded-2xl pl-4 pr-3.5 py-3.5 shadow-[0_10px_28px_rgba(0,0,0,0.4)] bg-[rgba(26,26,26,0.96)] backdrop-blur-sm border border-[rgba(255,255,255,0.08)]"
      >
        <div class="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-gold)]" />
        <div class="flex items-center gap-3">
          <div class="w-[38px] h-[38px] flex-shrink-0 rounded-xl flex items-center justify-center text-lg bg-[rgba(255,255,255,0.05)] border border-[var(--color-gold-light)]">
            {current.icon}
          </div>
          <div class="flex-1 min-w-0 text-[14px] font-semibold text-[var(--color-parchment)] leading-snug">{current.title}</div>
        </div>
        <div class="flex flex-wrap gap-1.5 mt-2.5">
          {current.rewards.map(r => {
            const item = itemsData[r.itemId]
            return (
              <div key={r.itemId} class="flex items-center gap-1.5 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] px-2 py-1">
                <GameIcon item={item} size={20} />
                <span class="text-[12px] text-[var(--color-parchment)]">{item?.name || r.itemId}</span>
                {r.quantity > 1 && <span class="text-[11px] font-bold text-[var(--color-gold)]">×{r.quantity.toLocaleString()}</span>}
              </div>
            )
          })}
        </div>
        <div
          class="absolute left-0 bottom-0 h-[3px] w-full skill-toast-shrink bg-[var(--color-gold)]"
          style={{ animationDuration: `${REVEAL_LIFETIME_MS}ms` }}
        />
      </div>
    </div>
  )
}
