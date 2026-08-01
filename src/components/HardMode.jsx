// Hard Mode's player-facing pieces: the switch on the fight prompt, the
// confirmation that stands between a player and losing their gear, and the tag
// that marks a boss as set to hard everywhere else it is listed.
//
// The switch writes to the SERVER before it changes anything on screen — the
// doubled drop rates are the server's decision (§14), so a switch that flipped
// locally on a failed write would sell the player a fight twice as hard for
// ordinary loot. `pending` is the round trip.
//
// The prompt this sits in is a phone-height modal that already carries two or
// three fight options, so the switch is ONE line and the terms are two short
// ones under it. `.fm-toggle` centres its own content (index.css) — the sub-line
// lives outside the button rather than fighting that, which also keeps the tap
// target a clean 44px band.

import OneLifeIcon from './OneLifeIcon.jsx'
import { HARD_MODE_MULTIPLIERS } from '../engine/hardMode.js'

const { offence, dropRate } = HARD_MODE_MULTIPLIERS

export function HardModeTag({ className = '' }) {
  return (
    <span class={`text-[9px] font-bold uppercase tracking-wider text-[var(--color-blood-light)] ${className}`}>
      Hard
    </span>
  )
}

/** The terms, in the fewest words that stay true. */
export function HardModeTerms({ className = '' }) {
  return (
    <p class={`text-[10px] text-[var(--color-parchment)] opacity-70 ${className}`}>
      {offence}× max hit · {offence}× accuracy · {dropRate}× drop rates · same health and defence
    </p>
  )
}

/** The one line that has to land before anything else: death is permanent loss. */
export function HardModeDeathWarning({ className = '' }) {
  return (
    <p class={`flex items-start gap-1.5 text-[10px] font-semibold text-[var(--color-blood-light)] ${className}`}>
      <OneLifeIcon size={13} title="" class="mt-px" />
      <span>Die and you lose everything you are carrying and wearing. Bank and untradeables are safe.</span>
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
        class={`fm-toggle w-full justify-between ${enabled ? 'is-on' : ''}`}
      >
        <span>Hard Mode</span>
        <span class="fm-toggle__n">{pending ? '…' : enabled ? 'ON' : 'OFF'}</span>
      </button>
      <HardModeTerms className="mt-1.5" />
      <HardModeDeathWarning className="mt-1" />
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
      <div class="text-sm font-bold text-[var(--color-blood-light)] mb-1.5">Fight {name} in Hard Mode?</div>
      <p class="text-[11px] text-[var(--color-parchment)] opacity-70 mb-2">
        It hits {offence}× as hard and lands {offence}× as often. Its health and defences are unchanged, so it
        dies just as fast — the danger is what it does to you first.
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
