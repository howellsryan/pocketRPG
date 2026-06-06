import { useEffect, useMemo, useRef } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import GameIcon from './GameIcon.jsx'
import { useEscapeKey } from '../hooks/useEscapeKey.js'
import { formatCompactCoins } from '../utils/formatters.js'

// ─── Particle helpers ────────────────────────────────────────────────────────

function buildParticles(theme) {
  const isGold = theme === 'gold'
  const count = isGold ? 46 : 20
  const colors = isGold
    ? ['#fcecb0', '#f0c040', '#fdf3cf', '#d4a017']
    : ['#e0564b', '#c03020', '#f0a090', '#a82018']

  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * 360 + Math.random() * (360 / count)
    const dist = 90 + Math.random() * 150
    const rad = (angle * Math.PI) / 180
    const tx = Math.round(Math.cos(rad) * dist)
    const ty = Math.round(Math.sin(rad) * dist)
    const delay = (Math.random() * 0.4).toFixed(2)
    const dur = (0.7 + Math.random() * 0.5).toFixed(2)
    const color = colors[Math.floor(Math.random() * colors.length)]
    const isSquare = i % 3 === 0
    const size = 3 + Math.floor(Math.random() * 4)
    return { tx, ty, delay, dur, color, isSquare, size, key: i }
  })
}

// ─── LootResultRow ────────────────────────────────────────────────────────────

/**
 * One row in the loot list.
 * Props:
 *   item       — item object from itemsData (for GameIcon)
 *   name       — display name string
 *   quantity   — number
 *   gp         — coin value (optional)
 *   lost       — boolean; use blood-red styling + minus sign
 *   highlight  — boolean; purple "high value drop" styling
 */
export function LootResultRow({ item, name, quantity, gp, lost = false, highlight = false }) {
  const rowClass = highlight
    ? 'loot-row loot-row--highlight'
    : lost
      ? 'loot-row loot-row--lost'
      : 'loot-row'

  const gpClass = lost ? 'loot-row__gp loot-row__gp--loss' : 'loot-row__gp loot-row__gp--gain'
  const sign = lost ? '−' : '+'

  return (
    <div class={rowClass}>
      <span class="loot-row__icon">
        <GameIcon item={item} size={28} />
      </span>
      <span class="loot-row__name">{name}</span>
      {quantity != null && quantity > 1 && (
        <span class="loot-row__qty">×{quantity}</span>
      )}
      {gp != null && gp > 0 && (
        <span class={gpClass}>{sign}{formatCompactCoins(gp)} gp</span>
      )}
    </div>
  )
}

// ─── MatchupHpStrip ───────────────────────────────────────────────────────────

/**
 * Two-fighter HP strip for PvP end modal.
 * Props:
 *   self       — { username, hp, maxHP }
 *   opp        — { username, hp, maxHP }
 *   selfRisk   — number (coins at risk for player)
 *   oppRisk    — number (coins at risk for opponent)
 *   selfRank   — string (rank label e.g. "#42")
 *   oppRank    — string
 */
export function MatchupHpStrip({ self, opp, selfRisk, oppRisk, selfRank, oppRank }) {
  const selfHp = Math.max(0, Number(self?.hp ?? self?.currentHP ?? 0) || 0)
  const selfMax = Math.max(1, Number(self?.maxHP ?? 1) || 1)
  const selfPct = Math.max(0, Math.min(100, (selfHp / selfMax) * 100))

  const oppHp = Math.max(0, Number(opp?.hp ?? opp?.currentHP ?? 0) || 0)
  const oppMax = Math.max(1, Number(opp?.maxHP ?? 1) || 1)
  const oppPct = Math.max(0, Math.min(100, (oppHp / oppMax) * 100))

  return (
    <div class="loot-matchup">
      {/* Opponent side */}
      <div class="loot-matchup__side loot-matchup__side--opp">
        <div class="loot-matchup__label">Opponent</div>
        <div class="loot-matchup__name">{opp?.username || 'Opponent'}</div>
        <div class={`loot-matchup__hp${oppHp <= 0 ? ' dead' : ''}`}>{oppHp}/{oppMax} HP</div>
        <div class="loot-hp loot-hp--enemy">
          <div class="loot-hp__fill" style={{ width: `${oppPct}%` }} />
        </div>
        {oppRisk > 0 && (
          <div class="loot-matchup__risk">{formatCompactCoins(oppRisk)} at risk</div>
        )}
        {oppRank && (
          <div class="loot-matchup__risk">{oppRank}</div>
        )}
      </div>

      <div class="loot-matchup__vs">VS</div>

      {/* Self side */}
      <div class="loot-matchup__side loot-matchup__side--self" style={{ textAlign: 'right' }}>
        <div class="loot-matchup__label">You</div>
        <div class="loot-matchup__name" style={{ marginLeft: 'auto' }}>{self?.username || 'You'}</div>
        <div class={`loot-matchup__hp${selfHp <= 0 ? ' dead' : ''}`}>{selfHp}/{selfMax} HP</div>
        <div class="loot-hp loot-hp--self">
          <div class="loot-hp__fill" style={{ width: `${selfPct}%` }} />
        </div>
        {selfRisk > 0 && (
          <div class="loot-matchup__risk">{formatCompactCoins(selfRisk)} at risk</div>
        )}
        {selfRank && (
          <div class="loot-matchup__risk">{selfRank}</div>
        )}
      </div>
    </div>
  )
}

// ─── LootResultModal ─────────────────────────────────────────────────────────

/**
 * Shared loot/end-of-activity modal shell.
 *
 * Props:
 *   theme          — "gold" | "blood"
 *   icon           — emoji string (e.g. "🏆" / "💀") shown in seal
 *   title          — big gradient title string
 *   status         — optional small monospace status line
 *   subtitle       — optional subtitle string
 *   loot           — array of { item, name, quantity, gp, lost, highlight } | null
 *   lootTitle      — header label for loot section
 *   lootTotal      — number (coin value for total line)
 *   lootSigned     — "+" | "-"
 *   primaryAction  — { label, onClick }
 *   secondaryAction — optional { label, onClick }
 *   onClose        — called when overlay or close button is clicked
 *   titleRight     — optional node rendered in hero area (e.g. skip button)
 *   children       — injected ABOVE loot list (PvP matchup strip, idle sections)
 */
export default function LootResultModal({
  theme = 'gold',
  icon = '🏆',
  title = 'Loot!',
  status,
  subtitle,
  loot,
  lootTitle,
  lootTotal,
  lootSigned = '+',
  primaryAction,
  secondaryAction,
  onClose,
  titleRight,
  children,
}) {
  const particles = useMemo(() => buildParticles(theme), [theme])

  // Scroll-lock while open
  useEffect(() => {
    if (typeof document === 'undefined' || !document.body) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEscapeKey(() => onClose?.(), !!onClose)

  const hasLoot = Array.isArray(loot) && loot.length > 0
  const totalClass = lootSigned === '-'
    ? 'loot-modal__loot-total loot-modal__loot-total--loss'
    : 'loot-modal__loot-total loot-modal__loot-total--gain'

  const modal = (
    <div
      class="loot-modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={() => onClose?.()}
    >
      <div
        class="loot-modal"
        data-theme={theme}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Skip button (top-left) */}
        {titleRight && (
          <div style={{ position: 'absolute', top: '12px', left: '12px', zIndex: 10 }}>
            {titleRight}
          </div>
        )}

        {/* Close button */}
        {onClose && (
          <button
            class="loot-modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        )}

        {/* Spinning rays — gold only */}
        {theme === 'gold' && <div class="loot-modal__rays" aria-hidden="true" />}

        {/* Particle burst */}
        <div class="loot-modal__particles" aria-hidden="true">
          {particles.map((p) => (
            <div
              key={p.key}
              class="loot-particle"
              style={{
                width: `${p.size}px`,
                height: `${p.size}px`,
                borderRadius: p.isSquare ? '2px' : '50%',
                background: p.color,
                '--tx': `${p.tx}px`,
                '--ty': `${p.ty}px`,
                '--d': `${p.dur}s`,
                animationDelay: `${p.delay}s`,
              }}
            />
          ))}
        </div>

        {/* Scrollable content */}
        <div class="loot-modal__scroll">
          {/* Hero section */}
          <div class="loot-modal__hero">
            <div class="loot-modal__seal" aria-hidden="true">
              <span style={{ fontSize: '32px', lineHeight: 1 }}>{icon}</span>
            </div>

            {status && (
              <div class="loot-modal__status">{status}</div>
            )}

            <div class="loot-modal__title">{title}</div>

            {subtitle && (
              <div class="loot-modal__subtitle">{subtitle}</div>
            )}
          </div>

          {/* Injected children (PvP matchup strip, idle sections, warnings) */}
          {children}

          {/* Loot list */}
          {hasLoot && (
            <div class="loot-modal__loot">
              {(lootTitle || lootTotal != null) && (
                <div class="loot-modal__loot-header">
                  {lootTitle && (
                    <span class="loot-modal__loot-label">{lootTitle}</span>
                  )}
                  {lootTotal != null && lootTotal > 0 && (
                    <span class={totalClass}>
                      {lootSigned}{formatCompactCoins(lootTotal)} gp
                    </span>
                  )}
                </div>
              )}
              <div class="loot-modal__loot-scroll">
                {loot.map((row, idx) => (
                  <LootResultRow
                    key={row.key ?? row.itemId ?? idx}
                    item={row.item}
                    name={row.name}
                    quantity={row.quantity}
                    gp={row.gp}
                    lost={row.lost}
                    highlight={row.highlight}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        {(primaryAction || secondaryAction) && (
          <div class="loot-modal__actions">
            {secondaryAction && (
              <button
                class="loot-btn--secondary"
                onClick={secondaryAction.onClick}
              >
                {secondaryAction.label}
              </button>
            )}
            {primaryAction && (
              <button
                class="loot-btn--primary"
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
