/**
 * Shared expand/collapse indicator — a single engraved chevron that rotates
 * between pointing down (expanded, content revealed below) and pointing
 * right (collapsed). Replaces plain ▼/▶ glyphs everywhere so the mark reads
 * as a deliberate ledger/ironwork detail rather than a stray browser font
 * character.
 */
export default function CollapseChevron({ expanded = false, size = 10, className = '' }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      class={`flex-shrink-0 ${className}`}
      style={{
        transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
        transition: 'transform var(--fm-dur, 0.16s) var(--fm-ease, cubic-bezier(0.2, 0.9, 0.3, 1))',
      }}
      aria-hidden="true"
    >
      <path d="M2.5 4.25 L6 7.75 L9.5 4.25" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}
