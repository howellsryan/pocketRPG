import { useGame } from '../state/gameState.jsx'
import { api, getToken, getCharacterId, CREDITS_UPDATED_EVENT } from '../cloud/api.js'
import { requestCriticalPushSave } from '../cloud/sync.js'
import { CRITICAL_SAVE_REASONS } from '../cloud/criticalSavePolicy.js'
import GildedComplete from '../components/GildedComplete.jsx'
import GameIcon from '../components/GameIcon.jsx'
import { isUnlockOwned } from '../utils/completion.js'

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
  const { characterUnlocks, updateCharacterUnlock, addToast, getSnapshot } = useGame()
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

  return (
    <div class="forge-shell h-full overflow-y-auto p-4">
      <button
        onClick={onBack}
        class="text-xs text-[var(--color-gold-dim)] mb-3 flex items-center gap-1"
      >
        ← Back
      </button>

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
    </div>
  )
}
