import { useGame } from '../state/gameState.jsx'
import { api, getToken, getCharacterId, CREDITS_UPDATED_EVENT } from '../cloud/api.js'
import { requestCriticalPushSave } from '../cloud/sync.js'
import { CRITICAL_SAVE_REASONS } from '../cloud/criticalSavePolicy.js'
import { recordCollectionLogDrop } from '../cloud/collectionLog.js'
import GildedComplete from '../components/GildedComplete.jsx'
import GameIcon from '../components/GameIcon.jsx'
import BackLink from '../components/BackLink.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import { isUnlockOwned } from '../utils/completion.js'
import { SLAYER_UNLOCKS, getSlayerUnlockPurchaseState, ownsItem } from '../engine/slayerUnlocks.js'

const SLAYER_MULTITASK_COST = 250

const CHARACTER_UNLOCKS_DEF = [
  {
    id: 'double_slayer_xp',
    name: 'Slayer XP Boost',
    description: 'Permanently doubles all Slayer XP gained from task kills. Stacks with the boss ×10 multiplier.',
    icon: '💀',
    cost: 100,
    currency: 'credits',
    stateKey: 'doubleSlayerXp',
  },
]

export default function CharacterUnlockScreen({ onBack }) {
  const {
    characterUnlocks, updateCharacterUnlock, addToast, getSnapshot,
    slayerPoints, updateSlayerPoints, bank, inventory, addToBank, itemsData,
    slayerPerks, updateSlayerPerk,
  } = useGame()
  const isCloud = Boolean(getToken() && getCharacterId())

  const handlePurchase = async (unlock) => {
    if (!isCloud) {
      addToast('Sign in to purchase permanent unlocks.', 'error')
      return
    }
    if (characterUnlocks?.[unlock.stateKey]) {
      addToast('Already unlocked.', 'error')
      return
    }
    try {
      const res = await api.purchaseUnlock(unlock.id)
      const remaining = Number(res?.credits_remaining)
      if (Number.isFinite(remaining)) {
        window.dispatchEvent(new CustomEvent(CREDITS_UPDATED_EVENT, { detail: { credits_remaining: remaining } }))
      }
      updateCharacterUnlock(unlock.stateKey, true)
      requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.PURCHASE)
      addToast(`✨ ${unlock.name} unlocked permanently!`, 'info')
    } catch (err) {
      if (err?.status === 402) addToast('Not enough credits.', 'error')
      else addToast(err?.message || 'Purchase failed.', 'error')
    }
  }

  // Slayer unlocks — one-off items bought with slayer points (moved here from
  // the Slayer screen). Cloud accounts claim server-side (audited grant + point
  // debit), local saves grant straight to the bank.
  const handleSlayerUnlock = async (unlock) => {
    const item = itemsData[unlock.itemId]
    const purchaseState = getSlayerUnlockPurchaseState({ unlock, item, slayerPoints, bank, inventory })
    if (!purchaseState.allowed) {
      addToast(purchaseState.message || 'Unable to purchase unlock', 'error')
      return
    }
    if (getToken() && getCharacterId()) {
      try {
        await api.completeSlayer('slayer', { actionNonce: `slayer:${unlock.itemId}:${Date.now()}`, rewards: [{ itemId: unlock.itemId, quantity: 1 }], slayerPoints: -unlock.cost })
        // NOTE: deliberately NOT re-pulling + applyCloudSave/loadGame here — that
        // would adopt whatever the cloud save looked like at fetch time, which can
        // discard a local-only change (e.g. travel) made in the meantime. The
        // server granted exactly the item + point debit requested above, so apply
        // that directly; save_revision stays in sync generically via
        // SAVE_REVISION_EVENT (api.js).
        updateSlayerPoints(slayerPoints - unlock.cost)
        addToBank(unlock.itemId, 1)
        addToast(`🎉 Purchased ${item.name} — sent to bank`, 'info')
        return
      } catch (e) {
        addToast(`Unlock claim failed: ${e?.message || 'server_error'}`, 'error')
        return
      }
    }
    updateSlayerPoints(slayerPoints - unlock.cost)
    addToBank(unlock.itemId, 1)
    recordCollectionLogDrop({ itemId: unlock.itemId, sourceType: 'skilling', sourceId: 'slayer' })
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.PURCHASE)
    addToast(`🎉 Purchased ${item.name} — sent to bank`, 'info')
  }

  // Slayer Multitask perk — a non-item slayer-point unlock (doubles task size).
  const handleMultitask = () => {
    if (slayerPerks?.doubleQuantity) return
    if (slayerPoints < SLAYER_MULTITASK_COST) {
      addToast('Not enough slayer points.', 'error')
      return
    }
    updateSlayerPoints(slayerPoints - SLAYER_MULTITASK_COST)
    updateSlayerPerk('doubleQuantity', true)
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.PURCHASE)
    addToast('🗡️ Slayer Multitask unlocked!', 'info')
  }

  return (
    <div class="forge-shell h-full overflow-y-auto p-4">
      <BackLink onClick={onBack} className="mb-3" />

      <h2 class="flex items-center gap-2 font-[var(--font-display)] text-base font-bold text-[var(--color-gold)] mb-0.5">
        <GameIcon iconKey="master_rejuvenation" size={20} class="flex-shrink-0" />
        Character Unlocks
      </h2>
      <p class="text-xs text-[var(--color-parchment)] opacity-40 mb-4">
        Permanent upgrades purchased with credits. Unlocks apply to this character forever.
      </p>

      <div class="space-y-3">
        {CHARACTER_UNLOCKS_DEF.map(unlock => {
          const owned = isUnlockOwned(characterUnlocks, unlock.stateKey)
          return (
            <GildedComplete key={unlock.id} complete={owned} className="rounded-xl">
              <div
                class={`flex items-center justify-between p-3 rounded-xl border ${owned ? 'bg-[var(--fm-parch-hi)] border-[var(--color-hp-green)]' : 'bg-[var(--color-void-light)] border-[var(--color-void-border)]'}`}
              >
                <div class="flex items-center gap-3 min-w-0">
                  <GameIcon iconKey="death_skull" size={36} color="#c0453b" class="flex-shrink-0" />
                  <div class="min-w-0">
                    <div class="text-sm font-semibold text-[var(--color-parchment)]">{unlock.name}</div>
                    <div class="text-[9px] text-[var(--color-parchment)] opacity-50 mt-0.5 leading-tight">
                      {unlock.description}
                    </div>
                  </div>
                </div>
                <div class="flex-shrink-0 ml-3 text-right">
                  {owned ? (
                    <div class="text-[10px] font-bold text-[var(--color-hp-green)]">Owned</div>
                  ) : (
                    <button
                      onClick={() => handlePurchase(unlock)}
                      class="min-h-[44px] min-w-[72px] px-3 py-1.5 rounded-lg bg-[var(--color-gold)] text-black font-bold text-[11px] uppercase tracking-wider active:opacity-80"
                    >
                      {unlock.cost} credits
                    </button>
                  )}
                </div>
              </div>
            </GildedComplete>
          )
        })}
      </div>

      {!isCloud && (
        <p class="mt-4 text-center text-[11px] text-[var(--color-parchment)] opacity-40">
          Sign in with a cloud account to purchase permanent unlocks.
        </p>
      )}

      {/* Slayer unlocks — purchasable with slayer points */}
      <div class="mt-6 mb-2.5 flex justify-between items-baseline">
        <SectionHeader>Slayer Unlocks</SectionHeader>
        <span class="text-[11px] font-bold font-[var(--font-mono)] text-[var(--color-gold)]">
          {slayerPoints.toLocaleString()} pts
        </span>
      </div>
      <p class="text-xs text-[var(--color-parchment)] opacity-40 mb-3">
        One-off items bought with slayer points earned from completing slayer tasks.
      </p>
      <div class="flex flex-col gap-2.5">
        {SLAYER_UNLOCKS.map(unlock => {
          const item = itemsData[unlock.itemId]
          if (!item) return null
          const owned = ownsItem({ itemId: unlock.itemId, bank, inventory })
          const canAfford = slayerPoints >= unlock.cost
          const disabled = owned || !canAfford
          return (
            <SkillActionRow
              key={unlock.itemId}
              icon={<GameIcon item={item} size={30} />}
              title={item.name}
              meta={<>
                {unlock.description}
                {item.requirements?.slayer > 0 && <span class="block mt-1 opacity-80">Requires Slayer {item.requirements.slayer} to wear</span>}
              </>}
              chip={owned
                ? <span class="text-[var(--color-hp-green)]">Owned</span>
                : <span class={canAfford ? '' : 'text-[var(--color-blood-light)]'}>{unlock.cost.toLocaleString()} pts</span>}
              disabled={disabled}
              onClick={() => handleSlayerUnlock(unlock)}
            />
          )
        })}
        {(() => {
          const owned = slayerPerks?.doubleQuantity === true
          const canAfford = slayerPoints >= SLAYER_MULTITASK_COST
          return (
            <SkillActionRow
              icon={<span class="text-2xl">🗡️</span>}
              title="Slayer Multitask"
              meta="Doubles the number of monsters assigned by your Slayer Master."
              chip={owned
                ? <span class="text-[var(--color-hp-green)]">Active</span>
                : <span class={canAfford ? '' : 'text-[var(--color-blood-light)]'}>{SLAYER_MULTITASK_COST.toLocaleString()} pts</span>}
              disabled={owned || !canAfford}
              onClick={handleMultitask}
            />
          )
        })()}
      </div>
    </div>
  )
}
