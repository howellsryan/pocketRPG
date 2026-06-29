import { useRef } from 'preact/hooks'
import { landingImages } from './landingImages.js'
import { landingSrcSet } from '../utils/helpers.js'
import { useIsDesktop } from '../hooks/useIsDesktop.js'
import DesktopLandingScreen from './DesktopLandingScreen.jsx'

const LANDING_DIMS = {
  'ss-stats':         { w: 560, h: 1068 },
  'ss-combat-select': { w: 560, h: 1070 },
  'ss-thieving':      { w: 560, h: 991  },
  'ss-bank':          { w: 560, h: 1077 },
  'ss-quests':        { w: 560, h: 990  },
  'ss-inventory':     { w: 560, h: 1032 },
  'ss-combat':        { w: 560, h: 1082 },
  'ss-farming':       { w: 560, h: 995  },
  'ss-collection':    { w: 560, h: 1075 },
  'ss-trading':       { w: 560, h: 1075 },
  'ss-minigames':     { w: 560, h: 1073 },
  'ss-leaderboard':   { w: 560, h: 1076 },
  'ss-connect':       { w: 560, h: 1070 },
}

const FEATURES = [
  {
    icon: '⚔️',
    title: 'Bosses & Raids',
    desc: 'God Wars Dungeon, Dragons Lair, Wilderness, and end-game Raids. Set your setup, then fight on autopilot.',
    imgKey: 'ss-combat-select',
    img: landingImages['ss-combat-select'],
    imgAlt: 'Monster and boss selection screen',
  },
  {
    icon: '📈',
    title: '15+ Skills',
    desc: 'Level Attack, Thieving, Mining, Fishing and more from 1 to 99. XP ticks every 600ms — even when the screen is off.',
    imgKey: 'ss-thieving',
    img: landingImages['ss-thieving'],
    imgAlt: 'Thieving skill with live XP and coin rates',
  },
  {
    icon: '🏦',
    title: 'Deep Economy',
    desc: 'A bank with hundreds of slots, a live Trading Post, and 221 Collection Log entries to hunt.',
    imgKey: 'ss-bank',
    img: landingImages['ss-bank'],
    imgAlt: 'Bank filled with hundreds of stacked items',
  },
  {
    icon: '📜',
    title: '168 Quests',
    desc: 'Quest chains from Novice to Elite, each rewarding XP, items, and lore. Chase the max Quest Point cape.',
    imgKey: 'ss-quests',
    img: landingImages['ss-quests'],
    imgAlt: 'Quest log showing completed quests',
  },
]

const STRIP = [
  { key: 'ss-inventory',  src: landingImages['ss-inventory'],  alt: 'Full inventory' },
  { key: 'ss-combat',     src: landingImages['ss-combat'],     alt: 'Boss fight in progress' },
  { key: 'ss-farming',    src: landingImages['ss-farming'],    alt: 'Farming locations' },
  { key: 'ss-collection', src: landingImages['ss-collection'], alt: 'Collection Log' },
  { key: 'ss-trading',    src: landingImages['ss-trading'],    alt: 'Trading Post market' },
  { key: 'ss-minigames',   src: landingImages['ss-minigames'],   alt: 'Minigame reward grinds' },
  { key: 'ss-leaderboard', src: landingImages['ss-leaderboard'], alt: 'Global leaderboard' },
  { key: 'ss-connect',     src: landingImages['ss-connect'],     alt: 'Connect AI assistant' },
]

export default function LandingScreen({ onGitHubLogin, onGoogleLogin, onPlayDemo, embedded, hosted, showBrowserHint, copied, onCopyLink }) {
  const authRef = useRef(null)
  const isDesktop = useIsDesktop()

  function scrollToAuth() {
    authRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  if (isDesktop) {
    return (
      <DesktopLandingScreen
        onGitHubLogin={onGitHubLogin}
        onGoogleLogin={onGoogleLogin}
        onPlayDemo={onPlayDemo}
        embedded={embedded}
        hosted={hosted}
        showBrowserHint={showBrowserHint}
        copied={copied}
        onCopyLink={onCopyLink}
      />
    )
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
        {onPlayDemo && (
          <button
            onClick={onPlayDemo}
            class="font-display font-bold text-base bg-[var(--color-gold)] text-[var(--color-void)] px-10 py-4 rounded-2xl min-h-[52px] min-w-[180px] hover:bg-[var(--color-gold-light)] transition-colors mb-3 tracking-wide"
          >
            Play Demo
          </button>
        )}
        <button
          onClick={scrollToAuth}
          class="font-display font-semibold text-sm border border-[var(--color-gold-dim)] text-[var(--color-gold)] px-8 py-3 rounded-2xl min-h-[48px] min-w-[180px] hover:border-[var(--color-gold)] transition-colors mb-3 tracking-wide"
        >
          Sign in — save to cloud
        </button>
        <p class="text-xs text-[var(--color-parchment)] opacity-45 mb-10 max-w-xs leading-relaxed">
          The demo runs offline in your browser — skills, combat, quests and more. Sign in for cloud saves, bosses, raids, the Trading Post and leaderboards.
        </p>
        <div class="w-full max-w-[280px] rounded-2xl overflow-hidden border border-[var(--color-gold-dim)] shadow-2xl">
          <img
            src={landingImages['ss-stats']}
            srcset={landingSrcSet(landingImages['ss-stats'])}
            sizes="280px"
            alt="PocketRPG skills overview — Combat 126, Total Level 2,376"
            class="w-full block"
            width="560" height="1068"
            loading="eager"
            fetchpriority="high"
            decoding="async"
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
                <img src={f.img} srcset={landingSrcSet(f.img)}
                     sizes="(min-width: 672px) 328px, 45vw"
                     alt={f.imgAlt} class="w-full object-cover object-top"
                     width={LANDING_DIMS[f.imgKey].w} height={LANDING_DIMS[f.imgKey].h}
                     loading="lazy" decoding="async" />
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
              <img src={s.src} srcset={landingSrcSet(s.src)} sizes="144px"
                   alt={s.alt} class="w-full block"
                   width={LANDING_DIMS[s.key].w} height={LANDING_DIMS[s.key].h}
                   loading="lazy" decoding="async" />
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
            onClick={hosted ? undefined : onGitHubLogin}
            disabled={hosted}
            class={`w-full font-display font-bold text-sm py-4 rounded-xl mb-3 min-h-[52px] tracking-wide bg-[var(--color-gold)] text-[var(--color-void)] transition-colors flex items-center justify-center gap-2${hosted ? ' opacity-40 cursor-not-allowed' : ' hover:bg-[var(--color-gold-light)]'}`}
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" class="flex-none" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Continue with GitHub
          </button>

          <button
            onClick={hosted ? undefined : onGoogleLogin}
            disabled={hosted}
            class={`w-full font-display font-bold text-sm py-4 rounded-xl mb-4 min-h-[52px] tracking-wide bg-white text-[#1f1f1f] transition-opacity flex items-center justify-center gap-2${hosted ? ' opacity-40 cursor-not-allowed' : ' hover:opacity-90'}`}
          >
            <span
              class="inline-flex items-center justify-center w-5 h-5 rounded-full font-bold text-white text-xs flex-none"
              style={{ background: 'conic-gradient(from -45deg, #ea4335 0 25%, #fbbc05 25% 50%, #34a853 50% 75%, #4285f4 75% 100%)' }}
            >
              G
            </span>
            Continue with Google
          </button>

          {hosted && (
            <p class="text-xs text-center text-[var(--color-gold)] opacity-80 mb-4 leading-relaxed">
              Sign in &amp; save your progress at{' '}
              <a href="https://pocketrpg.co.uk" target="_blank" rel="noopener" class="underline">pocketrpg.co.uk</a>
            </p>
          )}

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
