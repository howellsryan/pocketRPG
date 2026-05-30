import { useEffect } from 'preact/hooks'
import { landingImages } from './landingImages.js'
import { homeLogo } from '../utils/homeLogo.js'
import { getSkillArt } from '../utils/skillArt.js'
import GameIcon from '../components/GameIcon.jsx'

// Wide marketing landing for desktop (≥768px). Mirrors the Claude "Desktop
// Landing" design, built on the real product copy, landing screenshots,
// vendored game-icons, and the live GitHub/Google auth handlers.
//
// All top-level identifiers are DL_-prefixed and all CSS classes dl-* so the
// single-file build (which concatenates every module at top level) stays free
// of duplicate-identifier collisions with the mobile LandingScreen.

const DL_LANDING_DIMS = {
  'ss-stats':         { w: 560, h: 979  },
  'ss-combat-select': { w: 560, h: 996  },
  'ss-thieving':      { w: 560, h: 991  },
  'ss-bank':          { w: 560, h: 987  },
  'ss-quests':        { w: 560, h: 990  },
  'ss-inventory':     { w: 560, h: 985  },
  'ss-combat':        { w: 560, h: 994  },
  'ss-farming':       { w: 560, h: 995  },
  'ss-collection':    { w: 560, h: 998  },
  'ss-trading':       { w: 560, h: 998  },
}

const DL_FEATURES = [
  {
    icon: 'crossed_swords', title: 'Bosses & Raids',
    desc: "God Wars Dungeon, Dragon's Lair, the Wilderness, and end-game Raids. Lock in your setup, then fight on autopilot while the ticks roll.",
    img: 'ss-combat-select', tags: ['Auto-combat', 'God Wars', 'Raids'],
  },
  {
    icon: 'progression', title: '24 Skills to Master',
    desc: 'Train Attack, Thieving, Mining, Fishing, Runecraft and more from level 1 to 99. XP ticks every 600ms — even when the screen is off.',
    img: 'ss-thieving', tags: ['1 → 99', 'Idle XP', 'Offline-first'],
  },
  {
    icon: 'cash', title: 'A Deep Economy',
    desc: 'A bank with hundreds of slots, a live player-driven Trading Post, and 221 Collection Log entries to hunt down across every corner of the game.',
    img: 'ss-bank', tags: ['Trading Post', '221 collectibles', 'Hundreds of items'],
  },
  {
    icon: 'scroll', title: '168 Quests',
    desc: 'Quest chains from Novice to Elite, each one rewarding XP, rare items, and lore. Chase the max Quest Point cape and complete the journal.',
    img: 'ss-quests', tags: ['Novice → Elite', 'QP cape', 'Lore'],
  },
]

const DL_SKILLS = [
  ['attack', 'Attack'], ['strength', 'Strength'], ['defence', 'Defence'], ['hitpoints', 'Hitpoints'],
  ['ranged', 'Ranged'], ['magic', 'Magic'], ['prayer', 'Prayer'], ['mining', 'Mining'],
  ['woodcutting', 'Woodcut'], ['fishing', 'Fishing'], ['farming', 'Farming'], ['smithing', 'Smithing'],
  ['cooking', 'Cooking'], ['crafting', 'Crafting'], ['herblore', 'Herblore'], ['runecraft', 'Runecraft'],
  ['firemaking', 'Firemaking'], ['agility', 'Agility'], ['thieving', 'Thieving'], ['hunter', 'Hunter'],
  ['slayer', 'Slayer'], ['construction', 'Construct.'], ['fletching', 'Fletching'], ['dungeoneering', 'Dungeon.'],
]

const DL_GALLERY = ['ss-inventory', 'ss-combat', 'ss-farming', 'ss-collection', 'ss-trading', 'ss-stats']

const DL_STATS = [
  ['600ms', 'Game tick'],
  ['24', 'Skills to 99'],
  ['168', 'Quests'],
  ['221', 'Collectibles'],
  ['∞', 'Offline progress'],
]

const DL_STEPS = [
  ['Pick an activity', 'Choose a skill to train, a boss to fight, or a quest to chase. Set your loadout once.'],
  ['Progress on a tick', 'The world advances on a deterministic 600ms tick — XP, drops, and rewards accrue whether the app is open or closed.'],
  ['Come back richer', 'Idle time is simulated when you return. Cloud saves keep your roster in sync across every device.'],
]

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

export default function DesktopLandingScreen({ onGitHubLogin, onGoogleLogin, embedded, showBrowserHint, copied, onCopyLink }) {
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
            <span class="dl-word dl-gold">PocketRPG</span>
          </a>
          <nav class="dl-nav__links">
            <a href="#dl-features">Features</a>
            <a href="#dl-skills">Skills</a>
            <a href="#dl-gallery">Screenshots</a>
            <a href="#dl-how">How it works</a>
          </nav>
          <div class="dl-nav__right">
            <a class="dl-signin" href="#dl-play">Sign in</a>
            <a class="dl-btn dl-btn--gold" href="#dl-play">Play Now — Free</a>
          </div>
        </div>
      </header>

      <div class="dl-main">
        {/* HERO */}
        <section class="dl-hero">
          <div class="dl-wrap dl-hero__grid">
            <div>
              <span class="dl-eyebrow">Tick-based idle fantasy RPG</span>
              <h1 class="dl-hero__h1"><span class="dl-gold">Level up</span><br />while you live<br />your life.</h1>
              <p class="dl-hero__sub">Combat, skills, quests, and raids that keep progressing — whether you're watching or not.</p>
              <div class="dl-hero__cta">
                <a class="dl-btn dl-btn--gold dl-btn--lg" href="#dl-play">Play Now — Free</a>
                <a class="dl-btn dl-btn--ghost dl-btn--lg" href="#dl-features">Explore the game</a>
              </div>
              <div class="dl-hero__proof">
                <div class="dl-proof"><b>600ms</b><span>World tick</span></div>
                <div class="dl-proof-div" />
                <div class="dl-proof"><b>24</b><span>Skills</span></div>
                <div class="dl-proof-div" />
                <div class="dl-proof"><b>Free</b><span>To play</span></div>
              </div>
            </div>
            <div class="dl-cluster">
              <div class="dl-device dl-device--back"><img src={landingImages['ss-combat']} alt="Boss fight in progress" width="560" height="994" loading="eager" decoding="async" /></div>
              <div class="dl-device dl-device--back2"><img src={landingImages['ss-inventory']} alt="Full inventory grid" width="560" height="985" loading="eager" decoding="async" /></div>
              <div class="dl-device dl-device--main"><img src={landingImages['ss-stats']} alt="Skills overview" width="560" height="979" loading="eager" fetchpriority="high" decoding="async" /></div>
            </div>
          </div>
        </section>

        {/* STAT STRIP */}
        <div class="dl-strip">
          <div class="dl-wrap dl-strip__inner">
            {DL_STATS.map(s => (
              <div class="dl-stat" key={s[1]}><b>{s[0]}</b><span>{s[1]}</span></div>
            ))}
          </div>
        </div>

        {/* FEATURES */}
        <section class="dl-block" id="dl-features">
          <div class="dl-wrap">
            <div class="dl-head dl-reveal">
              <span class="dl-eyebrow">The game</span>
              <h2 class="dl-title dl-gold">Everything in your pocket</h2>
              <p>A full fantasy MMO-style progression loop, distilled into menus that respect your time.</p>
            </div>
            <div class="dl-features">
              {DL_FEATURES.map(f => (
                <div class="dl-feature dl-reveal" key={f.title}>
                  <div class="dl-feature__media">
                    <div class="dl-frame"><img src={landingImages[f.img]} alt={f.title}
                      width={DL_LANDING_DIMS[f.img]?.w} height={DL_LANDING_DIMS[f.img]?.h}
                      loading="lazy" decoding="async" /></div>
                  </div>
                  <div class="dl-feature__copy">
                    <div class="dl-feature__ico"><GameIcon iconKey={f.icon} color="#f0c040" size={32} title="" /></div>
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
        <section class="dl-block dl-band" id="dl-skills">
          <div class="dl-wrap">
            <div class="dl-head dl-reveal">
              <span class="dl-eyebrow">Skilling</span>
              <h2 class="dl-title dl-gold">Train 24 skills to 99</h2>
              <p>Every skill ticks live and idles offline. Combat, gathering, production, and utility — pick your path to the max cape.</p>
            </div>
            <div class="dl-skills__grid">
              {DL_SKILLS.map(([skill, label]) => (
                <div class="dl-skchip dl-reveal" key={skill}>
                  <GameIcon iconKey={getSkillArt(skill).icon} color="#e8c25a" size={30} title={label} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* GALLERY */}
        <section class="dl-block" id="dl-gallery">
          <div class="dl-wrap">
            <div class="dl-head dl-reveal">
              <span class="dl-eyebrow">Screens</span>
              <h2 class="dl-title dl-gold">See it in action</h2>
              <p>From the bank to the boss arena — here's what your adventure actually looks like.</p>
            </div>
          </div>
          <div class="dl-gallery-wrap">
            <div class="dl-gallery">
              {DL_GALLERY.map(g => (
                <div class="dl-shot" key={g}><img src={landingImages[g]} alt={g}
                  width={DL_LANDING_DIMS[g]?.w} height={DL_LANDING_DIMS[g]?.h}
                  loading="lazy" decoding="async" /></div>
              ))}
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section class="dl-block dl-band" id="dl-how">
          <div class="dl-wrap">
            <div class="dl-head dl-reveal">
              <span class="dl-eyebrow">The loop</span>
              <h2 class="dl-title dl-gold">How idle progress works</h2>
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
              <h2 class="dl-gold">Start your adventure</h2>
              <p>Free account. Progress saved to the cloud.<br />Play across all your devices.</p>
              <div class="dl-auth">
                <button class="dl-btn dl-btn--github dl-btn--lg" onClick={onGitHubLogin}>
                  <DlGitHubMark />Continue with GitHub
                </button>
                <button class="dl-btn dl-btn--google dl-btn--lg" onClick={onGoogleLogin}>
                  <span class="dl-gg">G</span>Continue with Google
                </button>
              </div>
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
              <a class="dl-brand" href="#dl-top"><DlEmblem size={36} /><span class="dl-word dl-gold">PocketRPG</span></a>
              <p>A menu-driven, tick-based fantasy idle RPG. Built mobile-first, offline-first, and free to play.</p>
            </div>
            <div class="dl-foot__cols">
              <div class="dl-foot__col">
                <h5>Game</h5>
                <a href="#dl-features">Features</a>
                <a href="#dl-skills">Skills</a>
                <a href="#dl-gallery">Screenshots</a>
                <a href="#dl-how">How it works</a>
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
