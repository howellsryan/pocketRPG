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
import { SLAYER_MASTERS } from '../engine/slayerMasters.js'
import { UNLOCKABLES } from '../engine/construction.js'
import { getLevelFromXP } from '../engine/experience.js'
import { GATHER_AUTOBANK_CONSTRUCTION_LEVEL } from '../utils/constants.js'

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
  {
    id: 'auto_slayer_task',
    name: 'Auto Slayer Task',
    description: 'While idling on a Slayer task, automatically take the next task from the same master when one finishes — the idle grind keeps completing tasks until you return. Applies to offline catch-up and Skip 1h.',
    icon: '🗡️',
    cost: 100,
    currency: 'credits',
    stateKey: 'autoSlayerTask',
  },
  {
    id: 'extra_equipment_tab',
    name: 'Extra Equipment Tab',
    description: 'Adds one more loadout tab on the Equipment screen, on top of the three every character starts with. Buy as many as you like — each one costs 10 credits.',
    icon: '🎽',
    iconKey: 'body',
    cost: 10,
    currency: 'credits',
    stateKey: 'extraEquipmentTabs',
    repeatable: true,
  },
]

export default function CharacterUnlockScreen({ onBack }) {
  const {
    characterUnlocks, updateCharacterUnlock, addToast, getSnapshot,
    slayerPoints, updateSlayerPoints, bank, inventory, addToBank, itemsData,
    slayerPerks, updateSlayerPerk, slayerMasterTaskCompletions,
    stats, unlockedFeatures, unlockFeature, addSlayerStoreUnlock,
  } = useGame()
  const constructionLevel = getLevelFromXP(stats.construction?.xp || 0)
  const isCloud = Boolean(getToken() && getCharacterId())

  const handlePurchase = async (unlock) => {
    if (!isCloud) {
      addToast('Sign in to purchase permanent unlocks.', 'error')
      return
    }
    if (!unlock.repeatable && characterUnlocks?.[unlock.stateKey]) {
      addToast('Already unlocked.', 'error')
      return
    }
    try {
      const res = await api.purchaseUnlock(unlock.id)
      const remaining = Number(res?.credits_remaining)
      if (Number.isFinite(remaining)) {
        window.dispatchEvent(new CustomEvent(CREDITS_UPDATED_EVENT, { detail: { credits_remaining: remaining } }))
      }
      if (unlock.repeatable) updateCharacterUnlock(unlock.stateKey, prev => (Math.floor(Number(prev) || 0)) + 1)
      else updateCharacterUnlock(unlock.stateKey, true)
      requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.PURCHASE)
      addToast(unlock.repeatable ? `✨ ${unlock.name} purchased!` : `✨ ${unlock.name} unlocked permanently!`, 'info')
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
    const purchaseState = getSlayerUnlockPurchaseState({ unlock, item, slayerPoints, bank, inventory, masterTaskCompletions: slayerMasterTaskCompletions })
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
        addSlayerStoreUnlock(unlock.itemId)
        recordCollectionLogDrop({ itemId: unlock.itemId, sourceType: 'skilling', sourceId: 'slayer' })
        addToast(`🎉 Purchased ${item.name} — sent to bank`, 'info')
        return
      } catch (e) {
        addToast(`Unlock claim failed: ${e?.message || 'server_error'}`, 'error')
        return
      }
    }
    updateSlayerPoints(slayerPoints - unlock.cost)
    addToBank(unlock.itemId, 1)
    addSlayerStoreUnlock(unlock.itemId)
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

  // Construction unlockables — one-off feature unlocks, moved here from the
  // Construction screen so all permanent progression lives in one place.
  const handleConstructionUnlock = (unlockable) => {
    unlockFeature(unlockable.id)
    recordCollectionLogDrop({ itemId: unlockable.id, sourceType: 'skilling', sourceId: 'construction' })
    addToast(`${unlockable.icon} ${unlockable.name} complete!`, 'success')
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
          // A repeatable unlock holds a count, not a flag: it never reads as
          // "Owned" (there is always another to buy), so it shows how many the
          // character holds beside a button that stays live.
          const ownedCount = unlock.repeatable ? Math.max(0, Math.floor(Number(characterUnlocks?.[unlock.stateKey]) || 0)) : 0
          const owned = unlock.repeatable ? false : isUnlockOwned(characterUnlocks, unlock.stateKey)
          return (
            <GildedComplete key={unlock.id} complete={owned} className="rounded-xl">
              <div
                class={`flex items-center justify-between p-3 rounded-xl border ${owned ? 'bg-[var(--surface-raised)] border-[var(--color-hp-green)]' : 'bg-[var(--color-void-light)] border-[var(--color-void-border)]'}`}
              >
                <div class="flex items-center gap-3 min-w-0">
                  <GameIcon iconKey={unlock.iconKey || 'death_skull'} size={36} color="#c0453b" class="flex-shrink-0" />
                  <div class="min-w-0">
                    <div class="text-sm font-semibold text-[var(--color-parchment)]">{unlock.name}</div>
                    <div class="text-[9px] text-[var(--color-parchment)] opacity-50 mt-0.5 leading-tight">
                      {unlock.description}
                    </div>
                    {unlock.repeatable && ownedCount > 0 && (
                      <div class="text-[10px] font-bold text-[var(--color-hp-green)] mt-1">
                        {ownedCount} owned
                      </div>
                    )}
                  </div>
                </div>
                <div class="flex-shrink-0 ml-3 text-right">
                  {owned ? (
                    <div class="text-[10px] font-bold text-[var(--color-hp-green)]">Owned</div>
                  ) : (
                    <button
                      onClick={() => handlePurchase(unlock)}
                      class="fm-btn fm-btn--brass fm-btn--sm min-w-[72px] text-[11px] uppercase tracking-wider"
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
          const reqMaster = unlock.requiresMasterCompletions
          const masterHave = reqMaster ? Math.max(0, Math.floor(Number(slayerMasterTaskCompletions?.[reqMaster.masterId]) || 0)) : 0
          const masterMet = !reqMaster || masterHave >= reqMaster.count
          const masterName = reqMaster ? (SLAYER_MASTERS.find(m => m.id === reqMaster.masterId)?.name || reqMaster.masterId) : null
          const disabled = owned || !canAfford || !masterMet
          return (
            <SkillActionRow
              key={unlock.itemId}
              icon={<GameIcon item={item} size={30} />}
              title={item.name}
              meta={<>
                {unlock.description}
                {item.requirements?.slayer > 0 && <span class="block mt-1 opacity-80">Requires Slayer {item.requirements.slayer} to wear</span>}
                {reqMaster && (
                  <span class={`block mt-1 ${masterMet ? 'opacity-80' : 'text-[var(--color-blood-light)]'}`}>
                    {masterName} tasks: {masterHave}/{reqMaster.count}
                  </span>
                )}
              </>}
              chip={owned
                ? <span class="text-[var(--color-hp-green)]">Owned</span>
                : <span class={canAfford && masterMet ? '' : 'text-[var(--color-blood-light)]'}>{unlock.cost.toLocaleString()} pts</span>}
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

      {/* Construction — unlockables + passive perks, moved here from the
          Construction screen (same markup/styling, new home). */}
      <SectionHeader className="mt-6 mb-2.5">Construction</SectionHeader>

      <h3 class="font-[var(--font-display)] text-xs font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider mb-2">
        Unlockables
      </h3>
      <div class="space-y-2">
        {UNLOCKABLES.map(unlockable => {
          const available = constructionLevel >= unlockable.level
          const alreadyDone = unlockedFeatures.has(unlockable.id)
          return (
            <div
              key={unlockable.id}
              class={`p-3 rounded-xl border ${
                alreadyDone
                  ? 'bg-[var(--surface-raised)] border-[var(--color-emerald)]'
                  : available
                    ? 'bg-[var(--color-void-light)] border-[var(--color-void-border)]'
                    : 'bg-[var(--color-void)] border-[var(--color-void-border)] opacity-40'
              }`}
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5 mb-0.5">
                    <span class="text-base">{unlockable.icon}</span>
                    <div class="text-sm font-semibold text-[var(--color-parchment)]">{unlockable.name}</div>
                  </div>
                  <div class="text-[10px] text-[var(--color-parchment)] opacity-50">
                    Lv {unlockable.level} required · {unlockable.description}
                  </div>
                </div>
                {alreadyDone ? (
                  <span class="text-xs text-green-400 font-semibold shrink-0 pt-0.5">✓ Unlocked</span>
                ) : (
                  <button
                    onClick={() => available && handleConstructionUnlock(unlockable)}
                    disabled={!available}
                    class={`fm-btn fm-btn--sm shrink-0 text-xs ${available ? 'fm-btn--brass' : ''}`}
                  >
                    {available ? 'Create' : `Lv ${unlockable.level}`}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <h3 class="font-[var(--font-display)] text-xs font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider mb-2 mt-4">
        Passive Perks
      </h3>
      <div class="space-y-2">
        {(() => {
          const unlocked = constructionLevel >= GATHER_AUTOBANK_CONSTRUCTION_LEVEL
          return (
            <div class={`p-3 rounded-xl border ${unlocked ? 'bg-[var(--surface-raised)] border-[var(--color-emerald)]' : 'bg-[var(--color-void)] border-[var(--color-void-border)] opacity-40'}`}>
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5 mb-0.5">
                    <span class="text-base">🏦</span>
                    <div class="text-sm font-semibold text-[var(--color-parchment)]">Auto-bank Gathering</div>
                  </div>
                  <div class="text-[10px] text-[var(--color-parchment)] opacity-50">
                    Lv 80 required · Gathered resources auto-bank when your inventory fills during idle/offline catch-up and skip simulations. Active gathering still stops when your inventory is full.
                  </div>
                </div>
                <span class={`text-xs font-semibold shrink-0 pt-0.5 ${unlocked ? 'text-green-400' : 'text-[var(--text-faint)]'}`}>
                  {unlocked ? '✓ Unlocked' : 'Lv 80'}
                </span>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
