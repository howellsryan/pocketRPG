import { useEffect, useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import Modal from '../components/Modal.jsx'
import GameIcon from '../components/GameIcon.jsx'
import BackLink from '../components/BackLink.jsx'
import { formatNumber } from '../utils/helpers.js'
import { formatIdleTime } from '../engine/idleEngine.js'
import {
  depositToCoffer, withdrawFromCoffer, clampAllocations, totalAllocatedPoints, estimateRuntimeMs,
} from '../engine/kingdomEngine.js'
import { getEligibleTiers } from '../engine/kingdomResources.js'
import { KINGDOM_COFFER_MAX, KINGDOM_LABOUR_POINTS_MAX } from '../utils/constants.js'

const CATEGORY_LABELS = {
  mining: 'Mining',
  fishing: 'Fishing',
  woodcutting: 'Woodcutting',
  farming: 'Farm Herbs',
}
// Farm Herbs is gated by the player's Farming level, not Herblore.
const CATEGORY_GATE_SKILL = {
  mining: 'mining',
  fishing: 'fishing',
  woodcutting: 'woodcutting',
  farming: 'farming',
}
const CATEGORY_ICONS = {
  mining: 'mining',
  fishing: 'fishing_pole',
  woodcutting: 'wood_axe',
  farming: 'kingsherb',
}

export default function KingdomScreen({ onBack }) {
  const { kingdom, updateKingdom, settleKingdom, bank, getSkillLevel, itemsData, updateBankDirect } = useGame()
  const [depositModal, setDepositModal] = useState(null) // 'deposit' | 'withdraw' | null
  const [amountInput, setAmountInput] = useState('')

  // Settle on open + initialise lastTickAt so the coffer starts ticking.
  useEffect(() => {
    if (!kingdom.lastTickAt) {
      updateKingdom({ ...kingdom, lastTickAt: Date.now() })
      return
    }
    settleKingdom()
    // eslint-disable-next-line
  }, [])

  const coffer = kingdom.cofferBalance
  const allocations = kingdom.allocations
  const totalPoints = totalAllocatedPoints(allocations)
  const pointsRemaining = KINGDOM_LABOUR_POINTS_MAX - totalPoints
  const runtimeMs = estimateRuntimeMs(kingdom)
  const bankCoins = bank?.coins?.quantity || 0

  const adjustAllocation = (category, delta) => {
    const current = allocations[category] || 0
    const next = current + delta
    if (next < 0 || next > KINGDOM_LABOUR_POINTS_MAX) return
    if (delta > 0 && pointsRemaining <= 0) return
    const settled = settleKingdom() || kingdom
    const nextAllocations = clampAllocations({ ...settled.allocations, [category]: next })
    updateKingdom({ ...settled, allocations: nextAllocations })
  }

  // Deposit is capped by both what's in the bank and the coffer's remaining
  // room; withdraw is capped by the coffer balance itself.
  const modalMax = depositModal === 'deposit'
    ? Math.max(0, Math.min(bankCoins, KINGDOM_COFFER_MAX - coffer))
    : coffer

  const openModal = (mode) => {
    setAmountInput('')
    setDepositModal(mode)
  }

  const handleAmountInput = (raw) => {
    const max = depositModal === 'deposit'
      ? Math.max(0, Math.min(bankCoins, KINGDOM_COFFER_MAX - coffer))
      : coffer
    const parsed = Math.floor(Number(raw) || 0)
    if (raw === '') { setAmountInput(''); return }
    setAmountInput(String(Math.max(0, Math.min(parsed, max))))
  }

  const confirmAmount = () => {
    const amount = Math.min(Math.floor(Number(amountInput) || 0), modalMax)
    if (amount <= 0) { setDepositModal(null); return }
    const settled = settleKingdom() || kingdom
    if (depositModal === 'deposit') {
      const deposited = Math.min(amount, bankCoins, KINGDOM_COFFER_MAX - settled.cofferBalance)
      if (deposited <= 0) { setDepositModal(null); return }
      updateKingdom(depositToCoffer(settled, deposited))
      updateBankCoins(-deposited)
    } else if (depositModal === 'withdraw') {
      const withdrawn = Math.min(amount, settled.cofferBalance)
      if (withdrawn <= 0) { setDepositModal(null); return }
      updateKingdom(withdrawFromCoffer(settled, withdrawn))
      updateBankCoins(withdrawn)
    }
    setDepositModal(null)
  }

  function updateBankCoins(delta) {
    updateBankDirect({ coins: delta })
  }

  return (
    <div class="forge-shell h-full flex flex-col">
      <div class="flex-shrink-0 bg-[var(--color-void-light)] border-b border-[var(--color-void-border)] px-4 py-3">
        <BackLink onClick={onBack} className="mb-2" />
        <h1 class="flex items-center gap-2 font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)]">
          <GameIcon iconKey="castle" size={22} class="flex-shrink-0" />
          Kingdom of Royals
        </h1>
      </div>

      <div class="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <Card className="p-3">
          <div class="text-xs text-[var(--color-parchment)] opacity-70 mb-1">Royal Coffer</div>
          <div class="text-xl font-bold text-[var(--color-gold)]">
            {formatNumber(coffer)} <span class="text-xs opacity-60">/ {formatNumber(KINGDOM_COFFER_MAX)} coins</span>
          </div>
          <div class="text-xs text-[var(--color-parchment)] opacity-70 mt-1">
            {totalPoints > 0
              ? (runtimeMs > 0 ? `Funds the kingdom for ~${formatIdleTime(runtimeMs)}` : 'Coffer is empty — the kingdom is idle')
              : 'No labour assigned — the coffer is not draining'}
          </div>
          <div class="flex gap-2 mt-3">
            <Button variant="primary" size="sm" onClick={() => openModal('deposit')} disabled={bankCoins <= 0 || coffer >= KINGDOM_COFFER_MAX}>Deposit</Button>
            <Button variant="secondary" size="sm" onClick={() => openModal('withdraw')} disabled={coffer <= 0}>Withdraw</Button>
          </div>
        </Card>

        <Card className="p-3">
          <div class="text-xs text-[var(--color-parchment)] opacity-70 mb-2">
            Labour — {pointsRemaining} of {KINGDOM_LABOUR_POINTS_MAX} points free
          </div>
          <div class="divide-y divide-[var(--color-void-border)]">
            {Object.keys(CATEGORY_LABELS).map((category) => {
              const level = getSkillLevel ? getSkillLevel(CATEGORY_GATE_SKILL[category]) : 1
              const tiers = getEligibleTiers(category, level)
              const bestTier = tiers[tiers.length - 1]
              const bestItem = bestTier ? itemsData?.[bestTier.product] : null
              const points = allocations[category] || 0
              return (
                <div key={category} class="flex items-center gap-3 py-3">
                  <span class="w-9 flex justify-center items-center flex-shrink-0">
                    <GameIcon iconKey={CATEGORY_ICONS[category]} size={28} />
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-semibold text-[var(--color-parchment)]">{CATEGORY_LABELS[category]}</div>
                    <div class="text-xs text-[var(--color-parchment)] opacity-60">
                      {bestItem ? `Up to ${bestItem.name} (lv ${bestTier.level})` : 'Level too low to gather anything yet'}
                    </div>
                  </div>
                  <div class="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => adjustAllocation(category, -1)}
                      disabled={points <= 0}
                      class="w-8 h-8 rounded-lg bg-[var(--color-void)] border border-[var(--color-void-border)] text-[var(--color-parchment)] disabled:opacity-30"
                    >−</button>
                    <span class="w-4 text-center text-sm font-bold text-[var(--color-gold)]">{points}</span>
                    <button
                      type="button"
                      onClick={() => adjustAllocation(category, 1)}
                      disabled={points >= KINGDOM_LABOUR_POINTS_MAX || pointsRemaining <= 0}
                      class="w-8 h-8 rounded-lg bg-[var(--color-void)] border border-[var(--color-void-border)] text-[var(--color-parchment)] disabled:opacity-30"
                    >+</button>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {depositModal && (
        <Modal title={depositModal === 'deposit' ? 'Deposit Coins' : 'Withdraw Coins'} onClose={() => setDepositModal(null)}>
          <div class="text-xs text-[var(--color-parchment)] opacity-70 mb-2">
            {depositModal === 'deposit'
              ? `Bank: ${formatNumber(bankCoins)} coins`
              : `Coffer: ${formatNumber(coffer)} coins`}
          </div>
          <div class="flex gap-2 mb-3">
            <input
              type="number"
              inputMode="numeric"
              min="0"
              max={modalMax}
              value={amountInput}
              onInput={(e) => handleAmountInput(e.currentTarget.value)}
              class="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[var(--color-void)] border border-[var(--color-void-border)] text-[var(--color-parchment)]"
              placeholder="Amount"
            />
            <Button variant="secondary" size="sm" onClick={() => setAmountInput(String(modalMax))} disabled={modalMax <= 0}>All</Button>
          </div>
          <div class="flex gap-2">
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => setDepositModal(null)}>Cancel</Button>
            <Button variant="primary" size="sm" className="flex-1" onClick={confirmAmount}>Confirm</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
