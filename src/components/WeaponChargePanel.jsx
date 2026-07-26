import { useState } from 'preact/hooks'
import Panel from './Panel.jsx'
import Button from './Button.jsx'
import GameIcon from './GameIcon.jsx'

const DEFAULT_CHARGE_ITEM_ID = 'venomcoil_scales'

// Resolve a chargeable weapon's per-charge cost into a normalized recipe: the
// list of { itemId, qty } consumed PER charge. Single-ingredient weapons
// (Trident, Venom Blowpipe, Scythe) stay a 1×chargeItemId recipe; weapons that
// declare a `chargeRecipe` (e.g. Shadow of Tumaken — 5 Chaos + 2 Soul per
// charge) use it. Shared by the Equipment and Inventory charge UIs.
export function getChargeRecipe(item) {
  if (Array.isArray(item?.chargeRecipe) && item.chargeRecipe.length > 0) {
    return item.chargeRecipe.map(r => ({ itemId: r.itemId, qty: Math.max(1, r.qty || 1) }))
  }
  return [{ itemId: item?.chargeItemId || DEFAULT_CHARGE_ITEM_ID, qty: 1 }]
}

/**
 * The single charge/uncharge UI, shared by the Equipment and Inventory screens.
 * Pure presentation: the parent owns the actual charge/uncharge mutations and
 * passes them in.
 *
 * Props:
 *   item           — the chargeable weapon's item definition
 *   currentCharges — number of charges currently loaded
 *   inventory      — inventory array (used to count recipe ingredients)
 *   itemsData      — items lookup (for ingredient names)
 *   onCharge(qty)  — add `qty` charges (parent consumes the recipe)
 *   onUncharge()   — strip all charges and refund the recipe ingredients
 */
export default function WeaponChargePanel({ item, currentCharges = 0, inventory, itemsData, onCharge, onUncharge }) {
  const [chargeInput, setChargeInput] = useState('')

  const recipe = getChargeRecipe(item)
  const availableForId = (id) => inventory.reduce((sum, s) => sum + (s && s.itemId === id ? s.quantity : 0), 0)
  // Max charges affordable is gated by the scarcest recipe ingredient.
  const maxChargeable = recipe.reduce((min, r) => Math.min(min, Math.floor(availableForId(r.itemId) / r.qty)), Infinity)

  const parsedInput = parseInt(chargeInput, 10)
  const customQty = Number.isFinite(parsedInput) && parsedInput > 0 ? parsedInput : 0
  const costLabel = recipe.map(r => `${r.qty}× ${itemsData[r.itemId]?.name || r.itemId}`).join(' + ')

  const doCharge = (qty) => { onCharge(qty); setChargeInput('') }

  return (
    <Panel className="border-[#1a3a2a]">
      <div class="flex items-center justify-between mb-2">
        {/* Icon comes from the charge material, never the weapon — a hardcoded
            fallback used to show Venomcoil scales on every Shardglass item. */}
        <span class="flex items-center gap-1 text-[12px] font-semibold text-[#4ade80]">
          {recipe.map(r => (
            <GameIcon key={r.itemId} item={itemsData[r.itemId]} size={14} color="currentColor" title={itemsData[r.itemId]?.name || r.itemId} />
          ))}
          Charges
        </span>
        <span class="font-[var(--font-mono)] text-[12px] text-[var(--color-parchment)]">
          {currentCharges} / ∞
        </span>
      </div>
      <div class="text-[10px] text-[var(--color-parchment)] opacity-50 mb-1">
        Cost: {costLabel} per charge
      </div>
      <div class="text-[10px] text-[var(--color-parchment)] opacity-50 mb-2">
        {recipe.map(r => `${itemsData[r.itemId]?.name || r.itemId}: ${availableForId(r.itemId)}`).join(' · ')}
      </div>
      <div class="grid grid-cols-3 gap-1 mb-[6px]">
        <Button variant="success" size="sm" disabled={maxChargeable <= 0} onClick={() => doCharge(10)}>+10</Button>
        <Button variant="success" size="sm" disabled={maxChargeable <= 0} onClick={() => doCharge(100)}>+100</Button>
        <Button variant="success" size="sm" disabled={maxChargeable <= 0} onClick={() => doCharge(maxChargeable)}>+All</Button>
      </div>
      <div class="flex gap-1 mb-[6px]">
        <input
          type="number"
          min="1"
          value={chargeInput}
          onInput={(e) => setChargeInput(e.currentTarget.value)}
          placeholder="Custom amount"
          class="flex-1 px-2 py-2 rounded-md bg-[var(--color-void-light)] border border-[var(--color-void-border)] text-[var(--color-parchment)] text-[11px] font-[var(--font-mono)]"
        />
        <Button variant="success" size="md" disabled={customQty <= 0 || maxChargeable <= 0} onClick={() => doCharge(customQty)}>
          Charge
        </Button>
      </div>
      <Button
        variant="danger"
        size="md"
        disabled={currentCharges <= 0}
        onClick={onUncharge}
        className="w-full"
      >
        Uncharge (recover {currentCharges} charge{currentCharges === 1 ? '' : 's'})
      </Button>
    </Panel>
  )
}
