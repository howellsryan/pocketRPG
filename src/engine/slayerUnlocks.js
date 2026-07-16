export const SLAYER_UNLOCKS = [
  {
    itemId: 'slayer_helmet',
    cost: 400,
    description: 'Combined helmet that boosts damage and accuracy against your assigned slayer task.',
  },
  {
    itemId: 'slayer_defender',
    cost: 1500,
    description: 'A Slayer defender that grants +5 accuracy and +5 max damage against your assigned Slayer task.',
  },
  {
    itemId: 'gloves_of_slaughter',
    cost: 1500,
    description: 'Slayer gloves that grant +5 accuracy and +5 max damage against your assigned Slayer task.',
  },
  {
    itemId: 'zul_kaars_blade',
    cost: 2500,
    description: 'A blade forged in raid-hardened obsidian. Special: Disrupt.',
    requiresMasterCompletions: { masterId: 'zul_kaar', count: 25 },
  },
]

export function ownsItem({ itemId, bank = {}, inventory = [] }) {
  if (bank?.[itemId]?.quantity > 0) return true
  return inventory.some(slot => slot?.itemId === itemId && (slot.quantity ?? 1) > 0)
}

export function getSlayerUnlockPurchaseState({ unlock, item, slayerPoints, bank, inventory, masterTaskCompletions = {} }) {
  if (!unlock || !item) return { allowed: false, code: 'ITEM_NOT_FOUND', message: 'Item not found' }
  if (ownsItem({ itemId: unlock.itemId, bank, inventory })) {
    return { allowed: false, code: 'ALREADY_OWNED', message: `You already own a ${item.name}` }
  }
  if (unlock.requiresMasterCompletions) {
    const { masterId, count } = unlock.requiresMasterCompletions
    const have = Math.max(0, Math.floor(Number(masterTaskCompletions?.[masterId]) || 0))
    if (have < count) {
      return { allowed: false, code: 'MASTER_COMPLETIONS_REQUIRED', message: `Requires ${count} Zul-Kaar task completions (${have}/${count})` }
    }
  }
  if (slayerPoints < unlock.cost) {
    return { allowed: false, code: 'INSUFFICIENT_SLAYER_POINTS', message: `Need ${unlock.cost} slayer points` }
  }
  return { allowed: true, code: null, message: null }
}
