import { useRef } from 'preact/hooks'
import { landingImages } from './landingImages.js'

const FEATURES = [
  {
    icon: '⚔️',
    title: 'Bosses & Raids',
    desc: 'God Wars Dungeon, Dragons Lair, Wilderness, and end-game Raids. Set your setup, then fight on autopilot.',
    img: landingImages['ss-combat-select'],
    imgAlt: 'Monster and boss selection screen',
  },
  {
    icon: '📈',
    title: '15+ Skills',
    desc: 'Level Attack, Thieving, Mining, Fishing and more from 1 to 99. XP ticks every 600ms — even when the screen is off.',
    img: landingImages['ss-thieving'],
    imgAlt: 'Thieving skill with live XP and coin rates',
  },
  {
    icon: '🏦',
    title: 'Deep Economy',
    desc: 'A bank with hundreds of slots, a live Trading Post, and 221 Collection Log entries to hunt.',
    img: landingImages['ss-bank'],
    imgAlt: 'Bank filled with hundreds of stacked items',
  },
  {
    icon: '📜',
    title: '168 Quests',
    desc: 'Quest chains from Novice to Elite, each rewarding XP, items, and lore. Chase the max Quest Point cape.',
    img: landingImages['ss-quests'],
    imgAlt: 'Quest log showing completed quests',
  },
]

const STRIP = [
  { src: landingImages['ss-inventory'], alt: 'Full inventory' },
  { src: landingImages['ss-combat'], alt: 'Boss fight in progress' },
  { src: landingImages['ss-farming'], alt: 'Farming locations' },
  { src: landingImages['ss-collection'], alt: 'Collection Log' },
  { src: landingImages['ss-trading'], alt: 'Trading Post market' },
]

export default function LandingScreen({ onGitHubLogin, onGoogleLogin, embedded, showBrowserHint, copied, onCopyLink }) {
  const authRef = useRef(null)

  function scrollToAuth() {
    authRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div class="h-full overflow-y-auto bg-[var(--color-void)]">

      {/* ── Hero ── */}
      <section class="flex flex-col items-center text-center px-6 pt-14 pb-10">
        <h1 class="font-display text-5xl font-black text-[var(--color-gold)] tracking-wide leading-tight mb-2">
          PocketRPG
        </h1>
        <p class="text-lg text-[var(--color-parchment)] mb-1 max-w-xs opacity-90">
          Level up while you live your life.
        </p>
        <p class="text-sm text-[var(--color-parchment)] opacity-55 max-w-xs leading-relaxed mb-8">
          A tick-based idle fantasy RPG. Combat, skills, quests, and raids that progress whether you're watching or not.
        </p>
        <button
          onClick={scrollToAuth}
          class="font-display font-bold text-base bg-[var(--color-gold)] text-[var(--color-void)] px-10 py-4 rounded-2xl min-h-[52px] min-w-[180px] hover:bg-[var(--color-gold-light)] transition-colors mb-10 tracking-wide"
        >
          Play Now — Free
        </button>
        <div class="w-full max-w-[280px] rounded-2xl overflow-hidden border border-[var(--color-gold-dim)] shadow-2xl">
          <img
            src={landingImages['ss-stats']}
            alt="PocketRPG skills overview — Combat 102, Total Level 1457"
            class="w-full block"
            loading="eager"
          />
        </div>
      </section>

      {/* ── Features ── */}
      <section class="px-4 pb-12">
        <h2 class="font-display text-2xl font-bold text-[var(--color-gold)] text-center mb-8 tracking-wide">
          Everything in your pocket
        </h2>
        <div class="grid grid-cols-2 gap-4 max-w-2xl mx-auto">
          {FEATURES.map(f => (
            <div key={f.title} class="bg-[var(--color-void-light)] border border-[var(--color-void-border)] rounded-2xl overflow-hidden flex flex-col">
              <div class="overflow-hidden max-h-48">
                <img src={f.img} alt={f.imgAlt} class="w-full object-cover object-top" loading="lazy" />
              </div>
              <div class="p-3 flex flex-col gap-1">
                <div class="text-xl">{f.icon}</div>
                <h3 class="font-display font-bold text-sm text-[var(--color-gold)]">{f.title}</h3>
                <p class="text-xs text-[var(--color-parchment)] opacity-65 leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Screenshot strip ── */}
      <section class="pb-12">
        <h2 class="font-display text-2xl font-bold text-[var(--color-gold)] text-center mb-6 tracking-wide px-4">
          See it in action
        </h2>
        <div class="flex gap-3 overflow-x-auto px-4 pb-3 snap-x snap-mandatory">
          {STRIP.map(s => (
            <div key={s.src} class="flex-none w-36 snap-start rounded-xl overflow-hidden border border-[var(--color-void-border)] shadow-lg">
              <img src={s.src} alt={s.alt} class="w-full block" loading="lazy" />
            </div>
          ))}
        </div>
      </section>

      {/* ── Auth CTA ── */}
      <section ref={authRef} class="px-4 pb-16 pt-2">
        <div class="max-w-sm mx-auto bg-[var(--color-void-light)] border border-[var(--color-void-border)] rounded-2xl p-6">
          <h2 class="font-display text-2xl font-bold text-[var(--color-gold)] text-center mb-1 tracking-wide">
            Start your adventure
          </h2>
          <p class="text-sm text-center text-[var(--color-parchment)] opacity-60 mb-6 leading-relaxed">
            Free account. Progress saved to the cloud.<br />Play across all your devices.
          </p>

          <button
            onClick={onGitHubLogin}
            class="w-full font-display font-bold text-sm py-4 rounded-xl mb-3 min-h-[52px] tracking-wide bg-[var(--color-gold)] text-[var(--color-void)] hover:bg-[var(--color-gold-light)] transition-colors flex items-center justify-center gap-2"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" class="flex-none" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Continue with GitHub
          </button>

          <button
            onClick={onGoogleLogin}
            class="w-full font-display font-bold text-sm py-4 rounded-xl mb-4 min-h-[52px] tracking-wide bg-white text-[#1f1f1f] hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            <span
              class="inline-flex items-center justify-center w-5 h-5 rounded-full font-bold text-white text-xs flex-none"
              style={{ background: 'conic-gradient(from -45deg, #ea4335 0 25%, #fbbc05 25% 50%, #34a853 50% 75%, #4285f4 75% 100%)' }}
            >
              G
            </span>
            Continue with Google
          </button>

          {embedded && (
            <div class="bg-[#1a1200] border border-[var(--color-gold-dim)] rounded-xl p-3 mb-4">
              <div class="text-xs text-[var(--color-gold)] font-bold mb-1.5">
                ⚠️ Google sign-in needs your real browser
              </div>
              <div class="text-xs text-[var(--color-parchment)] opacity-80 leading-relaxed mb-2">
                You're in an in-app browser, which Google blocks. Tap ••• or Share → <strong>Open in Safari</strong> / <strong>Open in Chrome</strong>. GitHub works as-is.
              </div>
              {showBrowserHint && (
                <button
                  type="button"
                  onClick={onCopyLink}
                  class="w-full border border-[var(--color-void-border)] text-[var(--color-parchment)] py-2 rounded-lg text-xs min-h-[44px] hover:bg-[var(--color-void-lighter)] transition-colors"
                >
                  {copied ? '✓ Link copied' : '🔗 Copy link to open in browser'}
                </button>
              )}
            </div>
          )}

          <p class="text-xs text-center text-[var(--color-parchment)] opacity-40 leading-relaxed">
            GitHub and Google accounts are kept separate — signing in with a different provider gives you a different character roster.
          </p>
        </div>
      </section>
    </div>
  )
}
