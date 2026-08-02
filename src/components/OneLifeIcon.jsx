/**
 * The One Life mark: a single ivory life-pip, split by an ember fissure.
 *
 * A UI status marker, not an entity — so it is a component rather than an entry
 * in bespokeIcons.json. Both icon maps ship in the lazily loaded game chunk
 * (build_single.cjs), and the sign-up screen where One Life is chosen renders
 * before that chunk exists; an icon that resolves to a placeholder on the one
 * screen that has to sell the mode is no icon at all.
 *
 * Deliberately not a skull: 💀 is Slayer's mark all over the app, and the two
 * must not read as the same thing. A single heart is the universal "one life
 * left", the fissure is what is at stake.
 *
 * Flat fills, no gradients — a leaderboard renders one of these per one-life
 * player, and duplicated <defs> ids in a shared DOM are a trap for no gain at
 * 14px. Ivory body so it reads on parchment, on iron, and inside red warning
 * text alike.
 */
export default function OneLifeIcon({ size = 16, class: cls = '', title = 'One Life' }) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      class={cls}
      role="img"
      aria-label={title}
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: '-0.15em' }}
    >
      <title>{title}</title>
      <g stroke="#1a1410" stroke-width="20" stroke-linejoin="round" stroke-linecap="round">
        {/* Two halves, not one heart with a line drawn on it: the seam has to
            survive being 10px tall, and a stroked crack fills in at that size. */}
        <path
          d="M256 128 C 236 88 200 62 156 62 C 90 62 40 112 40 184 C 40 278 132 356 256 470 L 256 470 L 232 396 L 268 336 L 224 292 L 274 232 L 236 190 Z"
          fill="#efe4cd"
        />
        <path
          d="M256 128 C 276 88 312 62 356 62 C 422 62 472 112 472 184 C 472 278 380 356 256 470 L 280 396 L 244 336 L 288 292 L 238 232 L 276 190 Z"
          fill="#efe4cd"
        />
      </g>
      <path
        d="M256 132 L 232 192 L 278 236 L 228 294 L 272 338 L 236 398 L 256 466"
        fill="none"
        stroke="#c2410c"
        stroke-width="16"
        stroke-linejoin="round"
        stroke-linecap="round"
        opacity="0.95"
      />
      <path d="M128 132 C 96 154 84 186 90 216" fill="none" stroke="#ffffff" stroke-width="18" stroke-linecap="round" opacity="0.5" />
    </svg>
  )
}
