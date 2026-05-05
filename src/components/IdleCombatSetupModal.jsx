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

function setEntryQuantity(list, itemId, quantity) {
  const next = (list || []).filter((e) => e.itemId !== itemId)
  if (quantity > 0) next.push({ itemId, quantity })
  return next
}

function clampQuantity(value, available) {
  const parsed = Math.floor(Number(value) || 0)
  return Math.max(0, Math.min(available, parsed))
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

  function handleQuantityChange(kind, itemId, available, delta) {
    const list = kind === 'food' ? draft.food : draft.potions
    const current = findEntry(list, itemId)?.quantity || 0
    const next = Math.max(0, Math.min(available, current + delta))
    if (next === current) return
    const nextList = setEntryQuantity(list, itemId, next)
    update({ ...draft, [kind === 'food' ? 'food' : 'potions']: nextList })
  }

  function handleSetMax(kind, itemId, available) {
    const list = kind === 'food' ? draft.food : draft.potions
    const nextList = setEntryQuantity(list, itemId, available)
    update({ ...draft, [kind === 'food' ? 'food' : 'potions']: nextList })
  }

  function handleSetQuantity(kind, itemId, available, value) {
    const list = kind === 'food' ? draft.food : draft.potions
    const next = clampQuantity(value, available)
    const nextList = setEntryQuantity(list, itemId, next)
    update({ ...draft, [kind === 'food' ? 'food' : 'potions']: nextList })
  }

  function handleRemove(kind, itemId) {
    const list = kind === 'food' ? draft.food : draft.potions
    const nextList = setEntryQuantity(list, itemId, 0)
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
          onChange={(itemId, available, delta) => handleQuantityChange('food', itemId, available, delta)}
          onSetQuantity={(itemId, available, value) => handleSetQuantity('food', itemId, available, value)}
          onSetMax={(itemId, available) => handleSetMax('food', itemId, available)}
          onRemove={(itemId) => handleRemove('food', itemId)}
        />
      )}

      {mode === 'potion' && (
        <PotionSection
          candidates={potionCandidates}
          draft={draft}
          onChange={(itemId, available, delta) => handleQuantityChange('potion', itemId, available, delta)}
          onSetQuantity={(itemId, available, value) => handleSetQuantity('potion', itemId, available, value)}
          onSetMax={(itemId, available) => handleSetMax('potion', itemId, available)}
          onRemove={(itemId) => handleRemove('potion', itemId)}
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

function FoodSection({ candidates, draft, onChange, onSetQuantity, onSetMax, onRemove }) {
  if (candidates.length === 0) {
    return <div class="text-center py-4 text-[var(--color-parchment)] opacity-60">No food in inventory or bank.</div>
  }
  return (
    <div class="space-y-2">
      <div class="text-[11px] text-[var(--color-parchment)] opacity-60 leading-snug">
        Configure food the simulator may eat. Each fight only consumes what it actually needs, capped against the food you own when the session runs.
      </div>
      {candidates.map(({ itemId, item, available }) => {
        const cur = findEntry(draft.food, itemId)?.quantity || 0
        const heal = getFoodHealAmount(item)
        return (
          <div key={itemId} class="flex items-center gap-2 p-2 rounded-lg bg-[var(--color-void-light)] border border-[var(--color-void-border)]">
            <span class="text-xl">{item.icon || '🍖'}</span>
            <div class="flex-1 min-w-0">
              <div class="text-sm text-[var(--color-parchment)]">{item.name}</div>
              <div class="text-[10px] text-[var(--color-parchment)] opacity-60">+{heal} HP · own {available}</div>
            </div>
            <div class="flex items-center gap-1">
              <Button size="sm" variant="secondary" onClick={() => onChange(itemId, available, -1)} disabled={cur <= 0}>-</Button>
              <input
                type="number"
                min="0"
                max={available}
                value={cur}
                onInput={(e) => onSetQuantity(itemId, available, e.currentTarget.value)}
                class="w-12 h-8 text-center rounded border border-[var(--color-void-border)] bg-[var(--color-void)] text-[var(--color-gold)] font-[var(--font-mono)] text-sm"
              />
              <Button size="sm" variant="secondary" onClick={() => onChange(itemId, available, +1)} disabled={cur >= available}>+</Button>
              <Button size="sm" variant="ghost" onClick={() => onSetMax(itemId, available)}>Max</Button>
              <Button size="sm" variant="ghost" onClick={() => onRemove(itemId)} disabled={cur <= 0}>Clear</Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PotionSection({ candidates, draft, onChange, onSetQuantity, onSetMax, onRemove }) {
  if (candidates.length === 0) {
    return <div class="text-center py-4 text-[var(--color-parchment)] opacity-60">No idle-compatible potions in inventory or bank.</div>
  }
  return (
    <div class="space-y-2">
      <div class="text-[11px] text-[var(--color-parchment)] opacity-60 leading-snug">
        Boost potions apply only while supply lasts (5 min per dose). Prayer/Super restores top up the prayer pool when a prayer is active.
      </div>
      {candidates.map(({ itemId, item, available }) => {
        const cur = findEntry(draft.potions, itemId)?.quantity || 0
        let blurb = ''
        if (item.effect === 'combat') blurb = `+${item.boost} combat`
        else if (item.effect === 'prayer') blurb = `+${item.idlePrayerRestore || 15} prayer`
        else if (item.effect === 'super_restore') blurb = `+${item.idlePrayerRestore || 20} prayer`
        return (
          <div key={itemId} class="flex items-center gap-2 p-2 rounded-lg bg-[var(--color-void-light)] border border-[var(--color-void-border)]">
            <span class="text-xl">{item.icon || '🧪'}</span>
            <div class="flex-1 min-w-0">
              <div class="text-sm text-[var(--color-parchment)]">{item.name}</div>
              <div class="text-[10px] text-[var(--color-parchment)] opacity-60">{blurb}</div>
            </div>
            <div class="flex items-center gap-1">
              <Button size="sm" variant="secondary" onClick={() => onChange(itemId, available, -1)} disabled={cur <= 0}>-</Button>
              <input
                type="number"
                min="0"
                max={available}
                value={cur}
                onInput={(e) => onSetQuantity(itemId, available, e.currentTarget.value)}
                class="w-12 h-8 text-center rounded border border-[var(--color-void-border)] bg-[var(--color-void)] text-[var(--color-gold)] font-[var(--font-mono)] text-sm"
              />
              <Button size="sm" variant="secondary" onClick={() => onChange(itemId, available, +1)} disabled={cur >= available}>+</Button>
              <Button size="sm" variant="secondary" onClick={() => onSetMax(itemId, available)}>All</Button>
              <Button size="sm" variant="secondary" onClick={() => onRemove(itemId)} disabled={cur <= 0}>x</Button>
            </div>
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
