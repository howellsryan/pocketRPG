// Floating hit splats rendered over a combatant's HP area. Render inside a
// `position: relative` wrapper around the HP bar. Reusable: the future PvP
// design can drop this layer in and feed it splats from its own event stream
// (see src/utils/hitSplats.js for the splat shape).
export function HitSplatLayer({ splats }) {
  if (!splats || splats.length === 0) return null
  return (
    <div class="hit-splat-layer" aria-hidden="true">
      {splats.map((s) => (
        <div
          key={s.id}
          class={`hit-splat ${s.variant === 'summon' ? 'hit-splat--summon' : s.value > 0 ? 'hit-splat--damage' : 'hit-splat--zero'}`}
          style={{ left: `${s.left}%` }}
        >
          {s.value}
        </div>
      ))}
    </div>
  )
}
