import GameIcon from './GameIcon.jsx'

export default function WorldEntryCard({className='',busy=false,error='',enter}) {
  return (
    <div class={`forge-shell fm-frame ${className}`} onPointerDown={event => event.stopPropagation()}>
      <div class="fm-parch p-3">
        <div class="flex items-center justify-between gap-3">
          <span class="fm-eyebrow">The shared world</span><span class="fm-tag fm-tag--brass">Beta</span>
        </div>
        <p class="text-sm font-semibold text-[var(--text-strong)] mt-1 mb-1">Explore Eldermoor</p>
        <p class="text-xs text-[var(--text-soft)] mb-3">Continue exploring. New arrivals begin in Lumbright.</p>
        <button type="button" class="fm-btn fm-btn--ember w-full" disabled={busy} aria-busy={busy} aria-label={busy ? 'Saving and entering…' : 'Enter the world'} onClick={enter}>
          <GameIcon iconKey="globe" size={18} />{busy ? 'Saving and entering…' : 'Enter the world'}
        </button>
        {error && <p role="alert" class="text-xs text-[var(--text-strong)] mt-2">{error}</p>}
      </div>
    </div>
  )
}
