import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import GameIcon from './GameIcon.jsx'
import { useEscapeKey } from '../hooks/useEscapeKey.js'
import { formatCompactCoins } from '../utils/formatters.js'

// ─── Rarity system ───────────────────────────────────────────────────────────

const RARITY = {
  common:    { label: 'Common',    c: '#c2ad6e' },
  uncommon:  { label: 'Uncommon',  c: '#5fcf6a' },
  rare:      { label: 'Rare',      c: '#49a6f0' },
  legendary: { label: 'Legendary', c: '#b06bf5' },
}

export function rarityOf(gp, explicitRarity) {
  if (explicitRarity) return explicitRarity
  if (gp >= 1_000_000) return 'legendary'
  if (gp >= 100_000) return 'rare'
  if (gp >= 10_000) return 'uncommon'
  return 'common'
}

const LM_GOLD = '#f0c040'
const LM_GOLD_DEEP = '#9c7212'
const LM_PURPLE = '#b06bf5'
const LM_PURPLE_DEEP = '#6a3aa8'
const LM_BLOOD = '#e0564b'
const LM_BLOOD_DEEP = '#7a1c1c'

// ─── Decorative sub-components ───────────────────────────────────────────────

function Rays() {
  const rays = useMemo(() =>
    Array.from({ length: 11 }, (_, i) => ({ a: (i - 5) * 15, d: (i % 4) * 0.4 })),
  [])
  return (
    <div class="lm-rays" aria-hidden="true">
      {rays.map((r, i) => (
        <span
          key={i}
          class="lm-ray"
          style={{ transform: `translateX(-50%) rotate(${r.a}deg)`, animationDelay: `${r.d}s` }}
        />
      ))}
    </div>
  )
}

function Embers({ color }) {
  const ems = useMemo(() =>
    Array.from({ length: 12 }, () => ({
      l: Math.random() * 100,
      s: 2 + Math.random() * 3.5,
      dur: 6 + Math.random() * 7,
      delay: -Math.random() * 10,
      c: Math.random() > 0.5 ? color : '#f5e6c8',
    })),
  [color])
  return (
    <div class="lm-embers" aria-hidden="true">
      {ems.map((e, i) => (
        <span
          key={i}
          class="lm-ember"
          style={{
            left: `${e.l}%`,
            width: e.s,
            height: e.s,
            background: e.c,
            boxShadow: `0 0 6px ${e.c}`,
            animationDuration: `${e.dur}s`,
            animationDelay: `${e.delay}s`,
          }}
        />
      ))}
    </div>
  )
}

// ─── Skip button ─────────────────────────────────────────────────────────────

function SkipButton({ label, onClick }) {
  if (!label) return null
  return (
    <button class="lm-skip" onClick={onClick}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
        <path d="M4 5l8 6.5L4 18V5zm9 0l8 6.5L13 18V5z" />
      </svg>
      {label}
    </button>
  )
}

// ─── Count-up hook ───────────────────────────────────────────────────────────

function useCountUp(target, dur, active) {
  const [v, setV] = useState(active ? 0 : target)
  useEffect(() => {
    if (!active) { setV(target); return }
    let raf
    const t0 = performance.now()
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur)
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, active, dur])
  return v
}

// ─── LootResultRow ───────────────────────────────────────────────────────────

export function LootResultRow({ item, name, quantity, gp, unitGp, lost = false, highlight = false, rarity: explicitRarity }) {
  const rarity = lost ? 'common' : rarityOf(unitGp ?? gp ?? 0, explicitRarity || (highlight ? 'legendary' : undefined))
  const r = RARITY[rarity]

  const gpClass = lost ? 'lm-row__gp lm-row__gp--loss' : 'lm-row__gp'
  const sign = lost ? '−' : '+'

  return (
    <div
      class={`lm-row${lost ? ' lm-row--lost' : ''}`}
      style={{ '--rrc': r.c, '--d': '0s' }}
    >
      <div class="lm-row__art">
        <GameIcon item={item} size={22} />
      </div>
      <div class="lm-row__txt">
        <div class="lm-row__name">{name}</div>
        <div class="lm-row__tag">
          {r.label}
          {quantity != null && quantity > 1 && (
            <span class="lm-row__qty">{'×'}{quantity.toLocaleString()}</span>
          )}
        </div>
      </div>
      {gp != null && gp > 0 && (
        <div class={gpClass}>{sign}{formatCompactCoins(gp)}</div>
      )}
    </div>
  )
}

// ─── MatchupHpStrip (PvP) ────────────────────────────────────────────────────

export function MatchupHpStrip({ self, opp, selfRisk, oppRisk, selfRank, oppRank }) {
  const selfHp = Math.max(0, Number(self?.hp ?? self?.currentHP ?? 0) || 0)
  const selfMax = Math.max(1, Number(self?.maxHP ?? 1) || 1)
  const selfPct = Math.max(0, Math.min(100, (selfHp / selfMax) * 100))

  const oppHp = Math.max(0, Number(opp?.hp ?? opp?.currentHP ?? 0) || 0)
  const oppMax = Math.max(1, Number(opp?.maxHP ?? 1) || 1)
  const oppPct = Math.max(0, Math.min(100, (oppHp / oppMax) * 100))

  return (
    <div class="loot-matchup">
      <div class="loot-matchup__side loot-matchup__side--opp">
        <div class="loot-matchup__label">Opponent</div>
        <div class="loot-matchup__name">{opp?.username || 'Opponent'}</div>
        <div class={`loot-matchup__hp${oppHp <= 0 ? ' dead' : ''}`}>{oppHp}/{oppMax} HP</div>
        <div class="loot-hp loot-hp--enemy">
          <div class="loot-hp__fill" style={{ width: `${oppPct}%` }} />
        </div>
        {oppRisk > 0 && <div class="loot-matchup__risk">{formatCompactCoins(oppRisk)} at risk</div>}
        {oppRank && <div class="loot-matchup__risk">{oppRank}</div>}
      </div>
      <div class="loot-matchup__vs">VS</div>
      <div class="loot-matchup__side loot-matchup__side--self" style={{ textAlign: 'right' }}>
        <div class="loot-matchup__label">You</div>
        <div class="loot-matchup__name" style={{ marginLeft: 'auto' }}>{self?.username || 'You'}</div>
        <div class={`loot-matchup__hp${selfHp <= 0 ? ' dead' : ''}`}>{selfHp}/{selfMax} HP</div>
        <div class="loot-hp loot-hp--self">
          <div class="loot-hp__fill" style={{ width: `${selfPct}%` }} />
        </div>
        {selfRisk > 0 && <div class="loot-matchup__risk">{formatCompactCoins(selfRisk)} at risk</div>}
        {selfRank && <div class="loot-matchup__risk">{selfRank}</div>}
      </div>
    </div>
  )
}

// ─── Summary card (skilling/idle XP breakdown) ───────────────────────────────

export function SummaryCard({ heading, icon: emoji, rows }) {
  if (!rows || rows.length === 0) return null
  return (
    <div class="lm-card">
      <div class="lm-card__head">
        {emoji && <span class="lm-card__icn">{emoji}</span>}
        {heading || 'Summary'}
      </div>
      {rows.map((s, i) => (
        <div key={i} class={`lm-stat${s.big ? ' lm-stat--big' : ''}`}>
          <div class="lm-stat__l">
            {s.emoji && <span class="lm-stat__e">{s.emoji}</span>}
            {s.name}
          </div>
          <div class="lm-stat__r">
            <div class="lm-stat__v">
              {s.value}
              {s.xp && <span class="lm-stat__u"> xp</span>}
            </div>
            {s.rate && <div class="lm-stat__hr">{s.rate}/hr</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Supplies card (idle combat food/potions) ────────────────────────────────

export function SuppliesCard({ heading, icon: emoji, rows }) {
  if (!rows || rows.length === 0) return null
  return (
    <div class="lm-card">
      <div class="lm-card__head">
        {emoji && <span class="lm-card__icn">{emoji}</span>}
        {heading || 'Idle Supplies'}
      </div>
      {rows.map((s, i) => (
        <div key={i} class="lm-supply">
          <div class="lm-supply__l">
            {s.emoji && <span class="lm-stat__e">{s.emoji}</span>}
            {s.name}
            {s.detail && <span class="lm-supply__d">{s.detail}</span>}
          </div>
          <div class={`lm-supply__v${s.low ? ' low' : ''}`}>{s.val}</div>
        </div>
      ))}
    </div>
  )
}

// ─── LootResultModal ─────────────────────────────────────────────────────────

/**
 * Shared loot/end-of-activity modal — full-screen dark void design.
 *
 * Two layout modes:
 *   kind="loot"     — monster/boss/raid kill: hero spotlight item, loot rows
 *   kind="progress" — skilling/idle: featured icon, summary cards, optional loot
 *
 * Props:
 *   theme           — "gold" | "blood" | "purple"
 *   kind            — "loot" | "progress" (default "loot")
 *   icon            — emoji string shown in seal ("progress" mode fallback when no heroItem)
 *   heroItem        — item object for hero spotlight ("loot" mode, and "progress" mode when set)
 *   heroName        — display name of hero item
 *   heroGp          — hero item GP value (total, for display)
 *   heroUnitGp      — hero item unit shop value (for rarity; falls back to heroGp)
 *   heroRate        — drop rate string e.g. "1 / 512"
 *   eyebrow         — small uppercase text above title (e.g. "BOSS DEFEATED")
 *   title           — large display title
 *   sub             — small monospace subtitle
 *   skipLabel       — label for skip button (null to hide)
 *   onSkip          — skip button handler
 *   loot            — array of { item, name, quantity, gp, unitGp, lost, highlight, rarity }
 *   lootTitle       — section header for loot (e.g. "Loot Secured", "Gathered")
 *   lootTotal       — total GP value for count-up display
 *   lootSigned      — "+" | "-"
 *   summaryRows     — array for SummaryCard (skilling/idle)
 *   summaryHeading  — heading for summary card
 *   summaryIcon     — emoji for summary card
 *   suppliesRows    — array for SuppliesCard (idle)
 *   suppliesHeading — heading for supplies card
 *   suppliesIcon    — emoji for supplies card
 *   primaryAction   — { label, onClick }
 *   secondaryAction — { label, onClick }
 *   onClose         — close handler
 *   children        — injected content (warnings, custom cards, PvP matchup)
 *
 * Legacy compat props (from old API, mapped internally):
 *   status          — mapped to sub
 *   subtitle        — mapped to eyebrow context
 *   titleRight      — mapped to skipLabel/onSkip if it's a skip button element
 */
export default function LootResultModal({
  theme = 'gold',
  kind = 'loot',
  icon,
  heroItem,
  heroName,
  heroGp,
  heroUnitGp,
  heroRate,
  eyebrow,
  title = 'Loot!',
  sub,
  status,
  subtitle,
  skipLabel,
  onSkip,
  loot,
  lootTitle,
  lootTotal,
  lootSigned = '+',
  summaryRows,
  summaryHeading,
  summaryIcon,
  suppliesRows,
  suppliesHeading,
  suppliesIcon,
  primaryAction,
  secondaryAction,
  onClose,
  titleRight,
  children,
}) {
  // Legacy compat: map old props
  const effectiveSub = sub || status
  const effectiveEyebrow = eyebrow || subtitle

  // Resolve accent color
  const isBlood = theme === 'blood'
  const isPurple = theme === 'purple'
  const rc = isBlood ? LM_BLOOD : isPurple ? LM_PURPLE : LM_GOLD
  const rcDeep = isBlood ? LM_BLOOD_DEEP : isPurple ? LM_PURPLE_DEEP : LM_GOLD_DEEP

  // Hero item rarity
  const heroRarity = heroItem ? rarityOf(heroUnitGp ?? heroGp ?? 0) : null
  const heroR = heroRarity ? RARITY[heroRarity] : null

  // Check if any loot item is legendary (for theme override)
  const hasLoot = Array.isArray(loot) && loot.length > 0

  // Count-up animation for GP total
  const total = lootTotal ?? (hasLoot ? loot.reduce((s, i) => s + (i.gp || 0), 0) : 0)
  const [counting, setCounting] = useState(false)
  useEffect(() => {
    setCounting(false)
    const t = setTimeout(() => setCounting(true), 360)
    return () => clearTimeout(t)
  }, [title, total])
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  const shown = useCountUp(total, 1300, counting && !reducedMotion)

  // Scroll-lock while open
  useEffect(() => {
    if (typeof document === 'undefined' || !document.body) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEscapeKey(() => onClose?.(), !!onClose)

  const isLootKind = kind === 'loot' && heroItem
  const isProgressKind = kind === 'progress' || !heroItem

  const modal = (
    <div
      class="lm-overlay"
      role="dialog"
      aria-modal="true"
      onClick={() => onClose?.()}
    >
      <div
        class={`lm${reducedMotion ? ' restrained' : ''}`}
        style={{ '--rc': rc, '--rc-deep': rcDeep }}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="lm__bleed" />
        {!reducedMotion && !isBlood && <Rays />}
        {!reducedMotion && <Embers color={rc} />}
        {!reducedMotion && <div class="lm__sheen" />}

        {/* Top controls */}
        <div class="lm-top">
          {(skipLabel || titleRight) ? (
            titleRight || <SkipButton label={skipLabel} onClick={onSkip} />
          ) : <span />}
          {onClose && (
            <button class="lm-x" aria-label="Close" onClick={onClose}>
              {'✕'}
            </button>
          )}
        </div>

        {/* Scrollable content */}
        <div class="lm__scroll">
          {isLootKind ? (
            <>
              {/* Loot mode: eyebrow + title above hero */}
              <div class="lm-kicker">
                {effectiveEyebrow && <div class="lm-eyebrow">{effectiveEyebrow}</div>}
                <h1 class="lm-h1">{title}</h1>
                {effectiveSub && <div class="lm-csub">{effectiveSub}</div>}
              </div>

              {/* Hero spotlight */}
              <div class="lm-spot lm-spot--hero">
                <div class="lm-stage">
                  <div class="lm-ring" />
                  <div class="lm-ring2" />
                  <div class="lm-disc" />
                  <div class="lm-icn">
                    <GameIcon item={heroItem} size={64} />
                  </div>
                </div>
              </div>

              {/* Hero label */}
              <div class="lm-hero">
                {heroR && <div class="lm-ribbon">{heroR.label} Drop</div>}
                {heroName && <div class="lm-hname">{heroName}</div>}
                <div class="lm-hmeta">
                  {heroGp > 0 && <span class="lm-hgp">+{formatCompactCoins(heroGp)} gp</span>}
                  {heroGp > 0 && heroRate && <span class="lm-hdot" />}
                  {heroRate && <span class="lm-hrate">{heroRate}</span>}
                </div>
              </div>

              {/* Injected children */}
              {children}

              {/* Loot section */}
              {hasLoot && (
                <>
                  <div class="lm-sec">
                    <span class="lm-sec__l">{lootTitle || 'Loot Secured'}</span>
                    {total > 0 && (
                      <span class="lm-sec__r">
                        <span class="lm-sec__total">{lootSigned}{formatCompactCoins(shown)}</span>
                        <span class="lm-sec__unit">gp</span>
                      </span>
                    )}
                  </div>
                  <div class="lm-list">
                    {loot.map((row, idx) => (
                      <LootResultRow
                        key={row.key ?? row.itemId ?? idx}
                        item={row.item}
                        name={row.name}
                        quantity={row.quantity}
                        gp={row.gp}
                        unitGp={row.unitGp}
                        lost={row.lost}
                        highlight={row.highlight}
                        rarity={row.rarity}
                      />
                    ))}
                  </div>
                </>
              )}
              {!hasLoot && !children && (
                <div class="lm-empty">{heroItem ? 'No other loot dropped' : 'No loot dropped'}</div>
              )}
            </>
          ) : (
            <>
              {/* Progress mode: featured icon above kicker. When a heroItem is
                  supplied (e.g. an idle session's most valuable drop) it takes
                  the spotlight in place of the emoji — mirroring the loot-mode
                  hero so a skip/idle result trophies the best item, not a 💤. */}
              <div class="lm-spot lm-spot--feat">
                <div class="lm-stage">
                  <div class="lm-ring" />
                  <div class="lm-ring2" />
                  <div class="lm-disc" />
                  <div class="lm-icn">
                    {heroItem
                      ? <GameIcon item={heroItem} size={56} />
                      : <span style={{ fontSize: '42px', lineHeight: 1 }}>{icon || '🏆'}</span>}
                  </div>
                </div>
              </div>

              <div class="lm-kicker">
                {effectiveEyebrow && <div class="lm-eyebrow">{effectiveEyebrow}</div>}
                <h1 class="lm-h1">{title}</h1>
                {effectiveSub && <div class="lm-csub">{effectiveSub}</div>}
              </div>

              {/* Summary & supplies cards */}
              {(summaryRows || suppliesRows) && (
                <div class="lm-cards">
                  {summaryRows && <SummaryCard heading={summaryHeading} icon={summaryIcon} rows={summaryRows} />}
                  {suppliesRows && <SuppliesCard heading={suppliesHeading} icon={suppliesIcon} rows={suppliesRows} />}
                </div>
              )}

              {/* Injected children */}
              {children}

              {/* Optional loot rows (skilling gathered items, idle loot) */}
              {hasLoot && (
                <>
                  <div class="lm-sec">
                    <span class="lm-sec__l">{lootTitle || 'Gathered'}</span>
                    {total > 0 && (
                      <span class="lm-sec__r">
                        <span class="lm-sec__total">{lootSigned}{formatCompactCoins(shown)}</span>
                        <span class="lm-sec__unit">gp</span>
                      </span>
                    )}
                  </div>
                  <div class="lm-list">
                    {loot.map((row, idx) => (
                      <LootResultRow
                        key={row.key ?? row.itemId ?? idx}
                        item={row.item}
                        name={row.name}
                        quantity={row.quantity}
                        gp={row.gp}
                        unitGp={row.unitGp}
                        lost={row.lost}
                        highlight={row.highlight}
                        rarity={row.rarity}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer action buttons */}
        {(primaryAction || secondaryAction) && (
          <div class="lm-foot">
            {secondaryAction && (
              <button class="lm-btn lm-btn--ghost" onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </button>
            )}
            {primaryAction && (
              <button
                class={`lm-btn lm-btn--primary${isPurple ? ' lm-btn--purple' : ''}`}
                onClick={primaryAction.onClick}
              >
                {primaryAction.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )

  if (typeof document === 'undefined' || !document.body) return modal
  return createPortal(modal, document.body)
}
