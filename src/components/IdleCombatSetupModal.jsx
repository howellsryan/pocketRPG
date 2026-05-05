import { useMemo, useState } from 'preact/hooks'
import Modal from './Modal.jsx'
import Button from './Button.jsx'
import {
  isFoodItem,
  isBoostPotion,
  isPrayerRestorePotion,
  getValidIdlePrayerSelection,
  getFoodHealAmount,
} from '../engine/idleSupplies.js'

const TAB_LABEL = {
  food: 'Idle Eat',
  potion: 'Idle Potion',
  prayer: 'Idle Pray',
}

function countAcrossInventoryAndBank(itemId, inventory, bank) {
  let n = 0
  for (const slot of inventory || []) {
    if (slot && slot.itemId === itemId && !slot.noted) n += slot.quantity || 0
  }
  if (bank && bank[itemId]) n += bank[itemId].quantity || 0
  return n
}

function findEntry(list, itemId) {
  return (list || []).find((e) => e.itemId === itemId) || null
}

const UNLIMITED_IDLE_SUPPLY_QUANTITY = 200_000_000

function setEntryEnabled(list, itemId, enabled) {
  const next = (list || []).filter((e) => e.itemId !== itemId)
  if (enabled) next.push({ itemId, quantity: UNLIMITED_IDLE_SUPPLY_QUANTITY })
  return next
}

/**
 * Compact configuration UI shared between offline-idle and manual skip.
 * Sets the configured caps; the simulator clamps against real inventory + bank
 * each session, so the player can configure quantities they don't currently
 * own without breaking anything.
 */
export default function IdleCombatSetupModal({
  mode, // 'food' | 'potion' | 'prayer'
  onClose,
  inventory = [],
  bank = {},
  itemsData = {},
  prayersData = {},
  prayerLevel = 1,
  setup,
  onChange,
}) {
  const safeSetup = useMemo(() => ({
    food: Array.isArray(setup?.food) ? setup.food : [],
    potions: Array.isArray(setup?.potions) ? setup.potions : [],
    prayers: setup?.prayers || { protectionPrayerId: null, combatPrayerId: null },
  }), [setup])

  const [draft, setDraft] = useState(safeSetup)

  const update = (next) => {
    setDraft(next)
    onChange?.(next)
  }

  const inventoryRef = inventory
  const bankRef = bank

  const foodCandidates = useMemo(() => {
    const seen = new Set()
    const out = []
    const consider = (itemId) => {
      if (!itemId || seen.has(itemId)) return
      const item = itemsData?.[itemId]
      if (!isFoodItem(item)) return
      seen.add(itemId)
      out.push({
        itemId,
        item,
        available: countAcrossInventoryAndBank(itemId, inventoryRef, bankRef),
      })
    }
    for (const slot of inventoryRef) if (slot) consider(slot.itemId)
    for (const k of Object.keys(bankRef || {})) consider(k)
    for (const entry of safeSetup.food || []) consider(entry.itemId)
    return out.sort((a, b) => getFoodHealAmount(b.item) - getFoodHealAmount(a.item))
  }, [inventoryRef, bankRef, itemsData, safeSetup.food])

  const potionCandidates = useMemo(() => {
    const seen = new Set()
    const out = []
    const consider = (itemId) => {
      if (!itemId || seen.has(itemId)) return
      const item = itemsData?.[itemId]
      if (!item) return
      if (!(isBoostPotion(item) || isPrayerRestorePotion(item))) return
      seen.add(itemId)
      out.push({
        itemId,
        item,
        available: countAcrossInventoryAndBank(itemId, inventoryRef, bankRef),
      })
    }
    for (const slot of inventoryRef) if (slot) consider(slot.itemId)
    for (const k of Object.keys(bankRef || {})) consider(k)
    for (const entry of safeSetup.potions || []) consider(entry.itemId)
    return out
  }, [inventoryRef, bankRef, itemsData, safeSetup.potions])

  function handleToggleSupply(kind, itemId) {
    const list = kind === 'food' ? draft.food : draft.potions
    const selected = (findEntry(list, itemId)?.quantity || 0) > 0
    const nextList = setEntryEnabled(list, itemId, !selected)
    update({ ...draft, [kind === 'food' ? 'food' : 'potions']: nextList })
  }

  function handleSelectPrayer(prayerId, kind) {
    const cur = draft.prayers || {}
    const next = { ...cur }
    if (kind === 'protection') {
      next.protectionPrayerId = cur.protectionPrayerId === prayerId ? null : prayerId
    } else {
      next.combatPrayerId = cur.combatPrayerId === prayerId ? null : prayerId
    }
    const valid = getValidIdlePrayerSelection(next, prayersData, prayerLevel)
    update({ ...draft, prayers: valid })
  }

  return (
    <Modal title={TAB_LABEL[mode] || 'Idle Setup'} onClose={onClose}>
      {mode === 'food' && (
        <FoodSection
          candidates={foodCandidates}
          itemsData={itemsData}
          draft={draft}
          onToggle={(itemId) => handleToggleSupply('food', itemId)}
        />
      )}

      {mode === 'potion' && (
        <PotionSection
          candidates={potionCandidates}
          draft={draft}
          onToggle={(itemId) => handleToggleSupply('potion', itemId)}
        />
      )}

      {mode === 'prayer' && (
        <PrayerSection
          prayersData={prayersData}
          prayerLevel={prayerLevel}
          draft={draft}
          onSelect={handleSelectPrayer}
        />
      )}

      <div class="mt-4 flex justify-end">
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  )
}

function FoodSection({ candidates, draft, onToggle }) {
  if (candidates.length === 0) {
    return <div class="text-center py-4 text-[var(--color-parchment)] opacity-60">No food in inventory or bank.</div>
  }
  return (
    <div class="space-y-2">
      <div class="text-[11px] text-[var(--color-parchment)] opacity-60 leading-snug">
        Pick food the simulator may eat. Selected food is used until it runs out.
      </div>
      {candidates.map(({ itemId, item, available }) => {
        const selected = (findEntry(draft.food, itemId)?.quantity || 0) > 0
        const heal = getFoodHealAmount(item)
        return (
          <div key={itemId} class="flex items-center gap-2 p-2 rounded-lg bg-[var(--color-void-light)] border border-[var(--color-void-border)]">
            <span class="text-xl">{item.icon || '🍖'}</span>
            <div class="flex-1 min-w-0">
              <div class="text-sm text-[var(--color-parchment)]">{item.name} · +{heal} HP</div>
              <div class="text-[10px] text-[var(--color-parchment)] opacity-60">Own {available}</div>
            </div>
            <Button size="sm" variant={selected ? 'ghost' : 'secondary'} onClick={() => onToggle(itemId)}>{selected ? 'Clear' : 'Use'}</Button>
          </div>
        )
      })}
    </div>
  )
}

function PotionSection({ candidates, draft, onToggle }) {
  if (candidates.length === 0) {
    return <div class="text-center py-4 text-[var(--color-parchment)] opacity-60">No idle-compatible potions in inventory or bank.</div>
  }
  return (
    <div class="space-y-2">
      <div class="text-[11px] text-[var(--color-parchment)] opacity-60 leading-snug">
        Boost potions apply only while supply lasts (5 min per dose). Prayer/Super restores top up the prayer pool when a prayer is active.
      </div>
      {candidates.map(({ itemId, item, available }) => {
        const selected = (findEntry(draft.potions, itemId)?.quantity || 0) > 0
        let blurb = ''
        if (item.effect === 'combat') blurb = `+${item.boost} combat`
        else if (item.effect === 'prayer') blurb = `+${item.idlePrayerRestore || 15} prayer`
        else if (item.effect === 'super_restore') blurb = `+${item.idlePrayerRestore || 20} prayer`
        return (
          <div key={itemId} class="flex items-center gap-2 p-2 rounded-lg bg-[var(--color-void-light)] border border-[var(--color-void-border)]">
            <span class="text-xl">{item.icon || '🧪'}</span>
            <div class="flex-1 min-w-0">
              <div class="text-sm text-[var(--color-parchment)]">{item.name} · {blurb}</div>
              <div class="text-[10px] text-[var(--color-parchment)] opacity-60">Own {available}</div>
            </div>
            <Button size="sm" variant={selected ? 'ghost' : 'secondary'} onClick={() => onToggle(itemId)}>{selected ? 'Clear' : 'Use'}</Button>
          </div>
        )
      })}
    </div>
  )
}

function PrayerSection({ prayersData, prayerLevel, draft, onSelect }) {
  const protections = Object.values(prayersData || {})
    .filter((p) => p.bonusType === 'protection')
    .filter((p) => prayerLevel >= (p.level || 1))
  const combats = Object.values(prayersData || {})
    .filter((p) => p.bonusType === 'stat' || p.bonusType === 'multi_stat')
    .filter((p) => prayerLevel >= (p.level || 1))
    .sort((a, b) => (b.level || 1) - (a.level || 1))
  const protId = draft.prayers?.protectionPrayerId
  const cmbId = draft.prayers?.combatPrayerId
  return (
    <div class="space-y-4">
      <div class="text-[11px] text-[var(--color-parchment)] opacity-60 leading-snug">
        Pick at most one protection prayer and one combat-boost prayer. Prayer drains 1 point per attack while idle prayer is active.
      </div>

      <div>
        <div class="text-[11px] text-[var(--color-parchment)] opacity-60 mb-1">Protection Prayer</div>
        <div class="grid grid-cols-3 gap-2">
          {protections.map((prayer) => {
            const isActive = protId === prayer.id
            return (
              <button
                key={prayer.id}
                onClick={() => onSelect(prayer.id, 'protection')}
                class={`p-2 rounded-lg border text-center ${
                  isActive
                    ? 'bg-[#2a4a2a] border-[#4a8a4a]'
                    : 'bg-[var(--color-void-light)] border-[var(--color-void-border)] active:bg-[#2a3a2a]'
                }`}
              >
                <div class="text-base">{prayer.icon}</div>
                <div class="text-[10px] text-[var(--color-parchment)]">{prayer.name}</div>
                <div class="text-[9px] text-[var(--color-gold-dim)]">Lv {prayer.level}</div>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div class="text-[11px] text-[var(--color-parchment)] opacity-60 mb-1">Combat Prayer</div>
        <div class="grid grid-cols-2 gap-2">
          {combats.map((prayer) => {
            const isActive = cmbId === prayer.id
            return (
              <button
                key={prayer.id}
                onClick={() => onSelect(prayer.id, 'combat')}
                class={`p-2 rounded-lg border text-left ${
                  isActive
                    ? 'bg-[#2a3a1a] border-[#4a8a2a]'
                    : 'bg-[var(--color-void-light)] border-[var(--color-void-border)] active:bg-[#2a3a2a]'
                }`}
              >
                <div class="text-sm text-[var(--color-parchment)]">{prayer.icon} {prayer.name}</div>
                <div class="text-[10px] text-[var(--color-parchment)] opacity-60 line-clamp-2">{prayer.description}</div>
                <div class="text-[9px] text-[var(--color-gold-dim)]">Lv {prayer.level}</div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
