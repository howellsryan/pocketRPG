import { getPotionBonus } from './formulas.js'

const BASE_PVP_COMBAT_POTIONS = {
  attack_potion: { attack: 'attack_potion' },
  strength_potion: { strength: 'strength_potion' },
  defence_potion: { defence: 'defence_potion' },
  ranging_potion: { ranged: 'ranging_potion' },
  super_attack: { attack: 'super_attack' },
  super_strength: { strength: 'super_strength' },
  super_defence: { defence: 'super_defence' },
  combat_potion: { attack: 'attack_potion', strength: 'strength_potion' },
  super_combat_potion: { attack: 'super_attack', strength: 'super_strength', defence: 'super_defence' },
}

function normalizePotionId(itemOrId) {
  const raw = typeof itemOrId === 'string' ? itemOrId : itemOrId?.id
  if (typeof raw !== 'string') return null
  const lower = raw.toLowerCase()
  if (BASE_PVP_COMBAT_POTIONS[lower]) return lower
  const strippedDose = lower.replace(/[_\s-]?\(?\d+\)?$/, '')
  if (BASE_PVP_COMBAT_POTIONS[strippedDose]) return strippedDose
  return null
}

export function isPvpCombatPotion(itemOrId) {
  return !!normalizePotionId(itemOrId)
}

export function getPvpPotionBoosts(activePotions, baseStats) {
  const boosts = { attack: 0, strength: 0, defence: 0, ranged: 0, magic: 0 }
  if (!activePotions || typeof activePotions !== 'object') return boosts

  for (const [rawId, ticks] of Object.entries(activePotions)) {
    if ((ticks || 0) <= 0) continue
    const potionId = normalizePotionId(rawId)
    if (!potionId) continue
    const mapping = BASE_PVP_COMBAT_POTIONS[potionId] || {}
    for (const [stat, formulaPotionType] of Object.entries(mapping)) {
      const baseLevel = Number(baseStats?.[stat]) || 1
      boosts[stat] = Math.max(boosts[stat], getPotionBonus(formulaPotionType, baseLevel))
    }
  }

  return boosts
}
