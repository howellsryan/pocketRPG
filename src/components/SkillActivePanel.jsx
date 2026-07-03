import SkillIcon from './SkillIcon.jsx'
import BackLink from './BackLink.jsx'

/**
 * Shared "action in progress" screen for every idle skilling activity:
 * a glowing skill orb, the action title, an optional "producing" chip, a
 * shimmering progress bar, a SESSION stats card, and a Stop & Back button.
 *
 * Props:
 *   skill      — skill id for the orb glyph (or pass `icon`)
 *   icon       — node override for the orb glyph
 *   title      — action name
 *   subtitle   — optional description under the title
 *   producing  — optional node shown in the gold "producing" chip
 *   progress   — 0..1 completion of the current action
 *   stats      — array of { label, value, accent } rows for the SESSION card
 *   statsTitle — card heading, default "SESSION"
 *   footer     — optional { icon, label, value } highlighted footer row
 *   note       — optional node shown under the stats card (free-form hint)
 *   onStop     — stop handler
 *   stopLabel  — stop button text, default "Stop & Back"
 */
export default function SkillActivePanel({
  skill,
  icon = null,
  title,
  subtitle = null,
  producing = null,
  progress = 0,
  stats = [],
  statsTitle = 'SESSION',
  footer = null,
  note = null,
  onBack = null,
  onStop,
  stopLabel = 'Stop & Back',
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)))
  const glyph = icon || <SkillIcon skill={skill} size={50} />

  return (
    <div class="forge-shell h-full flex flex-col px-5 pt-2 min-h-0">
      {/* Back — leaves the task running (Stop & Back below cancels it) */}
      <BackLink onClick={onBack} className="mb-3" />

      {/* Scrollable body so the SESSION card never gets clipped on short screens */}
      <div class="flex-1 min-h-0 overflow-y-auto">
      {/* Orb */}
      <div class="flex flex-col items-center mt-6">
        <div class="relative w-[148px] h-[148px] flex items-center justify-center">
          <div class="absolute inset-0 rounded-full border-[1.5px] border-dashed border-[rgba(212,160,23,0.30)] skill-ring-spin" />
          <div class="w-[112px] h-[112px] rounded-full flex items-center justify-center skill-orb-pulse bg-[radial-gradient(circle_at_50%_38%,#1a1813,#0c0b0a)]">
            {glyph}
          </div>
        </div>
        <div class="font-[var(--font-display)] text-[22px] font-bold text-[var(--color-gold-light)] mt-5 text-center">
          {title}
        </div>
        {subtitle && (
          <div class="text-[12px] text-[var(--color-parchment)] opacity-40 mt-1 text-center">{subtitle}</div>
        )}
        {producing && (
          <div class="flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-xl bg-[rgba(212,160,23,0.07)] border border-[rgba(212,160,23,0.18)]">
            {producing}
          </div>
        )}
      </div>

      {/* Progress */}
      <div class="mt-7">
        <div class="relative h-4 rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden">
          <div
            class="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[var(--color-gold-dim)] to-[var(--color-gold-light)] min-w-[14px]"
            style={{ width: `${pct}%` }}
          />
          <div class="absolute top-0 left-0 w-2/5 h-full skill-bar-shine bg-gradient-to-r from-transparent via-[rgba(255,255,255,0.35)] to-transparent" />
        </div>
        <div class="flex justify-end mt-2">
          <span class="text-[13px] font-semibold text-[var(--color-parchment)] opacity-50">{pct}%</span>
        </div>
      </div>

      {/* Session stats card */}
      {(stats.length > 0 || footer) && (
        <div class="mt-5 rounded-[22px] bg-[var(--color-void-light)] border border-[var(--color-void-border)] overflow-hidden">
          {stats.length > 0 && (
            <>
              <div class="px-[18px] pt-3.5 pb-3">
                <span class="font-[var(--font-display)] text-[11.5px] font-bold tracking-[0.14em] text-[var(--color-parchment)] opacity-50">
                  {statsTitle}
                </span>
              </div>
              <div class="h-px bg-[var(--color-void-border)] mx-[18px]" />
              <div class="px-[18px] py-1">
                {stats.map((row, i) => (
                  <div
                    key={row.label}
                    class={`flex items-center justify-between py-2.5 ${i < stats.length - 1 ? 'border-b border-[var(--color-void-border)]' : ''}`}
                  >
                    <span class="text-[14px] font-medium text-[var(--color-parchment)] opacity-75">{row.label}</span>
                    <span class={`text-[14px] font-bold font-[var(--font-mono)] flex items-center gap-1 ${row.accent === false ? 'text-[var(--color-parchment)] opacity-50' : 'text-[var(--color-gold-light)]'}`}>
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          {footer && (
            <>
              <div class="h-px bg-[var(--color-void-border)] mx-[18px]" />
              <div class="flex items-center justify-between px-[18px] py-3">
                <span class="flex items-center gap-2 text-[14px] font-medium text-[var(--color-parchment)] opacity-75">
                  {footer.icon}
                  {footer.label}
                </span>
                <span class="text-[14px] font-bold font-[var(--font-mono)] text-[var(--color-gold-light)]">{footer.value}</span>
              </div>
            </>
          )}
        </div>
      )}

      {note && (
        <div class="mt-4 text-[12px] leading-snug text-center text-[var(--color-parchment)] opacity-45">
          {note}
        </div>
      )}
      </div>

      {/* Stop button — pinned below the scroll area */}
      <button
        type="button"
        onClick={onStop}
        class="flex-shrink-0 mb-6 mt-4 w-full py-4 rounded-2xl flex items-center justify-center gap-2.5 cursor-pointer bg-[rgba(192,57,43,0.08)] border-[1.5px] border-[rgba(192,57,43,0.32)] active:opacity-80"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="2.5" fill="var(--color-blood-ember)" />
        </svg>
        <span class="text-[16px] font-semibold text-[var(--color-blood-ember)]">{stopLabel}</span>
      </button>
    </div>
  )
}
