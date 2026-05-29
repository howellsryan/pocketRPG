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

  return (
    <div
      class="pointer-events-none fixed inset-x-0 z-[70] flex justify-center"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 64px)' }}
    >
      <style>{`@keyframes pocketrpg-reward-pop { 0% { opacity: 0; transform: translateY(-12px) scale(0.96); } 100% { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
      <div
        onClick={dismiss}
        role="status"
        class="pointer-events-auto mx-3 w-full max-w-[340px] cursor-pointer overflow-hidden rounded-2xl border border-[var(--color-gold-dim)] bg-[#1a1a1a] shadow-2xl"
        style={{ animation: 'pocketrpg-reward-pop 220ms ease-out' }}
      >
        <div class="flex items-center gap-2 border-b border-[#333] bg-[#2a1f0a] px-4 py-2.5">
          <span class="text-[18px]">{current.icon}</span>
          <span class="font-bold text-[14px] text-[var(--color-gold)]" style={{ fontFamily: 'Cinzel, serif' }}>{current.title}</span>
        </div>
        <div class="flex flex-wrap justify-center gap-2 px-3 py-3">
          {current.rewards.map(r => {
            const item = itemsData[r.itemId]
            return (
              <div key={r.itemId} class="flex items-center gap-1.5 rounded-lg border border-[#2a2a2a] bg-[#111] px-2 py-1">
                <GameIcon item={item} size={20} />
                <span class="text-[12px] text-[var(--color-parchment)]">{item?.name || r.itemId}</span>
                {r.quantity > 1 && <span class="text-[11px] font-bold text-[var(--color-gold)]">×{r.quantity.toLocaleString()}</span>}
              </div>
            )
          })}
        </div>
        <div class="pb-2 text-center text-[9px] text-[var(--color-gold-dim)]">tap to dismiss</div>
      </div>
    </div>
  )
}
