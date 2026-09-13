import { useEffect, useState } from 'preact/hooks'

export default function CombatTelegraphCard({ telegraph, onReact }) {
  const [sequence, setSequence] = useState([])
  useEffect(() => setSequence([]), [telegraph?.attackId])
  if (!telegraph) return null

  const react = (reaction) => onReact?.({ attackId: telegraph.attackId, ...reaction })
  const addPrayer = (style) => {
    const next = [...sequence, style].slice(-3)
    setSequence(next)
    if (next.length === 3) react({ type: 'prayer_sequence', prayers: next })
  }

  return (
    <div class="mb-3 rounded-xl border border-[var(--color-gold)] bg-[rgba(90,56,5,0.32)] p-3">
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="text-[9px] uppercase tracking-[0.2em] text-[var(--color-gold)]">Incoming mechanic</div>
          <div class="text-sm font-semibold text-[var(--color-parchment)] mt-0.5">{telegraph.label || telegraph.attackId}</div>
        </div>
        <div class="text-[10px] font-[var(--font-mono)] text-[var(--color-parchment)] opacity-60">
          {telegraph.resolveInTicks ? telegraph.resolveInTicks + 't' : ''}
        </div>
      </div>

      <div class="mt-2">
        {telegraph.responseType === 'guard' && (
          <button class="fm-toggle is-on min-h-[42px] w-full" onClick={() => react({ type: 'guard' })}>🛡️ Guard</button>
        )}
        {telegraph.responseType === 'prayer' && (
          <button class="fm-toggle is-on min-h-[42px] w-full" onClick={() => react({ type: 'prayer', style: telegraph.protectionStyle || telegraph.style || 'magic' })}>
            🙏 Time Protection
          </button>
        )}
        {telegraph.responseType === 'equipment_parry' && (
          <button class="fm-toggle is-on min-h-[42px] w-full" onClick={() => react({ type: 'parry', slot: telegraph.requiredSlot })}>
            ⚔️ Parry {telegraph.requiredSlot || 'grapple'}
          </button>
        )}
        {telegraph.responseType === 'prayer_sequence' && (
          <div>
            <div class="text-[10px] text-[var(--color-parchment)] opacity-60 mb-1.5">
              Match the sequence: Melee → Ranged → Magic
            </div>
            <div class="grid grid-cols-3 gap-1.5">
              {['melee','ranged','magic'].map((style) => (
                <button key={style} class="fm-toggle min-h-[42px] capitalize" onClick={() => addPrayer(style)}>
                  {style === 'melee' ? '⚔️' : style === 'ranged' ? '🏹' : '🔮'} {style}
                </button>
              ))}
            </div>
            <div class="mt-1 text-[9px] font-[var(--font-mono)] opacity-50 text-[var(--color-parchment)]">
              {sequence.length ? sequence.join(' → ') : 'Awaiting first prayer…'}
            </div>
          </div>
        )}
        {telegraph.responseType === 'target' && (
          <div class="text-[11px] text-[var(--color-parchment)] opacity-70">
            Switch target and destroy the summoned target before it resolves.
          </div>
        )}
      </div>
    </div>
  )
}
