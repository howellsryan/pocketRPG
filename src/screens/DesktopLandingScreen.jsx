import { useEffect, useState } from 'preact/hooks'
import { landingImages } from './landingImages.js'
import { landingSrcSet } from '../utils/helpers.js'
import { homeLogo } from '../utils/homeLogo.js'
import { getSkillArt } from '../utils/skillArt.js'
import { LANDING_STATS, LANDING_TIERS, LANDING_PLACES, LANDING_FEATURES } from './landingContent.js'
import GameIcon from '../components/GameIcon.jsx'

// Wide marketing landing for desktop (≥768px). Built in the game's bespoke
// "Forgemark" identity (parchment on hammered iron, gilt blackletter, ember
// CTAs) around the real product: the hand-painted world map, the 14 painted
// place scenes, Forgemark UI screenshots, and the live GitHub/Google handlers.
//
// All top-level identifiers are DL_-prefixed and all CSS classes dl-* so the
// single-file build (which concatenates every module at top level) stays free
// of duplicate-identifier collisions with the mobile LandingScreen.

const DL_SHOT_DIMS = { w: 560, h: 1212 }

const DL_SKILLS = [
  ['attack', 'Attack'], ['strength', 'Strength'], ['defence', 'Defence'], ['hitpoints', 'Hitpoints'],
  ['ranged', 'Ranged'], ['magic', 'Magic'], ['prayer', 'Prayer'], ['mining', 'Mining'],
  ['woodcutting', 'Woodcut'], ['fishing', 'Fishing'], ['farming', 'Farming'], ['smithing', 'Smithing'],
  ['cooking', 'Cooking'], ['crafting', 'Crafting'], ['herblore', 'Herblore'], ['runecraft', 'Runecraft'],
  ['firemaking', 'Firemaking'], ['agility', 'Agility'], ['thieving', 'Thieving'], ['hunter', 'Hunter'],
  ['slayer', 'Slayer'], ['construction', 'Construct.'], ['fletching', 'Fletching'], ['dungeoneering', 'Dungeon.'],
]

const DL_GALLERY = ['ss-worldmap', 'ss-place', 'ss-combat', 'ss-bank', 'ss-bosses', 'ss-trading', 'ss-collection', 'ss-leaderboard', 'ss-connect']

const DL_STEPS = [
  ['Pick a place', 'Travel to a town or city and choose a foe to fight, a skill to train, or a quest to chase. Set your loadout once.'],
  ['Progress on a tick', 'The world advances on a deterministic 600ms tick — XP, drops, and rewards accrue whether the app is open or closed.'],
  ['Come back richer', 'Idle time is simulated when you return. Cloud saves keep your roster in sync across every device.'],
]

const DL_SCENE_SRCSET = (url) => url ? `${url.replace(/\.webp$/, '-360.webp')} 360w, ${url} 560w` : undefined
const DL_MAP_SRCSET = (url) => url
  ? `${url.replace(/\.webp$/, '-480.webp')} 480w, ${url.replace(/\.webp$/, '-760.webp')} 760w, ${url} 1108w`
  : undefined

function DlEmblem({ size }) {
  if (homeLogo) {
    return <img class="dl-emblem dl-emblem--logo" src={homeLogo} alt="PocketRPG"
      style={{ width: size, height: size }} width={size} height={size}
      loading="eager" decoding="async" />
  }
  return (
    <div class="dl-emblem" style={{ '--E': `${size}px`, width: size, height: size }} aria-hidden="true">
      <GameIcon iconKey="shield" color="#7d8a99" size={Math.round(size * 0.52)} class="dl-emblem__shield" title="" />
      <GameIcon iconKey="crossed_swords" color="#f0c040" size={Math.round(size * 0.58)} class="dl-emblem__art" title="" />
    </div>
  )
}

function DlGitHubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" class="dl-btn__ico">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

export default function DesktopLandingScreen({ onGitHubLogin, onGoogleLogin, onPlayDemo, embedded, hosted, showBrowserHint, copied, onCopyLink }) {
  // The desktop landing renders game-icons glyphs, whose data (gameIconsData)
  // ships in the lazily-loaded game chunk in the single-file build. Fetch it on
  // mount and re-render once it arrives so the icons swap in from their emoji
  // fallback. No-op in the Vite builds, where gameIconsData is statically
  // bundled and the icons render immediately.
  const [, bumpIcons] = useState(0)
  useEffect(() => {
    const load = (typeof globalThis !== 'undefined') && globalThis.__loadGameChunk
    if (load) load().then(() => bumpIcons(n => n + 1)).catch(() => {})
  }, [])

  useEffect(() => {
    const els = document.querySelectorAll('.dl-reveal')
    if (typeof IntersectionObserver === 'undefined') {
      els.forEach(el => el.classList.add('dl-in'))
      return undefined
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('dl-in'); io.unobserve(e.target) }
      })
    }, { threshold: 0.12 })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <div class="dl-root" id="dl-top">
      <header class="dl-nav">
        <div class="dl-wrap dl-nav__inner">
          <a class="dl-brand" href="#dl-top">
            <DlEmblem size={40} />
            <span class="dl-word dl-gilt">PocketRPG</span>
          </a>
          <nav class="dl-nav__links">
            <a href="#dl-world">The World</a>
            <a href="#dl-features">Features</a>
            <a href="#dl-skills">Skills</a>
            <a href="#dl-gallery">Screenshots</a>
          </nav>
          <div class="dl-nav__right">
            <a class="dl-signin" href="#dl-play">Sign in</a>
            {onPlayDemo
              ? <button type="button" class="dl-btn dl-btn--ember" onClick={onPlayDemo}>Play Demo</button>
              : <a class="dl-btn dl-btn--ember" href="#dl-play">Play Now — Free</a>}
          </div>
        </div>
      </header>

      <div class="dl-main">
        {/* HERO */}
        <section class="dl-hero">
          <div class="dl-wrap dl-hero__grid">
            <div class="dl-hero__copy">
              <span class="dl-eyebrow">Tick-based idle fantasy RPG</span>
              <h1 class="dl-hero__h1"><span class="dl-gilt">Level up</span><br />while you live<br />your life.</h1>
              <p class="dl-hero__sub">Explore a hand-painted world of 14 settlements. Skill, quest, and raid on a deterministic 600ms tick — whether you're watching or not.</p>
              <div class="dl-hero__cta">
                {onPlayDemo
                  ? <button type="button" class="dl-btn dl-btn--ember dl-btn--lg" onClick={onPlayDemo}>Play Demo</button>
                  : <a class="dl-btn dl-btn--ember dl-btn--lg" href="#dl-play">Play Now — Free</a>}
                <a class="dl-btn dl-btn--ghost dl-btn--lg" href="#dl-play">Sign in — save to cloud</a>
              </div>
              {onPlayDemo && (
                <p class="dl-hero__note">No account needed — the demo runs offline in your browser. Sign in for cloud saves, raids, the Trading Post and leaderboards.</p>
              )}
              <div class="dl-hero__proof">
                {LANDING_STATS.slice(0, 3).map((s, i) => (
                  <div class="dl-proof" key={s[1]}><b>{s[0]}</b><span>{s[1]}</span>{i < 2 && <i class="dl-proof-div" />}</div>
                ))}
              </div>
            </div>
            <figure class="dl-hero__map">
              <img src={landingImages['lp-map']} srcset={DL_MAP_SRCSET(landingImages['lp-map'])}
                   sizes="(min-width: 1180px) 560px, 90vw" alt="The realm of Eldermoor — a hand-painted world map"
                   width="1108" height="594" loading="eager" fetchpriority="high" decoding="async" />
              <figcaption>The realm of Eldermoor · 14 settlements</figcaption>
            </figure>
          </div>
        </section>

        {/* STAT STRIP */}
        <div class="dl-strip">
          <div class="dl-wrap dl-strip__inner">
            {LANDING_STATS.map(s => (
              <div class="dl-stat" key={s[1]}><b>{s[0]}</b><span>{s[1]}</span></div>
            ))}
          </div>
        </div>

        {/* WORLD / PLACES */}
        <section class="dl-block" id="dl-world">
          <div class="dl-wrap">
            <div class="dl-head dl-reveal">
              <span class="dl-eyebrow">The world</span>
              <h2 class="dl-title dl-gilt">Explore the realm of Eldermoor</h2>
              <p>Travel the roads between towns and cities, or teleport ahead. Every place has its own painted scene, its own facilities, and its own things to fight, gather, and plunder.</p>
            </div>
            <div class="dl-legend dl-reveal">
              {LANDING_TIERS.map(t => (
                <div class="dl-legrow" key={t.id}>
                  <span class="dl-dot" style={{ background: t.color }} />
                  <b>{t.label}</b><span>{t.blurb}</span>
                </div>
              ))}
            </div>
            <div class="dl-places">
              {LANDING_PLACES.map(p => (
                <article class="dl-place dl-reveal" key={p.id}>
                  <div class="dl-place__art">
                    <img src={landingImages[p.img]} srcset={DL_SCENE_SRCSET(landingImages[p.img])}
                         sizes="(min-width: 1000px) 300px, 45vw" alt={`${p.name} — ${p.sub}`}
                         width="560" height="313" loading="lazy" decoding="async" />
                    <span class={`dl-tier dl-tier--${p.tier}`}>{p.tier}</span>
                  </div>
                  <div class="dl-place__body">
                    <h3>{p.name}</h3>
                    <div class="dl-place__sub">{p.sub}</div>
                    <p>{p.blurb}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section class="dl-block dl-band" id="dl-features">
          <div class="dl-wrap">
            <div class="dl-head dl-reveal">
              <span class="dl-eyebrow">The game</span>
              <h2 class="dl-title dl-gilt">Everything in your pocket</h2>
              <p>A full fantasy MMO-style progression loop, distilled into menus that respect your time.</p>
            </div>
            <div class="dl-features">
              {LANDING_FEATURES.map(f => (
                <div class="dl-feature dl-reveal" key={f.title}>
                  <div class="dl-feature__media">
                    <div class="dl-frame"><img src={landingImages[f.img]} srcset={landingSrcSet(landingImages[f.img])} sizes="248px" alt={f.title}
                      width={DL_SHOT_DIMS.w} height={DL_SHOT_DIMS.h} loading="lazy" decoding="async" /></div>
                  </div>
                  <div class="dl-feature__copy">
                    <div class="dl-feature__ico"><GameIcon iconKey={f.icon} color="#c2410c" size={30} title="" /></div>
                    <h3>{f.title}</h3>
                    <p>{f.desc}</p>
                    <div class="dl-tags">{f.tags.map(t => <span class="dl-tag" key={t}>{t}</span>)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SKILLS BAND */}
        <section class="dl-block" id="dl-skills">
          <div class="dl-wrap">
            <div class="dl-head dl-reveal">
              <span class="dl-eyebrow">Skilling</span>
              <h2 class="dl-title dl-gilt">Train 24 skills to 99</h2>
              <p>Every skill ticks live and idles offline. Combat, gathering, production, and utility — pick your path to the max cape.</p>
            </div>
            <div class="dl-skills__grid">
              {DL_SKILLS.map(([skill, label]) => (
                <div class="dl-skchip dl-reveal" key={skill}>
                  <GameIcon iconKey={getSkillArt(skill).icon} color="#7c2708" size={28} title={label} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* GALLERY */}
        <section class="dl-block dl-band" id="dl-gallery">
          <div class="dl-wrap">
            <div class="dl-head dl-reveal">
              <span class="dl-eyebrow">Screens</span>
              <h2 class="dl-title dl-gilt">See it in action</h2>
              <p>From the world map to the boss arena — here's what your adventure actually looks like.</p>
            </div>
          </div>
          <div class="dl-gallery-wrap">
            <div class="dl-gallery">
              {DL_GALLERY.map(g => (
                <div class="dl-shot" key={g}><img src={landingImages[g]} srcset={landingSrcSet(landingImages[g])} sizes="200px" alt="PocketRPG screen"
                  width={DL_SHOT_DIMS.w} height={DL_SHOT_DIMS.h} loading="lazy" decoding="async" /></div>
              ))}
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section class="dl-block" id="dl-how">
          <div class="dl-wrap">
            <div class="dl-head dl-reveal">
              <span class="dl-eyebrow">The loop</span>
              <h2 class="dl-title dl-gilt">How idle progress works</h2>
              <p>PocketRPG is simulation-first. Set your intent, and a deterministic engine does the grinding.</p>
            </div>
            <div class="dl-steps">
              {DL_STEPS.map((s, i) => (
                <div class="dl-step dl-reveal" key={s[0]}>
                  <div class="dl-step__n">{i + 1}</div>
                  {i < DL_STEPS.length - 1 && <div class="dl-step__line" />}
                  <h4>{s[0]}</h4>
                  <p>{s[1]}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* AUTH CTA */}
        <section class="dl-cta-band" id="dl-play">
          <div class="dl-wrap">
            <div class="dl-cta dl-reveal">
              <DlEmblem size={72} />
              <h2 class="dl-gilt">Start your adventure</h2>
              <p>Free account. Progress saved to the cloud.<br />Play across all your devices.</p>
              <div class="dl-auth">
                <button class="dl-btn dl-btn--github dl-btn--lg" onClick={hosted ? undefined : onGitHubLogin} disabled={hosted} style={hosted ? { pointerEvents: 'none' } : undefined}>
                  <DlGitHubMark />Continue with GitHub
                </button>
                <button class="dl-btn dl-btn--google dl-btn--lg" onClick={hosted ? undefined : onGoogleLogin} disabled={hosted} style={hosted ? { pointerEvents: 'none' } : undefined}>
                  <span class="dl-gg">G</span>Continue with Google
                </button>
              </div>
              {hosted && (
                <p class="dl-hosted-note">
                  Sign in &amp; save your progress at{' '}
                  <a href="https://pocketrpg.co.uk" target="_blank" rel="noopener">pocketrpg.co.uk</a>
                </p>
              )}
              {embedded && (
                <div class="dl-embed-hint">
                  <div class="dl-embed-hint__title">⚠️ Google sign-in needs your real browser</div>
                  <p>You're in an in-app browser, which Google blocks. Open this page in Safari or Chrome. GitHub works as-is.</p>
                  {showBrowserHint && (
                    <button type="button" class="dl-embed-hint__copy" onClick={onCopyLink}>
                      {copied ? '✓ Link copied' : '🔗 Copy link to open in browser'}
                    </button>
                  )}
                </div>
              )}
              <p class="dl-fineprint">GitHub and Google accounts are kept separate — signing in with a different provider gives you a different character roster.</p>
            </div>
          </div>
        </section>
      </div>

      <footer class="dl-footer">
        <div class="dl-wrap">
          <div class="dl-foot">
            <div class="dl-foot__brand">
              <a class="dl-brand" href="#dl-top"><DlEmblem size={36} /><span class="dl-word dl-gilt">PocketRPG</span></a>
              <p>A menu-driven, tick-based fantasy idle RPG. Built mobile-first, offline-first, and free to play.</p>
            </div>
            <div class="dl-foot__cols">
              <div class="dl-foot__col">
                <h5>Game</h5>
                <a href="#dl-world">The World</a>
                <a href="#dl-features">Features</a>
                <a href="#dl-skills">Skills</a>
                <a href="#dl-gallery">Screenshots</a>
              </div>
              <div class="dl-foot__col">
                <h5>Play</h5>
                <a href="#dl-play">Sign in with GitHub</a>
                <a href="#dl-play">Sign in with Google</a>
                <a href="https://pocketrpg.co.uk" target="_blank" rel="noopener">Live build ↗</a>
              </div>
            </div>
          </div>
          <div class="dl-foot__bottom">
            <span>© 2026 PocketRPG. Level up while you live your life.</span>
            <span>pocketrpg.co.uk</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
