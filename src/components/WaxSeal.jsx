/**
 * WaxSeal — the pressed sealing-wax stamp (crossed-swords sigil). Decorative
 * brand mark and "official" status stamp. Pass `label` to caption it.
 */
export default function WaxSeal({
  size = 88,
  label,
  rotate = -8,
  src = '/public/forge/wax-seal.svg',
  class: className = '',
  style = {},
}) {
  return (
    <div class={className} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 8, ...style }}>
      <img
        src={src}
        width={size}
        height={size}
        alt={label || 'Wax seal'}
        style={{ transform: `rotate(${rotate}deg)`, filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.45))' }}
      />
      {label && <span class="fm-eyebrow" style={{ fontSize: 10 }}>{label}</span>}
    </div>
  )
}
