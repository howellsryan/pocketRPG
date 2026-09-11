import itemsData from '../data/items.json'
import { SUNSPIRE_MODIFIERS } from '../engine/sunspireModifiers.js'
import GameIcon from './GameIcon.jsx'

function sunspireRewardRows(rewards) {
  return (Array.isArray(rewards) ? rewards : []).filter((r) => r?.itemId && Number(r.quantity) > 0)
}

function sunspireModifierLabel(id, tier) {
  const base = SUNSPIRE_MODIFIERS[id]?.name || String(id || '').replace(/_/g, ' ')
  return tier > 0 ? base + ' · Tier ' + (tier + 1) : base
}

export default function SunspireDecisionPanel({
  wave,
  totalWaves = 12,
  staged = [],
  chest = [],
  modifierState = {},
  offers = [],
  finalWave = false,
  canChoose = true,
  busy = false,
  onChoose,
  onClaim,
}) {
  const stagedRows = sunspireRewardRows(staged)
  const chestRows = sunspireRewardRows(chest)
  const active = Object.entries(modifierState || {}).filter(([, tier]) => Number(tier) > 0)

  return (
    <div class="mx-auto w-full max-w-2xl rounded-2xl border border-[var(--color-gold-dim)] bg-[var(--color-void-light)] p-4 shadow-xl">
      <div class="text-center mb-4">
        <div class="text-[10px] uppercase tracking-[0.24em] text-[var(--color-gold)] opacity-80">Sunspire Colosseum</div>
        <h2 class="font-[var(--font-display)] text-xl text-[var(--color-parchment)] mt-1">
          Wave {wave} / {totalWaves} cleared
        </h2>
        <p class="text-[11px] text-[var(--color-parchment)] opacity-60 mt-1">
          Your chest is safe here. Continue to risk everything, or claim it and leave.
        </p>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <div class="rounded-xl border border-[var(--color-void-border)] bg-[var(--color-void)] p-3">
          <div class="text-[10px] uppercase tracking-wider text-[var(--color-gold-dim)] mb-2">This wave</div>
          {stagedRows.length ? stagedRows.map((reward) => {
            const item = itemsData[reward.itemId]
            return (
              <div key={reward.itemId} class="flex items-center justify-between gap-2 py-1">
                <span class="flex items-center gap-2 min-w-0 text-xs text-[var(--color-parchment)]">
                  <GameIcon item={item} iconKey={item?.iconId} size={18} />
                  <span class="truncate">{item?.name || reward.itemId}</span>
                </span>
                <span class="font-[var(--font-mono)] text-[11px] text-[var(--color-gold)]">×{Number(reward.quantity).toLocaleString()}</span>
              </div>
            )
          }) : <div class="text-xs opacity-50 text-[var(--color-parchment)]">No staged reward.</div>}
        </div>

        <div class="rounded-xl border border-[var(--color-gold-dim)] bg-[var(--surface-raised)] p-3">
          <div class="text-[10px] uppercase tracking-wider text-[var(--color-gold)] mb-2">Unclaimed chest</div>
          {chestRows.map((reward) => {
            const item = itemsData[reward.itemId]
            return (
              <div key={reward.itemId} class="flex items-center justify-between gap-2 py-1">
                <span class="flex items-center gap-2 min-w-0 text-xs text-[var(--color-parchment)]">
                  <GameIcon item={item} iconKey={item?.iconId} size={18} />
                  <span class="truncate">{item?.name || reward.itemId}</span>
                </span>
                <span class="font-[var(--font-mono)] text-[11px] text-[var(--color-gold)]">×{Number(reward.quantity).toLocaleString()}</span>
              </div>
            )
          })}
        </div>
      </div>

      {active.length > 0 && (
        <div class="mt-3">
          <div class="text-[10px] uppercase tracking-wider text-[var(--color-parchment)] opacity-50 mb-1.5">Active modifiers</div>
          <div class="flex flex-wrap gap-1.5">
            {active.map(([id, tier]) => (
              <span key={id} class="rounded-full border border-[var(--color-void-border)] px-2 py-1 text-[10px] text-[var(--color-parchment)]">
                {SUNSPIRE_MODIFIERS[id]?.name || id.replace(/_/g, ' ')} · T{tier}
              </span>
            ))}
          </div>
        </div>
      )}

      {!finalWave && (
        <div class="mt-4">
          <div class="text-[10px] uppercase tracking-wider text-[var(--color-gold-dim)] mb-2">
            {canChoose ? 'Choose one modifier to continue' : 'Waiting for the host to choose'}
          </div>
          <div class="grid gap-2 sm:grid-cols-3">
            {offers.map((id) => (
              <button
                key={id}
                disabled={!canChoose || busy}
                onClick={() => onChoose?.(id)}
                class="min-h-[48px] rounded-xl border border-[var(--color-void-border)] bg-[var(--color-void)] px-3 py-2 text-left active:opacity-80 disabled:opacity-45"
              >
                <div class="text-xs font-semibold text-[var(--color-parchment)]">{sunspireModifierLabel(id, Number(modifierState?.[id]) || 0)}</div>
                <div class="text-[9px] text-[var(--color-parchment)] opacity-50 mt-0.5">Persists for the rest of this run</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        disabled={busy || !canChoose}
        onClick={() => onClaim?.()}
        class="mt-4 w-full min-h-[48px] rounded-xl border border-[var(--color-gold)] bg-[var(--color-gold)] px-4 py-2 font-bold text-[var(--color-void)] disabled:opacity-45"
      >
        {finalWave ? 'Claim Victory Chest' : 'Claim & Leave'}
      </button>
    </div>
  )
}
