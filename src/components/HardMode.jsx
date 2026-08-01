// Hard Mode's player-facing pieces: the switch on the fight prompt, the
// confirmation that stands between a player and losing their gear, and the tag
// that marks a boss as set to hard everywhere else it is listed.
//
// The switch writes to the SERVER before it changes anything on screen — the
// doubled drop rates are the server's decision (§14), so a switch that flipped
// locally on a failed write would sell the player a fight twice as hard for
// ordinary loot. `pending` is the round trip.

import { HARD_MODE_MULTIPLIERS } from '../engine/hardMode.js'

const { hitpoints, offence, dropRate } = HARD_MODE_MULTIPLIERS

export function HardModeTag({ className = '' }) {
  return (
    <span class={`text-[9px] font-bold uppercase tracking-wider text-[var(--color-blood-light)] ${className}`}>
      Hard
    </span>
  )
}

/** The one line that has to land before anything else: death is permanent loss. */
export function HardModeDeathWarning({ className = '' }) {
  return (
    <p class={`text-[10px] font-semibold text-[var(--color-blood-light)] ${className}`}>
      ☠ If you die in Hard Mode you lose every <strong>tradeable</strong> item you are carrying and wearing —
      permanently. Untradeables (Infernal Cape, quest gear, skill capes) stay with you, and your bank is safe.
    </p>
  )
}

export function HardModeToggle({ enabled, pending = false, onToggle }) {
  return (
    <div>
      <button
        onClick={() => { if (!pending) onToggle(!enabled) }}
        disabled={pending}
        aria-pressed={enabled ? 'true' : 'false'}
        class={`fm-toggle w-full justify-between text-left ${enabled ? 'is-on' : ''}`}
      >
        <span class="flex flex-col gap-0.5">
          <span class="text-sm font-semibold">Hard Mode</span>
          <span class="text-[10px] font-normal opacity-70">
            {hitpoints}× health, {offence}× max hit and accuracy, {dropRate}× drop rates. Solo and group fights.
          </span>
        </span>
        <span class="fm-toggle__n">{pending ? '…' : enabled ? 'ON' : 'OFF'}</span>
      </button>
      <HardModeDeathWarning className="mt-1.5" />
    </div>
  )
}

/**
 * The confirmation for switching hard mode ON. Turning it OFF needs none —
 * nothing is at stake in going back to the ordinary fight.
 */
export function HardModeConfirm({ name, pending = false, onConfirm, onCancel }) {
  return (
    <div>
      <div class="text-sm font-bold text-[var(--color-blood-light)] mb-1">Fight {name} in Hard Mode?</div>
      <p class="text-[11px] text-[var(--color-parchment)] opacity-70 mb-2">
        It will have {hitpoints}× health and hit {offence}× as hard, {offence}× as often on the mark. Its drop
        rates double.
      </p>
      <HardModeDeathWarning className="mb-3" />
      <div class="flex gap-2">
        <button
          onClick={onCancel}
          class="flex-1 fm-btn fm-btn--ghost"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={pending}
          class="flex-1 fm-btn fm-btn--blood"
        >
          {pending ? '…' : 'I accept the risk'}
        </button>
      </div>
    </div>
  )
}
