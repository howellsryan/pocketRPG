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
            class={`flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--fm-parch-hi)] border border-[var(--fm-rule)] whitespace-nowrap transition-colors cursor-pointer ${demo ? 'opacity-40' : 'hover:border-[var(--fm-verdigris)]'}`}
          >
            <span class="text-[11px]">{demo ? '🔒' : '📋'}</span>
            <span
              class="text-[11px] font-[var(--font-mono)] font-bold"
              style={{ color: dailyTasksCompleted === dailyTasksTotal ? 'var(--fm-verdigris)' : 'var(--fm-ink-soft)' }}
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
            class={`flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--fm-parch-hi)] border border-[var(--fm-rule)] whitespace-nowrap transition-colors cursor-pointer ${demo ? 'opacity-40' : 'hover:border-[var(--fm-royal)]'}`}
          >
            {demo
              ? <span class="text-[11px]">🔒</span>
              : <GameIcon iconKey="cut_diamond" size={14} color="var(--fm-royal)" />}
            <span class="text-[11px] font-[var(--font-mono)] font-bold text-[var(--fm-royal)]">
              {demo ? '—' : credits.toLocaleString()}
            </span>
          </button>
        )}

        <button
          onClick={handleSkip}
          class={`flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--fm-parch-hi)] border border-[var(--fm-rule)] transition-colors text-[11px] font-semibold text-[var(--color-gold-dim)] whitespace-nowrap cursor-pointer ${demo ? 'opacity-40' : 'hover:border-[var(--fm-brass)]'}`}
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
