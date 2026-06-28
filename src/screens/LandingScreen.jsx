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

export default function LandingScreen({ onGitHubLogin, onGoogleLogin, onPlayDemo, embedded, showBrowserHint, copied, onCopyLink }) {
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
        showBrowserHint={showBrowserHint}
        copied={copied}
        onCopyLink={onCopyLink}
      />
    )
  }

  return (
    <div class="ml-root">
      <section class="ml-hero">
        <div class="ml-kicker">Idle fantasy RPG</div>
        <h1 class="ml-title">PocketRPG</h1>
        <p class="ml-tagline">Train, quest, fight bosses, and build your bank in focused daily sessions.</p>
        <div class="ml-actions">
          {onPlayDemo && <button onClick={onPlayDemo} class="ml-btn ml-btn--primary">Play Demo</button>}
          <button onClick={scrollToAuth} class="ml-btn ml-btn--secondary">Create Account</button>
        </div>
        <p class="ml-note">Try the offline demo first. Sign in when you're ready for cloud saves, raids, the Trading Post, and leaderboards.</p>
        <div class="ml-phone-stage">
          <div class="ml-mini-card ml-mini-card--left"><b>600ms</b><span>tick</span></div>
          <div class="ml-mini-card ml-mini-card--right"><b>24</b><span>skills</span></div>
          <div class="ml-phone">
            <img src={landingImages['ss-stats']} srcset={landingSrcSet(landingImages['ss-stats'])} sizes="300px" alt="PocketRPG skills overview — Combat 126, Total Level 2,376" width="560" height="1068" loading="eager" fetchpriority="high" decoding="async" />
          </div>
        </div>
      </section>

      <section class="ml-section">
        <div class="ml-section-head"><span>Game loops</span><h2>Progress that fits around your day.</h2></div>
        <div class="ml-feature-grid">
          {FEATURES.map(f => (
            <article key={f.title} class="ml-feature-card">
              <img src={f.img} srcset={landingSrcSet(f.img)} sizes="(min-width: 672px) 328px, 45vw" alt={f.imgAlt} width={LANDING_DIMS[f.imgKey].w} height={LANDING_DIMS[f.imgKey].h} loading="lazy" decoding="async" />
              <div><span class="ml-feature-icon">{f.icon}</span><h3>{f.title}</h3><p>{f.desc}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section class="ml-section ml-section--flush">
        <div class="ml-section-head"><span>Screenshots</span><h2>Everything is built for quick decisions.</h2></div>
        <div class="ml-shot-rail">
          {STRIP.map(s => (
            <div key={s.src} class="ml-shot"><img src={s.src} srcset={landingSrcSet(s.src)} sizes="158px" alt={s.alt} width={LANDING_DIMS[s.key].w} height={LANDING_DIMS[s.key].h} loading="lazy" decoding="async" /></div>
          ))}
        </div>
      </section>

      <section ref={authRef} class="ml-auth-wrap">
        <div class="ml-auth-card">
          <div class="ml-auth-sigil">✦</div>
          <h2>Start your adventure</h2>
          <p>Free account. Cloud saves. Play across all your devices.</p>
          <button onClick={onGitHubLogin} class="ml-auth-btn ml-auth-btn--github">Continue with GitHub</button>
          <button onClick={onGoogleLogin} class="ml-auth-btn ml-auth-btn--google">Continue with Google</button>
          {embedded && (
            <div class="ml-embed-hint">
              <b>⚠️ Google sign-in needs your real browser</b>
              <span>Open this page in Safari or Chrome. GitHub works as-is.</span>
              {showBrowserHint && <button type="button" onClick={onCopyLink}>{copied ? '✓ Link copied' : '🔗 Copy link to open in browser'}</button>}
            </div>
          )}
          <small>GitHub and Google accounts are kept separate — each provider creates a different character roster.</small>
        </div>
      </section>
    </div>
  )
}
