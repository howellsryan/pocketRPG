import { useRef, useState, useEffect } from 'preact/hooks'
import { landingImages } from './landingImages.js'
import { landingSrcSet } from '../utils/helpers.js'
import { getSkillArt } from '../utils/skillArt.js'
import { LANDING_STATS, LANDING_TIERS, LANDING_PLACES, LANDING_MARKERS, LANDING_CARDS, LANDING_HUD_STATS } from './landingContent.js'
import GameIcon from '../components/GameIcon.jsx'
import LandingHero3D from '../components/LandingHero3D.jsx'

// One responsive landing page for every viewport — a night-forge cinematic:
// Warlord Grondar rendered live in WebGL over the void, ember motes, gilt
// blackletter, and scroll-revealed iron sections. All top-level identifiers
// are LP_-prefixed for the single-file concat build (§12).

// Portrait screenshots are captured at 780×1688 and downscaled to 560w (see
// public/landing). Painted place scenes (lp-*) are 560×313.
const LP_SHOT_DIMS = { w: 560, h: 1212 }

const LP_SCENE_SRCSET = (url) => url ? `${url.replace(/\.webp$/, '-360.webp')} 360w, ${url} 560w` : undefined
// Map medallions crop a place scene into a small circle — the 360w variant is plenty.
const LP_MED_SRC = (url) => url ? url.replace(/\.webp$/, '-360.webp') : undefined
const LP_MAP_SRCSET = (url) => url
  ? `${url.replace(/\.webp$/, '-480.webp')} 480w, ${url.replace(/\.webp$/, '-760.webp')} 760w, ${url} 1108w`
  : undefined

const LP_NAV_SECTIONS = [
  ['lp-top', 'Home'],
  ['lp-features', 'Features'],
  ['lp-world', 'The World'],
  ['lp-skills', 'Skills'],
  ['lp-gallery', 'Screens'],
]

const LP_SKILLS = [
  ['attack', 'Attack'], ['strength', 'Strength'], ['defence', 'Defence'], ['hitpoints', 'Hitpoints'],
  ['ranged', 'Ranged'], ['magic', 'Magic'], ['prayer', 'Prayer'], ['mining', 'Mining'],
  ['woodcutting', 'Woodcut'], ['fishing', 'Fishing'], ['farming', 'Farming'], ['smithing', 'Smithing'],
  ['cooking', 'Cooking'], ['crafting', 'Crafting'], ['herblore', 'Herblore'], ['runecraft', 'Runecraft'],
  ['firemaking', 'Firemaking'], ['agility', 'Agility'], ['thieving', 'Thieving'], ['hunter', 'Hunter'],
  ['slayer', 'Slayer'], ['construction', 'Construct.'], ['fletching', 'Fletching'], ['dungeoneering', 'Dungeon.'],
]

const LP_GALLERY = ['ss-home', 'ss-worldmap', 'ss-place', 'ss-combat', 'ss-bosses', 'ss-bank', 'ss-trading', 'ss-collection', 'ss-leaderboard']

const LP_STEPS = [
  ['Pick a place', 'Travel to a town or city and choose a foe to fight, a skill to train, or a quest to chase. Set your loadout once.'],
  ['Progress on a tick', 'The world advances on a deterministic 600ms tick — XP, drops, and rewards accrue whether the app is open or closed.'],
  ['Come back richer', 'Idle time is simulated when you return. Cloud saves keep your roster in sync across every device.'],
]

function LpGitHubMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" class="lp-oauth__ico" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

export default function LandingScreen({ onGitHubLogin, onGoogleLogin, onPlayDemo, embedded, hosted, showBrowserHint, copied, onCopyLink }) {
  const authRef = useRef(null)

  // The bespoke game-icons glyphs used below ship in the lazily-loaded game
  // chunk. Fetch it on mount and re-render once it arrives so the icons swap
  // in from GameIcon's placeholder fallback.
  const [, bumpIcons] = useState(0)
  useEffect(() => {
    const load = (typeof globalThis !== 'undefined') && globalThis.__loadGameChunk
    if (load) load().then(() => bumpIcons(n => n + 1)).catch(() => {})
  }, [])

  // Scroll-spy: track which section sits under the sticky nav.
  const [activeSection, setActiveSection] = useState('lp-top')
  useEffect(() => {
    const sections = LP_NAV_SECTIONS.map(([id]) => document.getElementById(id)).filter(Boolean)
    if (typeof IntersectionObserver === 'undefined' || !sections.length) return undefined
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) setActiveSection(e.target.id) })
    }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 })
    sections.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [])

  // Scroll-reveal. CSS neutralises the hidden state under
  // prefers-reduced-motion, so revealing is purely progressive enhancement.
  useEffect(() => {
    const els = document.querySelectorAll('.lp-reveal')
    if (typeof IntersectionObserver === 'undefined') {
      els.forEach(el => el.classList.add('lp-in'))
      return undefined
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('lp-in'); io.unobserve(e.target) }
      })
    }, { threshold: 0.12 })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [])

  function scrollToAuth() {
    authRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div class="lp-root">

      {/* ── Sticky iron nav ── */}
      <header class="lp-nav">
        <div class="lp-nav__inner">
          <a class="lp-nav__brand lp-gilt" href="#lp-top">PocketRPG</a>
          <nav class="lp-nav__links" aria-label="Sections">
            {LP_NAV_SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} class={activeSection === id ? 'lp-nav__link--on' : ''}>{label}</a>
            ))}
          </nav>
          {onPlayDemo
            ? <button type="button" class="lp-play lp-play--nav" onClick={onPlayDemo}>Play</button>
            : <button type="button" class="lp-play lp-play--nav" onClick={scrollToAuth}>Play</button>}
        </div>
      </header>

      {/* ── Hero — the boss reveal ── */}
      <section class="lp-hero" id="lp-top">
        <div class="lp-hero__void" aria-hidden="true">
          <i /><i /><i /><i /><i /><i />
        </div>
        <div class="lp-hero__inner">
          <div class="lp-hero__copy">
            <p class="lp-eyebrow lp-hero__rise">A medieval idle RPG</p>
            <h1 class="lp-brand lp-hero__rise">PocketRPG</h1>
            <div class="lp-orntag lp-hero__rise"><i /><span>Forge your legend</span><i /></div>
            <p class="lp-sub lp-hero__rise">
              Embark on an endless adventure. Train your hero. Complete quests.
              Conquer raids. Be legendary.
            </p>
            <div class="lp-cta lp-hero__rise">
              {onPlayDemo
                ? <button onClick={onPlayDemo} class="lp-play">Play Demo</button>
                : <button onClick={scrollToAuth} class="lp-play">Play Now</button>}
              <button onClick={scrollToAuth} class="lp-signin">Sign in</button>
            </div>
            {onPlayDemo && (
              <p class="lp-note lp-hero__rise">
                The demo runs offline in your browser. Sign in for cloud saves, raids, the
                Trading Post and leaderboards.
              </p>
            )}
          </div>

          <div class="lp-hero__stage lp-hero__rise">
            <LandingHero3D
              poster={landingImages['lp-grondar']}
              posterSmall={LP_MED_SRC(landingImages['lp-grondar'])}
              alt="Warlord Grondar — a hulking orc war-chief in spiked iron pauldrons, lit by forge embers"
            />
            <div class="lp-boss">
              <span class="lp-boss__tag">World boss</span>
              <b class="lp-boss__name">Warlord Grondar</b>
              <span class="lp-boss__hp" role="presentation"><i /></span>
              <span class="lp-boss__sub">One of the bosses waiting for you</span>
            </div>
          </div>
        </div>

        <div class="lp-proof">
          {LANDING_STATS.map(([v, l]) => (
            <div class="lp-proof__item" key={l}><b>{v}</b><span>{l}</span></div>
          ))}
        </div>
        <a class="lp-scrollcue" href="#lp-features" aria-label="Scroll to features"><i /></a>
      </section>

      {/* ── Proclamation cards ── */}
      <section class="lp-section" id="lp-features">
        <div class="lp-cards">
          {LANDING_CARDS.map((c, i) => (
            <article class="lp-card lp-reveal" style={{ '--d': `${i * 90}ms` }} key={c.id}>
              <div class="lp-card__seal" aria-hidden="true"><GameIcon iconKey={c.seal} color="#e6c878" size={26} title="" /></div>
              <h3 class="lp-card__title">{c.title}</h3>
              <div class="fm-divider lp-card__rule" aria-hidden="true" />
              <div class="lp-card__art" aria-hidden="true">
                {c.art.map(k => <GameIcon iconKey={k} color="#7c2708" size={46} title="" key={k} />)}
              </div>
              <p class="lp-card__desc">{c.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── World map / places ── */}
      <section class="lp-section" id="lp-world">
        <div class="lp-head lp-reveal">
          <div class="lp-eyebrow lp-eyebrow--brass">The world</div>
          <h2 class="lp-title">Explore the realm of Eldermoor</h2>
          <p class="lp-lead">
            Travel the roads between towns and cities, or teleport ahead. Every place has its
            own painted scene, facilities, and things to fight, gather, or plunder.
          </p>
        </div>

        <figure class="lp-mapframe lp-reveal">
          <img
            src={landingImages['lp-map']} srcset={LP_MAP_SRCSET(landingImages['lp-map'])}
            sizes="(min-width: 880px) 760px, 94vw"
            alt="The realm of Eldermoor — a hand-painted world map"
            width="1108" height="594" loading="lazy" decoding="async"
          />
          {LANDING_MARKERS.map(m => (
            <div class={`lp-mark${m.up ? ' lp-mark--up' : ''}`} style={{ left: `${m.x}%`, top: `${m.y}%` }} key={m.id}>
              <img src={LP_MED_SRC(landingImages[m.img])} alt="" width="44" height="44" loading="lazy" decoding="async" />
              <span class="lp-mark__name">{m.name}</span>
            </div>
          ))}
        </figure>

        <div class="lp-legend lp-reveal">
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
            <article class="lp-place lp-reveal" role="listitem" key={p.id}>
              <div class="lp-place__art">
                <img
                  src={landingImages[p.img]} srcset={LP_SCENE_SRCSET(landingImages[p.img])}
                  sizes="(min-width: 880px) 340px, 240px" alt={`${p.name} — ${p.sub}`}
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

      {/* ── Skills band ── */}
      <section class="lp-section lp-section--band" id="lp-skills">
        <div class="lp-head lp-reveal">
          <div class="lp-eyebrow lp-eyebrow--brass">Skilling</div>
          <h2 class="lp-title">Train 25 skills to 99</h2>
          <p class="lp-lead">
            Every skill ticks live and idles offline. Combat, gathering, production, and
            utility — pick your path to the max cape.
          </p>
        </div>
        <div class="lp-skills">
          {LP_SKILLS.map(([skill, label], i) => (
            <div class="lp-skchip lp-reveal" style={{ '--d': `${(i % 8) * 45}ms` }} key={skill}>
              <GameIcon iconKey={getSkillArt(skill).icon} color="#e6c878" size={26} title={label} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Screenshot strip ── */}
      <section class="lp-section" id="lp-gallery">
        <div class="lp-head lp-reveal">
          <div class="lp-eyebrow lp-eyebrow--brass">Screens</div>
          <h2 class="lp-title">See it in action</h2>
        </div>
        <div class="lp-strip">
          {LP_GALLERY.map(key => (
            <div class="lp-strip__shot" key={key}>
              <img src={landingImages[key]} srcset={landingSrcSet(landingImages[key])} sizes="(min-width: 880px) 200px, 150px"
                   alt="PocketRPG screen" width={LP_SHOT_DIMS.w} height={LP_SHOT_DIMS.h}
                   loading="lazy" decoding="async" />
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section class="lp-section">
        <div class="lp-head lp-reveal">
          <div class="lp-eyebrow lp-eyebrow--brass">The loop</div>
          <h2 class="lp-title">How idle progress works</h2>
        </div>
        <ol class="lp-steps">
          {LP_STEPS.map(([t, d], i) => (
            <li class="lp-step lp-reveal" style={{ '--d': `${i * 110}ms` }} key={t}>
              <span class="lp-step__n">{i + 1}</span>
              <div>
                <h4 class="lp-step__t">{t}</h4>
                <p class="lp-step__d">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ── AI companion ── */}
      <section class="lp-section lp-section--band">
        <div class="lp-companion">
          <div class="lp-companion__copy lp-reveal">
            <div class="lp-eyebrow lp-eyebrow--brass">Your companion</div>
            <h2 class="lp-title">Chat with the AI companion</h2>
            <p class="lp-lead">
              Ask any question or get advice about the game — your companion knows the mechanics,
              the map, and your character.
            </p>
          </div>
          <div class="lp-companion__shot lp-reveal">
            <img src={landingImages['ss-chat']} srcset={landingSrcSet(landingImages['ss-chat'])} sizes="220px"
                 alt="Chatting with the in-game AI companion" width={LP_SHOT_DIMS.w} height={LP_SHOT_DIMS.h}
                 loading="lazy" decoding="async" />
          </div>
        </div>
      </section>

      {/* ── Auth CTA ── */}
      <section ref={authRef} class="lp-section lp-section--cta" id="lp-play">
        <div class="lp-authcard lp-reveal">
          <h2 class="lp-title lp-title--center">Start your adventure</h2>
          <p class="lp-authcard__sub">
            Free account. Progress saved to the cloud.<br />Play across all your devices.
          </p>

          <button
            onClick={hosted ? undefined : onGitHubLogin}
            disabled={hosted}
            style={hosted ? { pointerEvents: 'none' } : undefined}
            class="lp-oauth"
          >
            <LpGitHubMark />
            Continue with GitHub
          </button>

          <button
            onClick={hosted ? undefined : onGoogleLogin}
            disabled={hosted}
            style={hosted ? { pointerEvents: 'none' } : undefined}
            class="lp-oauth"
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
              <div class="lp-embed__title">
                <GameIcon iconKey="info" color="var(--fm-ember-deep)" size={14} title="" /> Google sign-in needs your real browser
              </div>
              <div class="lp-embed__body">
                You're in an in-app browser, which Google blocks. Tap ••• or Share →{' '}
                <strong>Open in Safari</strong> / <strong>Open in Chrome</strong>. GitHub works as-is.
              </div>
              {showBrowserHint && (
                <button type="button" onClick={onCopyLink} class="lp-embed__copy">
                  {copied
                    ? <><GameIcon iconKey="check_mark" color="#4ade80" size={14} title="" /> Link copied</>
                    : 'Copy link to open in browser'}
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

      {/* ── HUD band — the in-game status bar, as a footer flourish ── */}
      <div class="lp-hud">
        <div class="lp-hud__slog">Your Adventure.<br />Anytime, Anywhere.</div>
        <div class="lp-hud__stats">
          {LANDING_HUD_STATS.map(s => (
            <div class="lp-hudstat" key={s.label}>
              <b style={{ color: s.color }}>{s.value}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      <footer class="lp-footer">
        <span class="lp-footer__brand lp-gilt">PocketRPG</span>
        <span>Level up while you live your life.</span>
        <span class="lp-footer__url">pocketrpg.co.uk</span>
        <a href="/guide/">Game Guide</a>
      </footer>
    </div>
  )
}
