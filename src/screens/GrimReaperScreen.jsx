import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { api, getToken, getCharacterId, CREDITS_UPDATED_EVENT } from '../cloud/api.js'
import { pullSave, applyCloudSave } from '../cloud/sync.js'
import BackLink from '../components/BackLink.jsx'
import Card from '../components/Card.jsx'
import GameIcon from '../components/GameIcon.jsx'
import { LootResultRow } from '../components/LootResultModal.jsx'
import { getLootTotalValue, getItemUnitValue } from '../utils/itemValue.js'
import { grimReaperCost } from '../engine/grimReaper.js'
import { formatCompactCoins } from '../utils/formatters.js'

function timeAgo(ts) {
  const ms = Date.now() - Number(ts || 0)
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function GrimReaperScreen({ onBack, loadGame }) {
  const { grimReaper, updateGrimReaperStash, itemsData, addToast } = useGame()
  const [busy, setBusy] = useState(false)
  const isCloud = Boolean(getToken() && getCharacterId())

  const stash = grimReaper?.items?.length > 0 ? grimReaper : null
  const totalValue = stash ? getLootTotalValue(stash.items, itemsData) : 0
  const cost = stash ? grimReaperCost(stash.items, itemsData) : 0
  const rows = stash
    ? stash.items.map((entry, idx) => {
        const unitGp = getItemUnitValue(entry.itemId, itemsData) || 0
        return {
          key: idx,
          item: itemsData[entry.itemId] || null,
          name: itemsData[entry.itemId]?.name || entry.itemId,
          quantity: entry.quantity,
          gp: unitGp * entry.quantity,
          unitGp,
        }
      })
    : []

  async function handleReclaim() {
    if (!stash || busy) return
    if (!isCloud) {
      addToast('Sign in to reclaim items with the Grim Reaper.', 'error')
      return
    }
    setBusy(true)
    try {
      const res = await api.reclaimGrimReaperStash()
      const remaining = Number(res?.credits_remaining)
      if (Number.isFinite(remaining)) {
        window.dispatchEvent(new CustomEvent(CREDITS_UPDATED_EVENT, { detail: { credits_remaining: remaining } }))
      }
      const cloud = await pullSave()
      if (cloud?.payload) await applyCloudSave(cloud.payload, cloud.updatedAt)
      // The server DELETEs the stash key rather than nulling it, so a generic
      // settings merge from the pull above leaves the old stash in IndexedDB —
      // clear it explicitly rather than relying on that pull.
      updateGrimReaperStash(null)
      if (loadGame) await loadGame()
      addToast('Reclaimed — sent to your bank.', 'success')
    } catch (err) {
      if (err?.body?.code === 'INSUFFICIENT_CREDITS') addToast(`Not enough credits — need ${err.body.cost ?? cost}.`, 'error')
      else if (err?.body?.code === 'NO_STASH') { updateGrimReaperStash(null); addToast('Nothing to reclaim.', 'error') }
      else addToast(err?.message || 'Reclaim failed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="forge-shell h-full overflow-y-auto p-4">
      <BackLink onClick={onBack} className="mb-3" />

      <h2 class="flex items-center gap-2 font-[var(--font-display)] text-base font-bold text-[var(--color-gold)] mb-0.5">
        <GameIcon iconKey="grim_reaper_reclaim" size={30} title="Grim Reaper" />
        Grim Reaper
      </h2>
      <p class="text-xs text-[var(--color-parchment)] opacity-40 mb-4">
        A hard-mode death holds what you lost here — one death at a time. Buy it all back with credits, or lose it forever to your next hard-mode death.
      </p>

      {!stash && (
        <Card className="p-6 text-center">
          <div class="flex justify-center mb-2"><GameIcon iconKey="grim_reaper_reclaim" size={64} title="Grim Reaper" /></div>
          <div class="text-sm text-[var(--color-parchment)] opacity-60">The Reaper holds nothing of yours.</div>
        </Card>
      )}

      {stash && (
        <Card className="p-4">
          <div class="flex items-center justify-between gap-3 mb-3">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-[var(--color-parchment)]">
                {stash.source?.name ? `Slain by ${stash.source.name}` : 'Hard Mode death'}
              </div>
              <div class="text-[10px] text-[var(--color-parchment)] opacity-50 mt-0.5">{timeAgo(stash.diedAt)}</div>
            </div>
            <div class="text-right flex-shrink-0">
              <div class="text-[10px] text-[var(--color-parchment)] opacity-50 uppercase tracking-wider">Value</div>
              <div class="text-sm font-bold text-[var(--color-gold)] font-[var(--font-mono)]">{formatCompactCoins(totalValue)} gp</div>
            </div>
          </div>

          <div class="divide-y divide-[var(--color-void-border)] -mx-1">
            {rows.map((row) => (
              <div key={row.key} class="px-1">
                <LootResultRow item={row.item} name={row.name} quantity={row.quantity} gp={row.gp} unitGp={row.unitGp} lost />
              </div>
            ))}
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={handleReclaim}
            class="fm-btn fm-btn--brass w-full mt-4 text-sm uppercase tracking-wider disabled:opacity-50"
          >
            {busy ? 'Reclaiming…' : `Reclaim all — ${cost.toLocaleString()} credit${cost === 1 ? '' : 's'}`}
          </button>

          {!isCloud && (
            <p class="mt-3 text-center text-[11px] text-[var(--color-parchment)] opacity-40">
              Sign in with a cloud account to reclaim.
            </p>
          )}
        </Card>
      )}
    </div>
  )
}
