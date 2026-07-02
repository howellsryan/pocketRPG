/**
 * Shared inline banner for skilling screens — a soft tinted card with a
 * leading icon and a line of guidance (tool hints, bank-speed notes, generic
 * skill blurbs). Replaces the assorted ad-hoc `bg-[#111] rounded` notes.
 *
 * Props:
 *   tone     — 'gold' (default, advisory/warn) | 'neutral' (muted info)
 *   icon     — leading node (SkillIcon, GameIcon, emoji span, or svg)
 *   children — banner text
 *   className — extra classes
 */
const TONES = {
  gold: 'bg-[rgba(212,160,23,0.08)] border-[rgba(212,160,23,0.25)]',
  neutral: 'bg-[rgba(0,0,0,0.035)] border-[rgba(0,0,0,0.1)]',
}

export default function SkillInfoBanner({ tone = 'gold', icon = null, children, className = '' }) {
  return (
    <div class={`flex items-start gap-2.5 px-3.5 py-3 rounded-2xl border ${TONES[tone] || TONES.gold} ${className}`}>
      {icon && <div class="flex-shrink-0 mt-px leading-none">{icon}</div>}
      <div class="text-[13px] leading-snug font-medium text-[var(--color-parchment)] opacity-70">
        {children}
      </div>
    </div>
  )
}
