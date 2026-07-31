// Hard Mode's two player-facing pieces: the switch on the fight prompt and the
// tag that marks a boss as set to hard everywhere else it is listed.
//
// The switch writes to the SERVER before it changes anything on screen — the
// doubled drop rates are the server's decision (§14), so a switch that flipped
// locally on a failed write would sell the player a fight twice as hard for
// ordinary loot. `pending` is the round trip.

import { HARD_MODE_SCALE } from '../engine/hardMode.js'

export function HardModeTag({ className = '' }) {
  return (
    <span class={`text-[9px] font-bold uppercase tracking-wider text-[var(--color-blood-light)] ${className}`}>
      Hard
    </span>
  )
}

export function HardModeToggle({ enabled, pending = false, onToggle }) {
  return (
    <button
      onClick={() => { if (!pending) onToggle(!enabled) }}
      disabled={pending}
      aria-pressed={enabled ? 'true' : 'false'}
      class={`fm-toggle w-full justify-between text-left ${enabled ? 'is-on' : ''}`}
    >
      <span class="flex flex-col gap-0.5">
        <span class="text-sm font-semibold">Hard Mode</span>
        <span class="text-[10px] font-normal opacity-70">
          {HARD_MODE_SCALE}× health and combat stats, {HARD_MODE_SCALE}× drop rates. Solo and group fights.
        </span>
      </span>
      <span class="fm-toggle__n">{pending ? '…' : enabled ? 'ON' : 'OFF'}</span>
    </button>
  )
}
