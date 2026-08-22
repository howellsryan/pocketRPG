import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { api, getToken, getCharacterId, CREDITS_UPDATED_EVENT } from '../cloud/api.js'
import { getMonsterArt } from '../utils/combatArt.js'
import { SLAYER_TASK_BLOCK_COST, SLAYER_TASK_BLOCK_MAX } from '../engine/slayerTaskBlocks.js'
import {
  allBlockableSlayerTaskIds, resolveTaskMonsterIds, resolveSlayerTaskName,
} from '../engine/slayerMasters.js'
import monstersData from '../data/monsters.json'
import BackLink from '../components/BackLink.jsx'
import GameIcon from '../components/GameIcon.jsx'
import SkillEmblem from '../components/SkillEmblem.jsx'
import Modal from '../components/Modal.jsx'

function taskArt(monsterId) {
  const lead = resolveTaskMonsterIds(monsterId).map(mid => monstersData[mid]).find(Boolean) || null
  return getMonsterArt(lead || { id: monsterId })
}

const ALL_TASK_IDS = allBlockableSlayerTaskIds()

export default function SlayerTaskBlockScreen({ onBack }) {
  const { slayerTaskBlocks, applySlayerTaskBlockPurchase, applySlayerTaskBlockActive, applySlayerTaskBlockRemoval, addToast } = useGame()
  const isCloud = Boolean(getToken() && getCharacterId())
  const [busyId, setBusyId] = useState(null)
  const [pendingRemove, setPendingRemove] = useState(null)
  const [showAdd, setShowAdd] = useState(false)

  const blocks = slayerTaskBlocks || []
  const blockedIds = new Set(blocks.map(b => b.monsterId))
  const atCap = blocks.length >= SLAYER_TASK_BLOCK_MAX
  const available = ALL_TASK_IDS.filter(id => !blockedIds.has(id))

  const handlePurchase = async (monsterId) => {
    if (!isCloud) { addToast('Sign in to purchase a Slayer Task Block.', 'error'); return }
    if (busyId) return
    setBusyId(monsterId)
    try {
      const res = await api.purchaseSlayerTaskBlock(monsterId)
      const remaining = Number(res?.credits_remaining)
      if (Number.isFinite(remaining)) {
        window.dispatchEvent(new CustomEvent(CREDITS_UPDATED_EVENT, { detail: { credits_remaining: remaining } }))
      }
      applySlayerTaskBlockPurchase(monsterId)
      addToast(`🚫 ${resolveSlayerTaskName(monsterId)} blocked — it will never be assigned as a task.`, 'info')
      setShowAdd(false)
    } catch (err) {
      if (err?.status === 402) addToast('Not enough credits.', 'error')
      else if (err?.body?.code === 'BLOCK_LIST_FULL') addToast(`Block list is full (max ${SLAYER_TASK_BLOCK_MAX}).`, 'error')
      else addToast(err?.message || 'Purchase failed.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const handleToggle = async (monsterId, nextActive) => {
    if (busyId) return
    setBusyId(monsterId)
    try {
      await api.setSlayerTaskBlockActive(monsterId, nextActive)
      applySlayerTaskBlockActive(monsterId, nextActive)
      addToast(nextActive ? `Block re-activated for ${resolveSlayerTaskName(monsterId)}.` : `Block paused for ${resolveSlayerTaskName(monsterId)} — it can be assigned again.`, 'info')
    } catch (err) {
      addToast(err?.message || 'Failed to update block.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const confirmRemove = async () => {
    const monsterId = pendingRemove
    setPendingRemove(null)
    if (!monsterId || busyId) return
    setBusyId(monsterId)
    try {
      await api.removeSlayerTaskBlock(monsterId)
      applySlayerTaskBlockRemoval(monsterId)
      addToast(`Block removed for ${resolveSlayerTaskName(monsterId)}.`, 'info')
    } catch (err) {
      addToast(err?.message || 'Failed to remove block.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div class="forge-shell h-full overflow-y-auto p-4">
      <BackLink onClick={onBack} className="mb-3" />

      <h2 class="flex items-center gap-2 font-[var(--font-display)] text-base font-bold text-[var(--color-gold)] mb-0.5">
        <GameIcon iconKey="death_skull" size={20} class="flex-shrink-0" />
        Slayer Task Block List
      </h2>
      <p class="text-xs text-[var(--color-parchment)] opacity-40 mb-4">
        Block a monster to stop every Slayer Master from ever assigning it. {SLAYER_TASK_BLOCK_COST} credits per block, up to {SLAYER_TASK_BLOCK_MAX}. Pause a block for free and re-activate it later — removing one entirely means repurchasing it.
      </p>

      {blocks.length === 0 ? (
        <p class="text-xs text-[var(--color-parchment)] opacity-55 mb-4">No monsters blocked yet.</p>
      ) : (
        <div class="space-y-2 mb-4">
          {blocks.map(({ monsterId, active }) => {
            const art = taskArt(monsterId)
            const busy = busyId === monsterId
            return (
              <div
                key={monsterId}
                class={`flex items-center gap-3 p-3 rounded-xl border ${active ? 'bg-[var(--surface-raised)] border-[var(--color-void-border)]' : 'bg-[var(--color-void)] border-[var(--color-void-border)] opacity-60'}`}
              >
                <SkillEmblem iconKey={art.icon} accent={art.accent} size={32} glow={active ? 1 : 0.4} />
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-semibold text-[var(--color-parchment)]">{resolveSlayerTaskName(monsterId)}</div>
                  <div class="text-[10px] text-[var(--color-parchment)] opacity-50">{active ? 'Blocked — never assigned' : 'Paused — can be assigned'}</div>
                </div>
                <button
                  onClick={() => handleToggle(monsterId, !active)}
                  disabled={busy}
                  class={`fm-btn fm-btn--sm text-[10px] uppercase tracking-wider min-w-[64px] ${active ? 'fm-btn--brass' : ''}`}
                >
                  {active ? 'Active' : 'Paused'}
                </button>
                <button
                  onClick={() => setPendingRemove(monsterId)}
                  disabled={busy}
                  class="fm-btn fm-btn--sm text-[10px] uppercase tracking-wider text-[var(--color-blood-light)]"
                  aria-label={`Remove block for ${resolveSlayerTaskName(monsterId)}`}
                >
                  <GameIcon iconKey="cancel" size={14} color="var(--color-blood-light)" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <button
        onClick={() => setShowAdd(true)}
        disabled={atCap || available.length === 0}
        class={`fm-btn w-full uppercase tracking-wider ${atCap ? '' : 'fm-btn--brass'}`}
      >
        {atCap ? `Block list full (${SLAYER_TASK_BLOCK_MAX}/${SLAYER_TASK_BLOCK_MAX})` : `+ Block a monster (${SLAYER_TASK_BLOCK_COST} credits)`}
      </button>

      {!isCloud && (
        <p class="mt-4 text-center text-[11px] text-[var(--color-parchment)] opacity-40">
          Sign in with a cloud account to purchase blocks.
        </p>
      )}

      {showAdd && (
        <Modal title="Block a monster" onClose={() => setShowAdd(false)}>
          <div class="space-y-2 max-h-[60vh] overflow-y-auto">
            {available.map(monsterId => {
              const art = taskArt(monsterId)
              const busy = busyId === monsterId
              return (
                <button
                  key={monsterId}
                  onClick={() => handlePurchase(monsterId)}
                  disabled={busy}
                  class="w-full flex items-center gap-3 p-2.5 rounded-xl border border-[var(--color-void-border)] bg-[var(--color-void-light)] text-left disabled:opacity-40"
                >
                  <SkillEmblem iconKey={art.icon} accent={art.accent} size={28} glow={1} />
                  <span class="flex-1 min-w-0 text-sm font-semibold text-[var(--color-parchment)]">{resolveSlayerTaskName(monsterId)}</span>
                  <span class="text-[11px] font-bold text-[var(--color-gold)] flex-shrink-0">{SLAYER_TASK_BLOCK_COST} cr</span>
                </button>
              )
            })}
          </div>
        </Modal>
      )}

      {pendingRemove && (
        <Modal title="Remove block?" onClose={() => setPendingRemove(null)}>
          <div class="space-y-4">
            <p class="text-sm text-[var(--color-parchment)] opacity-80">
              Remove the block on <span class="font-bold text-[var(--color-gold)]">{resolveSlayerTaskName(pendingRemove)}</span>? This deletes the purchase — you'll need to pay {SLAYER_TASK_BLOCK_COST} credits again to block it in the future. Pausing it instead (Active/Paused) keeps the purchase for free.
            </p>
            <div class="grid grid-cols-2 gap-2">
              <button onClick={() => setPendingRemove(null)} class="fm-btn fm-btn--sm">Cancel</button>
              <button onClick={confirmRemove} class="fm-btn fm-btn--blood fm-btn--sm">Remove</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
