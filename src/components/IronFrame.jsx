/**
 * IronFrame — the signature Forgemark container. A dark hammered-iron frame
 * with brass rivets pinned at the corners, holding an inset parchment panel.
 * This is the core bespoke surface: chrome is iron, content is parchment.
 *
 * `bare` drops the parchment inset (content sits directly on iron — for image
 * mounts / banners). `rivets={false}` removes the corner hardware.
 */
export default function IronFrame({
  children,
  bare = false,
  rivets = true,
  parchStyle = {},
  class: className = '',
  style = {},
  ...props
}) {
  return (
    <div class={`fm-frame ${className}`} style={style} {...props}>
      {bare ? children : <div class="fm-parch" style={{ padding: '18px', ...parchStyle }}>{children}</div>}
      {rivets && (
        <div class="fm-rivets" aria-hidden="true">
          <span class="fm-rivet fm-rivet--tl" />
          <span class="fm-rivet fm-rivet--tr" />
          <span class="fm-rivet fm-rivet--bl" />
          <span class="fm-rivet fm-rivet--br" />
        </div>
      )}
    </div>
  )
}
