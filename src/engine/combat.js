import {
  effectiveStrength, meleeMaxHit, effectiveAttack, maxAttackRoll,
  maxDefenceRoll, hitChance, rollDamage, getMeleeStyleBonuses,
  getMeleeXPSkill, effectiveRanged, rangedMaxHit, getRangedStyleBonus,
  effectiveMagic, monsterMagicDefenceRoll, magicMaxHit
} from './formulas.js'
import { getEquipmentBonuses, getAttackSpeed, getAttackStyle } from './equipment.js'
import { getLevelFromXP } from './experience.js'
import { MELEE_XP_PER_DAMAGE, RANGED_XP_PER_DAMAGE, MAGIC_XP_PER_DAMAGE, HP_XP_PER_DAMAGE, EAT_TICK_COST } from '../utils/constants.js'

/**
 * Create a new combat state
 */
export function createCombatState(monster, combatType = 'melee', stance = 'accurate', spell = null) {
  return {
    active: true,
    monster: { ...monster, currentHP: monster.hitpoints },
    combatType,      // 'melee', 'ranged', 'magic'
    stance,          // 'accurate', 'aggressive', 'controlled', 'defensive', 'rapid', 'longrange'
    spell,           // spell object for magic combat
    playerAttackTimer: 0,
    monsterAttackTimer: 0,
    eatCooldown: 0,
    potionCooldown: 0,
    log: [],         // combat log entries
    tickCount: 0,
    xpGained: {},    // accumulated xp per skill
    loot: null       // set on monster death
  }
}

/**
 * Process one combat tick.
 * Returns { combatState, events[] }
 * events: { type: 'playerHit'|'monsterHit'|'monsterDeath'|'playerDeath'|'xp'|'levelUp', ... }
 */
export function processCombatTick(combatState, playerStats, equipment, itemsData) {
  const state = { ...combatState }
  const events = []
  state.tickCount++

  // Decrement cooldowns
  if (state.playerAttackTimer > 0) state.playerAttackTimer--
  if (state.monsterAttackTimer > 0) state.monsterAttackTimer--
  if (state.eatCooldown > 0) state.eatCooldown--
  if (state.potionCooldown > 0) state.potionCooldown--

  const bonuses = getEquipmentBonuses(equipment, itemsData)
  const weaponSpeed = getAttackSpeed(equipment, itemsData)
  const weaponStyle = getAttackStyle(equipment, itemsData)
  const monster = state.monster

  // ── Player Attack ──
  if (state.playerAttackTimer <= 0 && state.eatCooldown <= 0) {
    let damage = 0
    let xpSkills = {}

    if (state.combatType === 'melee') {
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = meleeMaxHit(effStr, bonuses.otherBonus.meleeStrength)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      damage = rollDamage(acc, maxHit)

      if (damage > 0) {
        const xpSkill = getMeleeXPSkill(state.stance)
        if (Array.isArray(xpSkill)) {
          const per = Math.floor(damage * MELEE_XP_PER_DAMAGE / 3)
          for (const s of xpSkill) xpSkills[s] = per
        } else {
          xpSkills[xpSkill] = damage * MELEE_XP_PER_DAMAGE
        }
        xpSkills.hitpoints = Math.floor(damage * HP_XP_PER_DAMAGE)
      }
    } else if (state.combatType === 'ranged') {
      const styleBonus = getRangedStyleBonus(state.stance)
      const effRng = effectiveRanged(playerStats.ranged, 0, 1.0, styleBonus)
      const maxHit = rangedMaxHit(effRng, bonuses.otherBonus.rangedStrength)
      const atkRoll = maxAttackRoll(effRng, bonuses.attackBonus.ranged || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus.ranged || 0)
      const acc = hitChance(atkRoll, defRoll)
      damage = rollDamage(acc, maxHit)

      if (damage > 0) {
        xpSkills.ranged = damage * RANGED_XP_PER_DAMAGE
        xpSkills.hitpoints = Math.floor(damage * HP_XP_PER_DAMAGE)
      }
    } else if (state.combatType === 'magic' && state.spell) {
      const effMag = effectiveMagic(playerStats.magic)
      const atkRoll = maxAttackRoll(effMag, bonuses.attackBonus.magic || 0)
      const defRoll = monsterMagicDefenceRoll(monster.stats.magic, monster.stats.defence, monster.defenceBonus.magic || 0)
      const acc = hitChance(atkRoll, defRoll)
      const maxHit = magicMaxHit(state.spell.baseDamage, bonuses.otherBonus.magicDamage)
      damage = rollDamage(acc, maxHit)

      // Magic always grants base spell XP on cast
      xpSkills.magic = (state.spell.baseXP || 0)
      if (damage > 0) {
        xpSkills.magic += damage * MAGIC_XP_PER_DAMAGE
        xpSkills.hitpoints = Math.floor(damage * HP_XP_PER_DAMAGE)
      }
    }

    const actualDamage = Math.min(damage, Math.max(0, monster.currentHP))
    monster.currentHP -= actualDamage
    events.push({ type: 'playerHit', damage: actualDamage, monsterHP: monster.currentHP })

    // Recompute xpSkills based on actualDamage to avoid overkill XP
    if (actualDamage !== damage && actualDamage >= 0) {
      for (const skill of Object.keys(xpSkills)) {
        if (skill === 'magic' && state.combatType === 'magic') {
          // Keep base spell XP, scale only the damage portion
          const baseXP = state.spell?.baseXP || 0
          xpSkills[skill] = baseXP + (actualDamage > 0 ? actualDamage * MAGIC_XP_PER_DAMAGE : 0)
        } else if (skill === 'hitpoints') {
          xpSkills[skill] = Math.floor(actualDamage * HP_XP_PER_DAMAGE)
        } else {
          const ratio = damage > 0 ? actualDamage / damage : 0
          xpSkills[skill] = Math.floor(xpSkills[skill] * ratio)
        }
      }
    }

    // Accumulate XP and emit per-attack
    for (const [skill, xp] of Object.entries(xpSkills)) {
      state.xpGained[skill] = (state.xpGained[skill] || 0) + xp
    }
    if (Object.keys(xpSkills).length > 0) {
      events.push({ type: 'xp', xpSkills })
    }

    // Reset attack timer
    let speed = weaponSpeed
    if (state.combatType === 'ranged' && state.stance === 'rapid') speed = Math.max(1, speed - 1)
    state.playerAttackTimer = speed

    // Check monster death
    if (monster.currentHP <= 0) {
      monster.currentHP = 0
      state.active = false
      // Roll drops
      state.loot = rollDrops(monster)
      events.push({ type: 'monsterDeath', loot: state.loot, xpGained: { ...state.xpGained } })
      return { combatState: state, events }
    }
  }

  // ── Monster Attack ──
  if (state.monsterAttackTimer <= 0) {
    let damage = 0

    // ── Dragonfire attack ──
    if (monster.specialAttack === 'dragonfire' && Math.random() < 0.33) {
      const maxDragonfire = monster.dragonfireDamage || 50
      // Check if player has anti-dragon shield equipped
      const hasAntiDragon = equipment && Object.values(equipment).some(slot => {
        if (!slot || !slot.itemId) return false
        const item = itemsData[slot.itemId]
        return item && item.otherBonus && item.otherBonus.antiDragon
      })
      if (hasAntiDragon) {
        // Nullified — 0 damage
        damage = 0
        events.push({ type: 'dragonfireBlocked', damage: 0, playerHP: playerStats.currentHP })
      } else {
        // Full dragonfire — up to 50
        damage = Math.floor(Math.random() * (maxDragonfire + 1))
        events.push({ type: 'dragonfireHit', damage, playerHP: playerStats.currentHP - damage })
      }
    } else {
      const monsterEffAtk = (monster.stats.attack + 9)
      const monsterAtkRoll = monsterEffAtk * ((monster.attackBonus || 0) + 64)
      const playerDefLevel = playerStats.defence
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effDef = Math.floor(playerDefLevel) + styleBonuses.defenceStyleBonus + 8
      const defRoll = effDef * ((bonuses.defenceBonus[monster.attackStyle] || bonuses.defenceBonus.crush || 0) + 64)
      const acc = hitChance(monsterAtkRoll, defRoll)
      const monsterMaxHit = Math.floor(0.5 + (monster.stats.strength + 8) * ((monster.strengthBonus || 0) + 64) / 640)
      damage = rollDamage(acc, monsterMaxHit)
      events.push({ type: 'monsterHit', damage, playerHP: playerStats.currentHP - damage })
    }

    state.monsterAttackTimer = monster.attackSpeed || 4
  }

  state.monster = monster
  return { combatState: state, events }
}

/**
 * Roll monster drops
 */
function rollDrops(monster) {
  if (!monster.drops) return []
  const loot = []
  for (const drop of monster.drops) {
    if (Math.random() < drop.chance) {
      const qty = Array.isArray(drop.quantity)
        ? Math.floor(Math.random() * (drop.quantity[1] - drop.quantity[0] + 1)) + drop.quantity[0]
        : drop.quantity
      loot.push({ itemId: drop.itemId, quantity: qty })
    }
  }
  return loot
}

/**
 * Apply eat action — delays player attack by EAT_TICK_COST
 */
export function applyEat(combatState) {
  return { ...combatState, eatCooldown: EAT_TICK_COST, playerAttackTimer: Math.max(combatState.playerAttackTimer, EAT_TICK_COST) }
}
