import { SCREENS } from '../utils/constants.js'

// Placeholder shown when a cloud-only feature is opened while in the offline
// demo. The feature stays visible in the navigation (so players can see what a
// free account unlocks) but its screen is replaced with this locked notice.
const FEATURE_COPY = {
  [SCREENS.STORE]: {
    title: 'Trading Post',
    blurb: 'Buy and sell with the live player market, the general store, and order book.',
  },
  [SCREENS.LEADERBOARD]: {
    title: 'Leaderboard',
    blurb: 'Compete on the global total-level and boss kill-count rankings.',
  },
}

export default function DemoLockedScreen({ screen, onBack }) {
  const copy = FEATURE_COPY[screen] || { title: 'This feature', blurb: 'This feature needs a free account.' }
  return (
    <div class="forge-shell h-full overflow-y-auto flex items-center justify-center p-6 bg-[var(--color-void)]">
      <div class="max-w-sm w-full text-center bg-[var(--color-void-light)] border border-[var(--color-void-border)] rounded-2xl p-6">
        <div class="text-4xl mb-3" aria-hidden="true">🔒</div>
        <h1 class="font-[var(--font-display)] text-xl font-bold text-[var(--color-gold)] mb-2">
          {copy.title} is locked in the demo
        </h1>
        <p class="text-sm text-[var(--color-parchment)] opacity-70 leading-relaxed mb-5">
          {copy.blurb}
          <br />
          Create a free account to save to the cloud and unlock the Trading Post, Leaderboard,
          bosses, raids, daily tasks and more.
        </p>
        <p class="text-xs text-[var(--color-parchment)] opacity-50 mb-5 leading-relaxed">
          You're playing the offline demo — skilling, combat, quests, clues and minigames are all
          available and your progress is saved on this device.
        </p>
        {onBack && (
          <button
            onClick={onBack}
            class="w-full font-[var(--font-display)] font-bold text-sm py-3 rounded-xl min-h-[48px] bg-[var(--color-gold)] text-[var(--color-void)] hover:bg-[var(--color-gold-light)] transition-colors"
          >
            Back to Home
          </button>
        )}
      </div>
    </div>
  )
}
