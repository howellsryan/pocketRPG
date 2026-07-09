/**
 * Shared action/target row for skilling screens (mining ores, agility courses,
 * thieving targets, hunter actions, gather tasks, construction builds, etc.).
 *
 * Layout: [icon tile] [title + meta] [output chip / custom right node].
 * States: available (default), active (gold glow + ACTIVE badge), locked
 * (lock glyph + requirement), disabled (dimmed, non-interactive).
 *
 * Props:
 *   icon     — node for the icon tile (GameIcon / SkillIcon / emoji span); the
 *              tile is omitted entirely when falsy (unless locked)
 *   title    — primary label
 *   meta     — secondary node (level · xp · time …)
 *   chip     — optional node rendered as the gold output chip on the right
 *   right    — optional arbitrary right node (overrides chip)
 *   active   — highlight as the running action
 *   locked   — render as locked (icon replaced by a lock glyph)
 *   lockBadge — short badge text for a locked row, e.g. "LV 85"
 *   lockHint  — hint text for a locked row, e.g. "Unlocks at Mining 85"
 *   disabled — dim + non-interactive (requirements unmet)
 *   onClick  — click handler (ignored when locked/disabled)
 *   className — extra classes
 */
const LockGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="5" y="11" width="14" height="9" rx="2" stroke="#7c776c" stroke-width="1.8" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="#7c776c" stroke-width="1.8" />
  </svg>
)

export default function SkillActionRow({
  icon = null,
  title,
  meta = null,
  chip = null,
  right = null,
  below = null,
  active = false,
  locked = false,
  lockBadge = null,
  lockHint = null,
  disabled = false,
  onClick,
  className = '',
}) {
  const interactive = !!onClick && !locked && !disabled

  let frameClass
  if (active) {
    frameClass = 'bg-gradient-to-b from-[rgba(212,160,23,0.08)] to-[rgba(212,160,23,0.03)] border-[1.5px] border-[rgba(212,160,23,0.42)] shadow-[0_0_22px_rgba(212,160,23,0.10)]'
  } else if (locked || disabled) {
    frameClass = 'bg-[var(--color-void)] border border-[var(--color-void-border)] opacity-55'
  } else {
    frameClass = 'bg-[var(--color-void-light)] border border-[var(--color-void-border)] active:bg-[var(--color-void-lighter)]'
  }

  const tileClass = active
    ? 'bg-[rgba(212,160,23,0.08)] border border-[rgba(212,160,23,0.22)]'
    : 'bg-[var(--color-void)] border border-[var(--color-void-border)]'

  return (
    <button
      type="button"
      onClick={interactive ? onClick : undefined}
      disabled={!interactive}
      class={`w-full text-left flex flex-col gap-2 px-3.5 py-3 rounded-2xl transition-colors ${frameClass} ${interactive ? 'cursor-pointer' : 'cursor-default'} ${className}`}
    >
      <div class="flex items-center gap-3 w-full">
      {(locked || icon) && (
        <div class={`w-[46px] h-[46px] flex-shrink-0 rounded-xl flex items-center justify-center ${tileClass}`}>
          {locked ? <LockGlyph /> : icon}
        </div>
      )}

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class={`text-[16px] font-semibold ${locked || disabled ? 'text-[var(--color-parchment)] opacity-60' : 'text-[var(--color-parchment)]'}`}>
            {title}
          </span>
          {active && (
            <span class="flex items-center gap-1 text-[9.5px] font-bold tracking-wider text-[var(--color-gold)]">
              <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-emerald-light)] shadow-[0_0_6px_var(--color-emerald-light)]" />
              ACTIVE
            </span>
          )}
        </div>
        {locked ? (
          <div class="flex items-center gap-2 mt-1">
            {lockBadge && (
              <span class="text-[10.5px] font-bold tracking-wide text-[var(--color-parchment)] opacity-60 bg-[var(--color-void-light)] px-1.5 py-0.5 rounded-md">
                {lockBadge}
              </span>
            )}
            {lockHint && <span class="text-[12px] font-semibold text-[var(--color-parchment)] opacity-35">{lockHint}</span>}
          </div>
        ) : (
          meta && <div class="text-[12.5px] font-semibold text-[var(--color-parchment)] opacity-45 mt-1">{meta}</div>
        )}
      </div>

      {right ?? (chip && (
        <div class={`flex items-center gap-1.5 flex-shrink-0 px-2.5 py-1.5 rounded-xl ${active ? 'bg-[rgba(212,160,23,0.12)] border border-[rgba(212,160,23,0.28)]' : 'bg-[rgba(212,160,23,0.07)] border border-[rgba(212,160,23,0.16)]'} text-[12.5px] font-semibold text-[var(--color-gold)]`}>
          {chip}
        </div>
      ))}
      </div>

      {below && <div class="w-full text-center">{below}</div>}
    </button>
  )
}
