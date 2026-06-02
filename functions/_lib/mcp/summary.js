import { getLevelFromXP } from '../../../src/engine/experience.js'

// Compresses the (potentially large) raw save blob into a model-friendly view:
// coins, per-skill level + XP, current HP/prayer, worn equipment, inventory
// contents and bank size. Pure — exercised directly by the regression test.
export function summarizeSave(saveData) {
  const state = typeof saveData === 'string' ? JSON.parse(saveData) : (saveData || {})

  const skills = {}
  for (const [name, s] of Object.entries(state.stats || {})) {
    const xp = Number(s?.xp || 0)
    skills[name] = { level: getLevelFromXP(xp), xp }
  }

  const inventory = (state.inventory || [])
    .filter(Boolean)
    .map((slot) => ({ itemId: slot.itemId ?? slot.id, quantity: slot.quantity ?? 1, noted: !!slot.noted }))

  const equipment = {}
  for (const [slot, item] of Object.entries(state.equipment || {})) {
    if (item) equipment[slot] = { itemId: item.itemId ?? item.id, quantity: item.quantity ?? 1 }
  }

  return {
    coins: state.coins ?? 0,
    combatStance: state.settings?.combatStance ?? null,
    currentHP: state.player?.currentHP ?? null,
    prayerPoints: state.player?.prayer ?? null,
    skills,
    equipment,
    inventory,
    inventoryUsed: inventory.length,
    inventoryCapacity: 28,
    bankUniqueItems: state.bank ? Object.keys(state.bank).length : 0,
  }
}
