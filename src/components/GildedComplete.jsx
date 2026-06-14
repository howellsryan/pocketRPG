// Reusable "completed" gilding extracted from the collection log. Wraps any
// card/row unchanged and, when `complete` is true, overlays the gold ring,
// four corner brackets, and the continuous shimmer sweep (keyframes shared with
// the collection log). When incomplete it renders a transparent flex wrapper so
// the child's own layout/styling is untouched.
//
// The wrapper is a flex box (single in-flow child stretched to fill) so it can
// drop into grid cells, flex columns, or block flow without disturbing width or
// height. The decorative corner/shimmer nodes are absolutely positioned and sit
// out of flow. Note: while complete the wrapper is `overflow: hidden` to clip
// the shimmer — avoid wrapping a card that needs to overflow its own bounds.
export default function GildedComplete({ complete, className = '', children }) {
  const cls = 'gild' + (complete ? ' is-complete' : '') + (className ? ' ' + className : '')
  return (
    <div class={cls}>
      {complete && (
        <>
          <i class="gild-corner tl" /><i class="gild-corner tr" />
          <i class="gild-corner bl" /><i class="gild-corner br" />
          <span class="gild-shimmer" aria-hidden="true" />
        </>
      )}
      {children}
    </div>
  )
}
