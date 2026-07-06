import { useRef } from 'preact/hooks'
import { landingImages } from './landingImages.js'
import { landingSrcSet } from '../utils/helpers.js'
import { useIsDesktop } from '../hooks/useIsDesktop.js'
import { LANDING_STATS, LANDING_TIERS, LANDING_PLACES, LANDING_FEATURES } from './landingContent.js'
import DesktopLandingScreen from './DesktopLandingScreen.jsx'

// Portrait screenshots are captured at 780×1688 and downscaled to 560w (see
// public/landing). Painted place scenes (lp-*) are 560×313.
const SHOT_DIMS = { w: 560, h: 1212 }
const FEATURE_EMOJI = { crossed_swords: '⚔️', progression: '📈', cash: '🪙', scroll: '📜' }

// Painted-scene srcset: a 360w variant plus the 560w original.
const sceneSrcSet = (url) => url ? `${url.replace(/\.webp$/, '-360.webp')} 360w, ${url} 560w` : undefined
// Realm map srcset: 480 / 760 / 1108 widths.
const mapSrcSet = (url) => url
  ? `${url.replace(/\.webp$/, '-480.webp')} 480w, ${url.replace(/\.webp$/, '-760.webp')} 760w, ${url} 1108w`
  : undefined

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
    <div class="lp-root">

      {/* ── Hero ── */}
      <section class="lp-hero">
        <div class="lp-eyebrow">Tick-based idle fantasy RPG</div>
        <h1 class="lp-brand">PocketRPG</h1>
        <p class="lp-tagline">Level up while you live your life.</p>
        <p class="lp-sub">
          Explore a hand-painted world of 14 settlements. Skill, quest, and raid on a
          deterministic 600ms tick — whether you're watching or not.
        </p>

        <div class="lp-cta">
          {onPlayDemo && (
            <button onClick={onPlayDemo} class="lp-btn lp-btn--ember">Play Demo</button>
          )}
          <button onClick={scrollToAuth} class="lp-btn lp-btn--ghost">Sign in — save to cloud</button>
        </div>
        <p class="lp-note">
          The demo runs offline in your browser. Sign in for cloud saves, raids, the
          Trading Post and leaderboards.
        </p>

        <figure class="lp-mapframe">
          <img
            src={landingImages['lp-map']} srcset={mapSrcSet(landingImages['lp-map'])}
            sizes="(min-width: 520px) 480px, 92vw"
            alt="The realm of Eldermoor — a hand-painted world map"
            width="1108" height="594" loading="eager" fetchpriority="high" decoding="async"
          />
          <figcaption class="lp-mapcap">The realm of Eldermoor</figcaption>
        </figure>

        <div class="lp-proof">
          {LANDING_STATS.map(([v, l]) => (
            <div class="lp-proof__item" key={l}><b>{v}</b><span>{l}</span></div>
          ))}
        </div>
      </section>

      {/* ── World map / places ── */}
      <section class="lp-section">
        <div class="lp-head">
          <div class="lp-eyebrow lp-eyebrow--brass">The world</div>
          <h2 class="lp-title">Explore the realm</h2>
          <p class="lp-lead">
            Travel the roads between towns and cities, or teleport ahead. Every place has its
            own painted scene, facilities, and things to fight, gather, or plunder.
          </p>
        </div>

        <div class="lp-legend">
          {LANDING_TIERS.map(t => (
            <div class="lp-legend__row" key={t.id}>
              <span class="lp-dot" style={{ background: t.color }} />
              <b>{t.label}</b>
              <span class="lp-legend__blurb">{t.blurb}</span>
            </div>
          ))}
        </div>

        <div class="lp-places" role="list">
          {LANDING_PLACES.map(p => (
            <article class="lp-place" role="listitem" key={p.id}>
              <div class="lp-place__art">
                <img
                  src={landingImages[p.img]} srcset={sceneSrcSet(landingImages[p.img])}
                  sizes="240px" alt={`${p.name} — ${p.sub}`}
                  width="560" height="313" loading="lazy" decoding="async"
                />
                <span class={`lp-tier lp-tier--${p.tier}`}>{p.tier}</span>
              </div>
              <div class="lp-place__body">
                <h3 class="lp-place__name">{p.name}</h3>
                <div class="lp-place__sub">{p.sub}</div>
                <p class="lp-place__blurb">{p.blurb}</p>
              </div>
            </article>
          ))}
        </div>
        <p class="lp-swipe">Swipe to roam →</p>
      </section>

      {/* ── Features ── */}
      <section class="lp-section">
        <div class="lp-head">
          <div class="lp-eyebrow lp-eyebrow--brass">The game</div>
          <h2 class="lp-title">Everything in your pocket</h2>
        </div>
        <div class="lp-features">
          {LANDING_FEATURES.map(f => (
            <div class="lp-feature" key={f.title}>
              <div class="lp-feature__shot">
                <img src={landingImages[f.img]} srcset={landingSrcSet(landingImages[f.img])}
                     sizes="(min-width: 672px) 328px, 45vw" alt={f.title}
                     width={SHOT_DIMS.w} height={SHOT_DIMS.h} loading="lazy" decoding="async" />
              </div>
              <div class="lp-feature__body">
                <div class="lp-feature__ico" aria-hidden="true">{FEATURE_EMOJI[f.icon] || '✦'}</div>
                <h3 class="lp-feature__title">{f.title}</h3>
                <p class="lp-feature__desc">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Screenshot strip ── */}
      <section class="lp-section">
        <div class="lp-head">
          <div class="lp-eyebrow lp-eyebrow--brass">Screens</div>
          <h2 class="lp-title">See it in action</h2>
        </div>
        <div class="lp-strip">
          {['ss-worldmap', 'ss-place', 'ss-combat', 'ss-bank', 'ss-bosses', 'ss-leaderboard', 'ss-collection', 'ss-connect'].map(key => (
            <div class="lp-strip__shot" key={key}>
              <img src={landingImages[key]} srcset={landingSrcSet(landingImages[key])} sizes="150px"
                   alt="PocketRPG screen" width={SHOT_DIMS.w} height={SHOT_DIMS.h}
                   loading="lazy" decoding="async" />
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section class="lp-section">
        <div class="lp-head">
          <div class="lp-eyebrow lp-eyebrow--brass">The loop</div>
          <h2 class="lp-title">How idle progress works</h2>
        </div>
        <ol class="lp-steps">
          {[
            ['Pick a place', 'Travel to a town or city and choose a foe to fight, a skill to train, or a quest to chase. Set your loadout once.'],
            ['Progress on a tick', 'The world advances on a deterministic 600ms tick — XP, drops, and rewards accrue whether the app is open or closed.'],
            ['Come back richer', 'Idle time is simulated when you return. Cloud saves keep your roster in sync across every device.'],
          ].map(([t, d], i) => (
            <li class="lp-step" key={t}>
              <span class="lp-step__n">{i + 1}</span>
              <div>
                <h4 class="lp-step__t">{t}</h4>
                <p class="lp-step__d">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Auth CTA ── */}
      <section ref={authRef} class="lp-section lp-section--cta">
        <div class="lp-authcard">
          <h2 class="lp-title lp-title--center">Start your adventure</h2>
          <p class="lp-authcard__sub">
            Free account. Progress saved to the cloud.<br />Play across all your devices.
          </p>

          <button
            onClick={hosted ? undefined : onGitHubLogin}
            disabled={hosted}
            style={hosted ? { pointerEvents: 'none' } : undefined}
            class="lp-oauth lp-oauth--github"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" class="lp-oauth__ico" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Continue with GitHub
          </button>

          <button
            onClick={hosted ? undefined : onGoogleLogin}
            disabled={hosted}
            style={hosted ? { pointerEvents: 'none' } : undefined}
            class="lp-oauth lp-oauth--google"
          >
            <span
              class="lp-oauth__g"
              style={{ background: 'conic-gradient(from -45deg, #ea4335 0 25%, #fbbc05 25% 50%, #34a853 50% 75%, #4285f4 75% 100%)' }}
            >G</span>
            Continue with Google
          </button>

          {hosted && (
            <p class="lp-authcard__hosted">
              Sign in &amp; save your progress at{' '}
              <a href="https://pocketrpg.co.uk" target="_blank" rel="noopener">pocketrpg.co.uk</a>
            </p>
          )}

          {embedded && (
            <div class="lp-embed">
              <div class="lp-embed__title">⚠️ Google sign-in needs your real browser</div>
              <div class="lp-embed__body">
                You're in an in-app browser, which Google blocks. Tap ••• or Share →{' '}
                <strong>Open in Safari</strong> / <strong>Open in Chrome</strong>. GitHub works as-is.
              </div>
              {showBrowserHint && (
                <button type="button" onClick={onCopyLink} class="lp-embed__copy">
                  {copied ? '✓ Link copied' : '🔗 Copy link to open in browser'}
                </button>
              )}
            </div>
          )}

          <p class="lp-fine">
            GitHub and Google accounts are kept separate — signing in with a different provider
            gives you a different character roster.
          </p>
        </div>
      </section>

      <footer class="lp-footer">
        <span class="lp-footer__brand">PocketRPG</span>
        <span>Level up while you live your life.</span>
        <span class="lp-footer__url">pocketrpg.co.uk</span>
      </footer>
    </div>
  )
}
