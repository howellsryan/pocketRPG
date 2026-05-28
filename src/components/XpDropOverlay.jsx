import { useEffect, useRef, useState } from 'preact/hooks'
import { SKILL_ICONS } from '../utils/constants.js'

/**
 * Floating "+X skill XP" numbers shown when an action grants XP. Non-blocking
 * (pointer-events: none) and self-dismissing — deliberately less invasive than
 * a toast. Rapid gains for the same skill coalesce into one rising number.
 */
const DROP_LIFETIME_MS = 1600
const COALESCE_WINDOW_MS = 650

export default function XpDropOverlay() {
  const [drops, setDrops] = useState([])
  const dropsRef = useRef(drops)
  dropsRef.current = drops
  const nextId = useRef(0)

  useEffect(() => {
    const handler = (event) => {
      const skill = event?.detail?.skill
      const amount = Math.floor(Number(event?.detail?.amount) || 0)
      if (!skill || amount <= 0) return
      const now = Date.now()

      // Coalesce a fresh gain for the same skill into the most recent drop so a
      // burst of quick actions reads as one growing number rather than a stack.
      const recent = dropsRef.current.find(
        d => d.skill === skill && now - d.bornAt < COALESCE_WINDOW_MS,
      )
      if (recent) {
        setDrops(prev => prev.map(d => (d.id === recent.id ? { ...d, amount: d.amount + amount } : d)))
        return
      }

      const id = nextId.current++
      setDrops(prev => [...prev, { id, skill, amount, bornAt: now }])
      setTimeout(() => {
        setDrops(prev => prev.filter(d => d.id !== id))
      }, DROP_LIFETIME_MS)
    }
    window.addEventListener('pocketrpg:xp-gain', handler)
    return () => window.removeEventListener('pocketrpg:xp-gain', handler)
  }, [])

  if (drops.length === 0) return null

  return (
    <div
      class="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-1"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)' }}
      aria-hidden="true"
    >
      <style>{`
        @keyframes pocketrpg-xp-rise {
          0%   { opacity: 0; transform: translateY(8px) scale(0.92); }
          15%  { opacity: 1; transform: translateY(0) scale(1); }
          70%  { opacity: 1; transform: translateY(-14px); }
          100% { opacity: 0; transform: translateY(-30px); }
        }
      `}</style>
      {drops.map(d => (
        <div
          key={d.id}
          class="flex items-center gap-1 rounded-full border border-[#3a5a3a] bg-[#0d1a0d] px-3 py-1 text-[12px] font-bold text-[var(--color-hp-green)] shadow-lg"
          style={{ animation: `pocketrpg-xp-rise ${DROP_LIFETIME_MS}ms ease-out forwards` }}
        >
          <span>{SKILL_ICONS[d.skill] || '⭐'}</span>
          <span>+{d.amount.toLocaleString()} {d.skill} XP</span>
        </div>
      ))}
    </div>
  )
}
