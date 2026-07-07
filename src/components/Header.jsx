import GameIcon from './GameIcon.jsx'

// Desktop-only top bar (mobile chrome is the GameFrameBar rails). Carries the
// same actions as the mobile bottom rail's centre group: Daily Tasks, Credits
// and Skip. Nav destinations live in SideNav.
export default function Header({ credits = 0, isCloudAccount = false, demo = false, onLockedFeature = null, onSkip1h = null, onBuyCredits = null, onDailyTasks = null, dailyTasksCompleted = 0, dailyTasksTotal = 5, skipMode = 'hour', raidSkipCost = null }) {
  const handleSkip = () => {
    if (demo) { onLockedFeature?.(); return }
    onSkip1h?.()
  }

  return (
    // md:min-h-14 matches the side nav's brand row so both bars' bottom
    // borders form one continuous line across the desktop chrome.
    <header class="pwa-header fm-topbar relative flex-shrink-0 border-b px-6 min-h-14 hidden md:flex md:items-center">
      <div class="flex items-center gap-1.5">
        {/* Daily tasks pill — cloud accounts (locked in the demo) */}
        {(isCloudAccount || demo) && (
          <button
            onClick={() => { if (demo) onLockedFeature?.(); else onDailyTasks?.() }}
            aria-label="Daily Tasks"
            title={demo ? 'Daily Tasks are available with a free account' : 'Daily Tasks'}
            class={`flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#0f1a10] border border-[#2a5a2a] whitespace-nowrap transition-colors cursor-pointer ${demo ? 'opacity-40' : 'hover:border-[#3a7a3a]'}`}
          >
            <span class="text-[11px]">{demo ? '🔒' : '📋'}</span>
            <span
              class="text-[11px] font-[var(--font-mono)] font-bold"
              style={{ color: dailyTasksCompleted === dailyTasksTotal ? 'var(--color-gold)' : 'var(--color-parchment)' }}
            >
              {demo ? '—' : `${dailyTasksCompleted}/${dailyTasksTotal}`}
            </span>
          </button>
        )}

        {/* Credits pill — cloud accounts (locked in the demo) */}
        {(isCloudAccount || demo) && (
          <button
            onClick={() => { if (demo) onLockedFeature?.(); else onBuyCredits?.() }}
            title={demo ? 'Credits are available with a free account' : 'Buy credits'}
            class={`flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1a1030] border border-[#5a2a7a] whitespace-nowrap transition-colors cursor-pointer ${demo ? 'opacity-40' : 'hover:border-[#7a3a9a]'}`}
          >
            {demo
              ? <span class="text-[11px]">🔒</span>
              : <GameIcon iconKey="cut_diamond" size={14} color="#f0c040" />}
            <span class="text-[11px] font-[var(--font-mono)] font-bold text-[#e879f9]">
              {demo ? '—' : credits.toLocaleString()}
            </span>
          </button>
        )}

        <button
          onClick={handleSkip}
          class={`flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#2a2010] border border-[var(--color-gold-dim)] transition-colors text-[11px] font-semibold text-[var(--color-gold-light)] whitespace-nowrap cursor-pointer ${demo ? 'opacity-40' : 'hover:border-[var(--color-gold)]'}`}
          title={demo
            ? 'Skip is available with a free account'
            : raidSkipCost != null
            ? `Skip the entire raid (costs ${raidSkipCost} credit${raidSkipCost === 1 ? '' : 's'})`
            : skipMode === 'kill' ? 'Skip to the kill (requires 1 credit)' : 'Skip 1 hour (requires 1 credit)'}
        >
          <span>{demo ? '🔒' : '⏭️'}</span>
          <span>{raidSkipCost != null ? `Skip (${raidSkipCost})` : skipMode === 'kill' ? 'Skip' : 'Skip 1h'}</span>
        </button>
      </div>
    </header>
  )
}
