import { useEffect, useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import Modal from '../components/Modal.jsx'
import GameIcon from '../components/GameIcon.jsx'
import BackLink from '../components/BackLink.jsx'
import CollapseChevron from '../components/CollapseChevron.jsx'
import { formatNumber } from '../utils/helpers.js'
import { formatIdleTime } from '../engine/idleEngine.js'
import {
  depositToCoffer, withdrawFromCoffer, clampAllocations, totalAllocatedPoints, estimateRuntimeMs, withdrawAllLoot,
} from '../engine/kingdomEngine.js'
import { KINGDOM_COFFER_MAX, KINGDOM_LABOUR_POINTS_MAX } from '../utils/constants.js'

const CATEGORY_LABELS = {
  mining: 'Mining',
  fishing: 'Fishing',
  woodcutting: 'Woodcutting',
  farming: 'Farm Herbs',
}
const CATEGORY_ICONS = {
  mining: 'mining',
  fishing: 'fishing_pole',
  woodcutting: 'wood_axe',
  farming: 'kingsherb',
}

export default function KingdomScreen({ onBack }) {
  const { kingdom, updateKingdom, settleKingdom, bank, itemsData, updateBankDirect } = useGame()
  const [depositModal, setDepositModal] = useState(null) // 'deposit' | 'withdraw' | null
  const [amountInput, setAmountInput] = useState('')
  const [showLootModal, setShowLootModal] = useState(false)
  const [labourExpanded, setLabourExpanded] = useState(true)

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
  const pendingLoot = kingdom.pendingLoot || {}
  const lootEntries = Object.entries(pendingLoot)

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
      updateBankDirect({ coins: -deposited })
    } else if (depositModal === 'withdraw') {
      const withdrawn = Math.min(amount, settled.cofferBalance)
      if (withdrawn <= 0) { setDepositModal(null); return }
      updateKingdom(withdrawFromCoffer(settled, withdrawn))
      updateBankDirect({ coins: withdrawn })
    }
    setDepositModal(null)
  }

  const openLootModal = () => {
    settleKingdom()
    setShowLootModal(true)
  }

  const handleWithdrawAllLoot = () => {
    const settled = settleKingdom() || kingdom
    const { kingdom: nextKingdom, withdrawn } = withdrawAllLoot(settled)
    if (Object.keys(withdrawn).length > 0) updateBankDirect(withdrawn)
    updateKingdom(nextKingdom)
    setShowLootModal(false)
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
          <button
            type="button"
            onClick={() => setLabourExpanded(e => !e)}
            aria-expanded={labourExpanded}
            class="w-full flex items-center gap-2 text-left bg-transparent border-0 cursor-pointer"
          >
            <span class="text-xs text-[var(--color-parchment)] opacity-70">
              Labour ({pointsRemaining} of {KINGDOM_LABOUR_POINTS_MAX} points free)
            </span>
            <CollapseChevron expanded={labourExpanded} className="ml-auto text-[var(--color-parchment)] opacity-60" />
          </button>
          {labourExpanded && (
            <div class="divide-y divide-[var(--color-void-border)] mt-2">
              {Object.keys(CATEGORY_LABELS).map((category) => {
                const points = allocations[category] || 0
                return (
                  <div key={category} class="flex items-center gap-3 py-3">
                    <span class="w-9 flex justify-center items-center flex-shrink-0">
                      <GameIcon iconKey={CATEGORY_ICONS[category]} size={28} />
                    </span>
                    <div class="flex-1 min-w-0 text-sm font-semibold text-[var(--color-parchment)]">
                      {CATEGORY_LABELS[category]}
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
          )}
        </Card>

        <Card className="p-3">
          <div class="text-xs text-[var(--color-parchment)] opacity-70 mb-1">Gathered Loot</div>
          <div class="text-sm text-[var(--color-parchment)] mb-3">
            {lootEntries.length > 0
              ? `${lootEntries.length} item${lootEntries.length === 1 ? '' : 's'} waiting in the treasury`
              : 'Nothing gathered yet'}
          </div>
          <Button variant="primary" size="sm" onClick={openLootModal} disabled={lootEntries.length === 0}>View Loot</Button>
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

      {showLootModal && (
        <Modal title="Gathered Loot" onClose={() => setShowLootModal(false)}>
          <Button variant="primary" size="sm" className="w-full mb-3" onClick={handleWithdrawAllLoot} disabled={lootEntries.length === 0}>
            Withdraw All to Bank
          </Button>
          {lootEntries.length === 0 ? (
            <div class="text-sm text-[var(--color-parchment)] opacity-60 text-center py-4">Nothing gathered yet</div>
          ) : (
            <div class="divide-y divide-[var(--color-void-border)]">
              {lootEntries.map(([itemId, qty]) => {
                const item = itemsData?.[itemId]
                return (
                  <div key={itemId} class="flex items-center gap-3 py-2">
                    <span class="w-8 flex justify-center items-center flex-shrink-0">
                      <GameIcon item={item} size={24} />
                    </span>
                    <div class="flex-1 min-w-0 text-sm text-[var(--color-parchment)]">{item?.name || itemId}</div>
                    <div class="text-sm font-bold text-[var(--color-gold)]">×{formatNumber(qty)}</div>
                  </div>
                )
              })}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
